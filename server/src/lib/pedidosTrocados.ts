import { and, eq, gte, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, expedicaoPedidos, notifications, permissoesAdmin, sapPedidosPendentes, users, vendas } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { comSessaoSap, dataSap, sapConfigurado } from './sapServiceLayer.js'
import { nomeParecido } from './nomeParecido.js'
import { hojeBrString } from './dataBr.js'

// Revisão automática de PEDIDOS × CLIENTES TROCADOS entre o SAP e o CRM
// (João, 2026-11-19: "clientes e pedidos trocados – SAP, pedidos da
// expedição que estão trocados, revisar tudo… um agente pra ver isso").
//
// Caso que disparou: pedido 9700 aparecendo no card da F. MARQUES (código
// 5215 da planilha da Odin Tubos). Causa achada: a venda automática junta
// cadastros pelo CÓDIGO ANTIGO de qualquer empresa, e o código antigo da
// Joitec (sistema velho) não é o mesmo da planilha da Odin Tubos — ex.: 622 =
// JR Manutenção (C002798) na Joitec, 622 = Planalto Compressores na Odin
// Tubos → pedido 8970 da JR caiu na Planalto. A venda automática agora exige
// nome parecido nesse caso (sapVendasAuto.equivalentes); esta revisão acha o
// que já está trocado.
//
// Só LÊ — não muda venda nem card. Roda sozinha de 30 em 30 min (scheduler)
// e pelo botão "Revisar agora". Guarda o resultado em configuracoes
// (`pedidos_trocados_resultado`) e o que o admin marcou como "está certo"
// em `pedidos_trocados_ignorados`. Avisa (sininho) quando aparece caso novo.
//
// Tipos:
//   venda_outro_cliente  venda ligada a um pedido do SAP que é de OUTRO
//                        cliente (código e nome diferentes).
//   numero_outro_cliente venda digitada com nº de pedido que no SAP é de
//                        outro cliente (ainda não ligada).
//   cadastro_outro_nome  cadastro do CRM com o código do SAP de outro cliente
//                        (nome diferente) — pedido/expedição/cotação desse
//                        código caem no cadastro errado.

export const FEATURE_PEDIDOS_TROCADOS = 'pedidos_trocados'
const CHAVE_RESULTADO = 'pedidos_trocados_resultado'
const CHAVE_IGNORADOS = 'pedidos_trocados_ignorados'
const DIAS = 60

export type TipoTrocado = 'venda_outro_cliente' | 'numero_outro_cliente' | 'cadastro_outro_nome'

export interface ItemTrocado {
  chave: string
  tipo: TipoTrocado
  empresaId: number
  empresa: string
  data: string | null
  pedido: string | null
  valor: number | null
  // Como está no CRM
  clienteId: number
  clienteCodigo: string
  clienteNome: string
  vendedor: string | null
  vendaId: number | null
  vendaAutomatica: boolean | null
  // Como está no SAP
  sapCodigo: string
  sapNome: string
  // Cadastro certo (o do código do SAP) na mesma empresa, se existe.
  certoId: number | null
  certoNome: string | null
  // Expedição: pedido no quadro (etapa) — a "jornada" aparece no card errado.
  naExpedicao: string | null
  detalhe: string
}

export interface ResultadoTrocados {
  rodadoEm: string
  fonte: 'sap' | 'crm'
  pedidosLidos: number
  itens: ItemTrocado[]
}

type Ignorados = Record<string, { motivo: string; por: string; em: string }>

const limpar = (c: string | null | undefined) => (c ?? '').trim().replace(/\.0+$/, '').toUpperCase()
const ehCodigoSap = (c: string) => /^C\d{4,}$/.test(c)

interface PedidoSap {
  entry: number | null
  numero: string
  cardCode: string
  cardName: string
  valor: number | null
  data: string | null
}

export async function lerIgnorados(): Promise<Ignorados> {
  try {
    return JSON.parse((await getConfigTexto(CHAVE_IGNORADOS)) ?? '{}') as Ignorados
  } catch {
    return {}
  }
}

export async function gravarIgnorado(chave: string, motivo: string | null, por: string): Promise<void> {
  const ign = await lerIgnorados()
  if (motivo) ign[chave] = { motivo, por, em: new Date().toISOString() }
  else delete ign[chave]
  await setConfig(CHAVE_IGNORADOS, JSON.stringify(ign))
}

export async function ultimoResultado(): Promise<ResultadoTrocados | null> {
  try {
    const t = await getConfigTexto(CHAVE_RESULTADO)
    return t ? (JSON.parse(t) as ResultadoTrocados) : null
  } catch {
    return null
  }
}

// Pedidos do SAP dos últimos DIAS dias. Com o SAP: lê os pedidos (só o
// cabeçalho). Sem o SAP (fora do ar / teste local): usa o que o CRM já guarda
// do SAP — quadro da Expedição (pedido + cliente do SAP) e pedidos pendentes.
async function pedidosDoSap(): Promise<{ fonte: 'sap' | 'crm'; lista: PedidoSap[] }> {
  const desde = new Date(Date.now() - DIAS * 86400_000)
  const desdeDia = desde.toISOString().slice(0, 10)
  if (sapConfigurado()) {
    try {
      const lista = await comSessaoSap((sap) =>
        sap.getTodos<{ DocEntry: number; DocNum: number; CardCode: string; CardName: string; DocTotal: number; DocDate: string; Cancelled: string }>(
          `/Orders?$filter=DocDate ge '${desdeDia}'&$select=DocEntry,DocNum,CardCode,CardName,DocTotal,DocDate,Cancelled`,
          200
        )
      )
      return {
        fonte: 'sap',
        lista: lista.map((p) => ({ entry: p.DocEntry, numero: String(p.DocNum), cardCode: limpar(p.CardCode), cardName: p.CardName, valor: p.DocTotal, data: dataSap(p.DocDate) })),
      }
    } catch (err) {
      console.error('[pedidos-trocados] SAP fora, usando o que o CRM guarda:', err instanceof Error ? err.message : err)
    }
  }
  const desdeSql = desde.toISOString().replace('T', ' ').slice(0, 19)
  const exp = await db
    .select({ entries: expedicaoPedidos.orderEntriesSap, numeros: expedicaoPedidos.pedidosSap, codigo: expedicaoPedidos.clienteCodigo, nome: expedicaoPedidos.clienteNome, data: expedicaoPedidos.inicioPrazo })
    .from(expedicaoPedidos)
    .where(gte(expedicaoPedidos.inicioPrazo, desdeSql))
  const lista: PedidoSap[] = []
  for (const p of exp) {
    if (!p.codigo) continue
    const entries = p.entries.split(',').map((e) => Number(e.trim()))
    const numeros = p.numeros.split(',').map((n) => n.trim())
    entries.forEach((e, i) => lista.push({ entry: Number.isFinite(e) ? e : null, numero: numeros[i] ?? numeros[0], cardCode: limpar(p.codigo), cardName: p.nome ?? '', valor: null, data: p.data?.slice(0, 10) ?? null }))
  }
  return { fonte: 'crm', lista }
}

interface DadosClienteSap {
  documentos: string[]
  outrosNomes: string[]
}

// CNPJ/CPF e nomes fantasia dos clientes do SAP (poucos — só os acusados).
async function dadosClientesSap(codigos: string[]): Promise<Map<string, DadosClienteSap>> {
  const mapa = new Map<string, DadosClienteSap>()
  if (!codigos.length) return mapa
  try {
    await comSessaoSap(async (sap) => {
      for (const cod of codigos.filter(ehCodigoSap).slice(0, 150)) {
        try {
          const bp = await sap.get<{ FederalTaxID: string | null; CardForeignName: string | null; AliasName: string | null; BPFiscalTaxIDCollection?: { TaxId0: string | null; TaxId4: string | null }[] }>(
            `/BusinessPartners('${cod}')?$select=FederalTaxID,CardForeignName,AliasName,BPFiscalTaxIDCollection`
          )
          const docs = [bp.FederalTaxID, ...(bp.BPFiscalTaxIDCollection ?? []).flatMap((t) => [t.TaxId0, t.TaxId4])]
            .map((d) => (d ?? '').replace(/\D/g, ''))
            .filter((d) => d.length >= 11)
          mapa.set(cod, { documentos: [...new Set(docs)], outrosNomes: [bp.CardForeignName, bp.AliasName].filter((n): n is string => !!n) })
        } catch {
          // cliente não achado no SAP: fica na lista
        }
      }
    })
  } catch (err) {
    console.error('[pedidos-trocados] não deu pra conferir CNPJ no SAP:', err instanceof Error ? err.message : err)
  }
  return mapa
}

export async function revisarPedidosTrocados(opts: { avisar?: boolean } = {}): Promise<ResultadoTrocados> {
  const { fonte, lista: pedidos } = await pedidosDoSap()
  const porEntry = new Map<number, PedidoSap>()
  const porNumero = new Map<string, PedidoSap>()
  for (const p of pedidos) {
    if (p.entry != null) porEntry.set(p.entry, p)
    if (!porNumero.has(p.numero)) porNumero.set(p.numero, p)
  }
  // Pendentes (aguardando financeiro / picking): só código, sem nome — servem
  // pra apontar o pedido na expedição.
  const pendentes = await db.select({ numero: sapPedidosPendentes.numero, tipo: sapPedidosPendentes.tipo }).from(sapPedidosPendentes)
  const pendentePorNumero = new Map(pendentes.map((p) => [p.numero, p.tipo === 'aprovacao' ? 'aguardando liberação do financeiro' : 'aguardando o estoque gerar o picking']))
  const desdeExp = new Date(Date.now() - 30 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  const noQuadro = await db
    .select({ numeros: expedicaoPedidos.pedidosSap, etapa: expedicaoPedidos.etapa, historico: expedicaoPedidos.historico })
    .from(expedicaoPedidos)
    .where(and(gte(expedicaoPedidos.inicioPrazo, desdeExp), ne(expedicaoPedidos.etapa, 'descartado'), ne(expedicaoPedidos.etapa, 'cancelado')))
  const etapaPorNumero = new Map<string, string>()
  for (const q of noQuadro) for (const n of q.numeros.split(',')) etapaPorNumero.set(n.trim(), q.historico ? 'já expedido' : q.etapa)
  const naExpedicao = (numero: string | null) => (numero ? (etapaPorNumero.get(numero) ?? pendentePorNumero.get(numero) ?? null) : null)

  const listaEmpresas = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas)
  const nomeEmpresa = new Map(listaEmpresas.map((e) => [e.id, e.nome]))
  const todos = await db
    .select({ id: clientes.id, empresaId: clientes.empresaId, codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, razaoSocial: clientes.razaoSocial, cnpj: clientes.cnpj })
    .from(clientes)
    .where(isNull(clientes.deletedAt))
  const porCodigoEmpresa = new Map<string, (typeof todos)[number][]>()
  for (const c of todos) {
    const k = `${c.empresaId}|${limpar(c.codigo)}`
    porCodigoEmpresa.set(k, [...(porCodigoEmpresa.get(k) ?? []), c])
  }
  const cadastroCerto = (empresaId: number, cardCode: string, cardName: string) => {
    const l = porCodigoEmpresa.get(`${empresaId}|${cardCode}`) ?? []
    return l.find((c) => nomeParecido(c.razaoSocial, cardName)) ?? null
  }
  const nomesUsuarios = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))

  // O cadastro É desse cliente do SAP? Código (ou o antigo) igual ao do SAP,
  // ou nome parecido (cadastro duplicado do mesmo cliente — não é troca).
  // Código igual ao do SAP mas nome diferente = cadastro errado, acusado
  // abaixo (cadastro_outro_nome) — não repete aqui na venda.
  const bate = (c: { codigo: string; codigoAntigo: string | null; razaoSocial: string }, p: PedidoSap) =>
    limpar(c.codigo) === p.cardCode || limpar(c.codigoAntigo) === p.cardCode || nomeParecido(c.razaoSocial, p.cardName)

  const itens: ItemTrocado[] = []
  const desdeVendas = new Date(Date.now() - DIAS * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  const linhas = await db
    .select({
      id: vendas.id,
      entry: vendas.pedidoSapEntry,
      numero: vendas.numeroPedido,
      valor: vendas.valorFechado,
      data: vendas.dataFechamento,
      auto: vendas.criadaPeloSap,
      vendedorId: vendas.vendedorId,
      clienteId: clientes.id,
      empresaId: clientes.empresaId,
      codigo: clientes.codigo,
      codigoAntigo: clientes.codigoAntigo,
      razaoSocial: clientes.razaoSocial,
      cnpj: clientes.cnpj,
    })
    .from(vendas)
    .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
    .where(and(isNull(vendas.deletedAt), gte(vendas.dataFechamento, desdeVendas), or(isNotNull(vendas.pedidoSapEntry), isNotNull(vendas.numeroPedido))))

  for (const v of linhas) {
    const ligado = v.entry != null
    const p = ligado ? porEntry.get(v.entry!) : (() => {
      const n = (v.numero ?? '').replace(/\D/g, '')
      return n.length >= 3 ? porNumero.get(n) : undefined
    })()
    if (!p || bate(v, p)) continue
    // Nº digitado sem estar ligado: só acusa se o nº do pedido é desses dias
    // (o mesmo nº pode ser de cupom/nota de outro sistema).
    if (!ligado && p.data && v.data && Math.abs(Date.parse(p.data) - Date.parse(v.data.slice(0, 10))) > 20 * 86400_000) continue
    const certo = cadastroCerto(v.empresaId, p.cardCode, p.cardName)
    const tipo: TipoTrocado = ligado ? 'venda_outro_cliente' : 'numero_outro_cliente'
    itens.push({
      chave: `${tipo}:${v.id}:${p.numero}`,
      tipo,
      empresaId: v.empresaId,
      empresa: nomeEmpresa.get(v.empresaId) ?? '',
      data: v.data.slice(0, 10),
      pedido: p.numero,
      valor: v.valor,
      clienteId: v.clienteId,
      clienteCodigo: v.codigo,
      clienteNome: v.razaoSocial,
      vendedor: nomesUsuarios.get(v.vendedorId) ?? null,
      vendaId: v.id,
      vendaAutomatica: v.auto,
      sapCodigo: p.cardCode,
      sapNome: p.cardName,
      certoId: certo?.id ?? null,
      certoNome: certo?.razaoSocial ?? null,
      naExpedicao: naExpedicao(p.numero),
      detalhe: ligado
        ? `A venda está no cadastro ${v.codigo} ${v.razaoSocial}, mas o pedido ${p.numero} no SAP é de ${p.cardCode} ${p.cardName}.${v.auto ? ' Venda criada pelo SAP (automática).' : ' Venda digitada e ligada ao pedido.'}`
        : `Venda digitada com o nº de pedido ${v.numero}, que no SAP é de ${p.cardCode} ${p.cardName}.`,
    })
  }

  // Cadastro com código do SAP de outro cliente: um código C… é UM cliente
  // no SAP; se o nome do cadastro não tem nada a ver, tudo desse código
  // (pedido, expedição, cotação, boleto) cai no cliente errado.
  const nomePorCodigo = new Map<string, PedidoSap>()
  for (const p of pedidos) if (p.cardName && ehCodigoSap(p.cardCode)) nomePorCodigo.set(p.cardCode, p)
  for (const c of todos) {
    const cod = limpar(c.codigo)
    const p = nomePorCodigo.get(cod)
    if (!p || nomeParecido(c.razaoSocial, p.cardName)) continue
    itens.push({
      chave: `cadastro_outro_nome:${c.id}:${cod}`,
      tipo: 'cadastro_outro_nome',
      empresaId: c.empresaId,
      empresa: nomeEmpresa.get(c.empresaId) ?? '',
      data: p.data,
      pedido: p.numero,
      valor: p.valor,
      clienteId: c.id,
      clienteCodigo: c.codigo,
      clienteNome: c.razaoSocial,
      vendedor: null,
      vendaId: null,
      vendaAutomatica: null,
      sapCodigo: p.cardCode,
      sapNome: p.cardName,
      certoId: null,
      certoNome: null,
      naExpedicao: naExpedicao(p.numero),
      detalhe: `O cadastro tem o código ${cod}, que no SAP é ${p.cardName}. Pedidos, expedição e cotações desse código aparecem neste cliente.`,
    })
  }

  // MEI: no CRM o nome é o da pessoa ("50.528.086 NUBIA ELLEN…"), no SAP o
  // da empresa ("AR KING…"). Com o SAP no ar, confere CNPJ e nome fantasia do
  // cliente do SAP e tira da lista o que é o mesmo cliente.
  const cnpjPorCliente = new Map<number, string>()
  for (const c of todos) if (c.cnpj) cnpjPorCliente.set(c.id, c.cnpj.replace(/\D/g, ''))
  for (const v of linhas) if (v.cnpj) cnpjPorCliente.set(v.clienteId, v.cnpj.replace(/\D/g, ''))
  const dadosSap = fonte === 'sap' ? await dadosClientesSap([...new Set(itens.map((i) => i.sapCodigo))]) : new Map<string, DadosClienteSap>()
  const mesmoCliente = (i: ItemTrocado) => {
    const d = dadosSap.get(i.sapCodigo)
    if (!d) return false
    const cnpj = cnpjPorCliente.get(i.clienteId)
    if (cnpj && cnpj.length >= 11 && d.documentos.includes(cnpj)) return true
    return d.outrosNomes.some((n) => nomeParecido(i.clienteNome, n))
  }
  const confirmados = itens.filter((i) => !mesmoCliente(i))
  itens.length = 0
  itens.push(...confirmados)

  itens.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''))
  const anterior = await ultimoResultado()
  const resultado: ResultadoTrocados = { rodadoEm: new Date().toISOString(), fonte, pedidosLidos: pedidos.length, itens }
  await setConfig(CHAVE_RESULTADO, JSON.stringify(resultado))
  if (opts.avisar && anterior) await avisarNovos(anterior, resultado)
  return resultado
}

// Sininho pra quem tem a tela liberada (superAdmin + admins com a feature),
// só dos casos NOVOS (que não estavam na rodada anterior nem foram marcados
// como "está certo").
async function avisarNovos(anterior: ResultadoTrocados, atual: ResultadoTrocados): Promise<void> {
  const ign = await lerIgnorados()
  const antes = new Set(anterior.itens.map((i) => i.chave))
  const novos = atual.itens.filter((i) => !antes.has(i.chave) && !ign[i.chave])
  if (!novos.length) return
  const supers = await db.select({ id: users.id }).from(users).where(and(eq(users.superAdmin, true), eq(users.isActive, true)))
  const comFeature = await db.select({ id: permissoesAdmin.userId }).from(permissoesAdmin).where(eq(permissoesAdmin.feature, FEATURE_PEDIDOS_TROCADOS))
  const ids = [...new Set([...supers.map((u) => u.id), ...comFeature.map((u) => u.id)])]
  if (!ids.length) return
  const ex = novos[0]
  const message =
    novos.length === 1
      ? `Pedido ${ex.pedido ?? ''}: no CRM está em ${ex.clienteNome}, no SAP é de ${ex.sapNome}. Veja em Pedidos trocados (SAP × CRM).`
      : `${novos.length} casos novos (ex.: pedido ${ex.pedido ?? ''} — CRM ${ex.clienteNome} × SAP ${ex.sapNome}). Veja em Pedidos trocados (SAP × CRM).`
  await db.insert(notifications).values(ids.map((id) => ({ vendedorId: id, type: 'pedidos_trocados', title: 'Pedido em cliente trocado', message })))
}

// Agendador: de 30 em 30 min, no horário comercial (seg–sáb 7h–20h).
let rodando = false
export async function rodarRevisaoTrocados(): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    const r = await revisarPedidosTrocados({ avisar: true })
    if (r.itens.length) console.log(`[pedidos-trocados] ${r.itens.length} caso(s) (${r.fonte}, ${r.pedidosLidos} pedidos lidos) — ${hojeBrString()}`)
  } catch (err) {
    console.error('[pedidos-trocados] erro:', err instanceof Error ? err.message : err)
  } finally {
    rodando = false
  }
}

