import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, funilMensal, itensPedido, users, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { getConfigTexto } from './configuracoes.js'
import { registrarAuditoria } from './auditoria.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'

// Venda automática a partir do pedido do SAP (pedido do João, 2026-10-30).
// O comparativo de 29/10 mostrou SAP R$ 173 mil × CRM R$ 85 mil na Joitec:
// os vendedores fazem o pedido no SAP e não registram no Kanban. Regras
// combinadas com o João:
//   - só pedidos a partir de `sap_vendas_auto_desde` ("daqui pra frente");
//   - Joitec, Odin Tubos e Odin Automação (Odin Compressores tem Pedidos);
//   - a venda conta pro vendedor DONO DO CLIENTE no CRM (o do card do mês);
//   - venda pra empresa do grupo (Comprefer etc.) não entra.
// Contra duplicidade:
//   1. vendas.pedidoSapEntry guarda o pedido — nunca cria duas vezes;
//   2. venda registrada na mão (mesmo cliente, de 5 dias antes a 15 depois, valor ±15% ou mesmo
//      nº de pedido) é LIGADA ao pedido em vez de criar outra;
//   3. registro manual depois é bloqueado (ver vendaJaVeioDoSap);
//   4. pedido cancelado no SAP: a venda criada por aqui sai; valor alterado:
//      atualiza (venda ligada a registro manual nunca é apagada).

const SLUG_POR_FILIAL: Record<number, string> = { 3: 'joitec', 4: 'odin-tubos' }
// Vendedoras da Odin Tubos às vezes tiram o pedido pela filial Joitec (3) —
// a venda conta pra Odin Tubos mesmo assim (João, 2026-10-30; em outubro:
// Luana 11, Ricardo 9, Yasmim Ramos 7, Gláucia 5...). Mesma ideia da Odin
// Automação. Códigos do SAP (SalesPersonCode), configurável em
// `sap_vendedores_odin_tubos`: 124 Karinna, 128 Luana, 153 Gláucia,
// 157 Tatiane, 158 Yasmim Salles, 159 Yasmim Ramos, 2036 Ricardo, 4 Bianca
// (PPR), 90 Arthur, 100 Debora, 150 Gabriel Mann e 151 CHP (representantes).
const VENDEDORES_ODIN_TUBOS_PADRAO = '124,128,153,157,158,159,2036,4,90,100,150,151'
const GRUPO_PADRAO = 'C003770,C002707,C001284,C001270'
const DIAS_PARA_TRAS = 7

interface PedidoSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  DocTime: string | null
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  PaymentGroupCode: number | null
  Cancelled: string
  DocumentLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; Price: number; LineTotal: number }[]
}

export interface SyncVendasResultado {
  desde: string
  pedidosNoSap: number
  criadas: number
  ligadas: number
  jaExistiam: number
  atualizadas: number
  canceladas: number
  faturadas: number
  semCliente: { pedido: number; codigo: string; nome: string; empresa: string }[]
  semVendedor: { pedido: number; cliente: string }[]
}

export async function vendedoresOdinTubosSap(): Promise<Set<number>> {
  return new Set(
    ((await getConfigTexto('sap_vendedores_odin_tubos')) ?? VENDEDORES_ODIN_TUBOS_PADRAO)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
  )
}

// Empresa do CRM de um pedido do SAP: a filial decide, mas na filial Joitec
// o vendedor manda (Odin Automação / Odin Tubos).
export function slugDoPedidoSap(filial: number, vendedor: number, automacao: Set<number>, odinTubos: Set<number>): string | undefined {
  const slug = SLUG_POR_FILIAL[filial]
  if (slug !== 'joitec') return slug
  if (automacao.has(vendedor)) return 'joitec-automacao'
  if (odinTubos.has(vendedor)) return 'odin-tubos'
  return slug
}

function brParaUtc(data: string, hora: string | null): string {
  return new Date(`${data}T${(hora ?? '12:00:00').slice(0, 8)}-03:00`).toISOString().replace('T', ' ').slice(0, 19)
}

// Usado pelo registro manual (funil.moverEtapa / vendas.registrar): já existe
// venda vinda do SAP pra esse cliente nesses dias com valor parecido?
export async function vendaJaVeioDoSap(clienteId: number, valor: number): Promise<{ numeroPedido: string | null } | null> {
  const de = new Date(Date.now() - 20 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  const lista = await db
    .select({ numeroPedido: vendas.numeroPedido, valor: vendas.valorFechado })
    .from(vendas)
    .where(and(eq(vendas.clienteId, clienteId), eq(vendas.criadaPeloSap, true), isNull(vendas.deletedAt), gte(vendas.dataFechamento, de)))
  const igual = lista.find((v) => Math.abs(v.valor - valor) <= Math.max(1, valor * 0.05))
  return igual ? { numeroPedido: igual.numeroPedido } : null
}

// `opts.desde`: carga avulsa de um período passado (script --desde), pedida
// pelo João em 2026-10-30 pra trazer as vendas que faltaram em outubro.
// `opts.docEntries`: só esses pedidos (botão "Criar venda" da Conferência SAP × CRM).
export async function sincronizarVendasSap(opts: { desde?: string; docEntries?: number[] } = {}): Promise<SyncVendasResultado | null> {
  const desdeConfig = await getConfigTexto('sap_vendas_auto_desde')
  if (!desdeConfig && !opts.desde) return null
  const hoje = hojeBrString()
  const janela = new Date(`${hoje}T12:00:00Z`)
  janela.setUTCDate(janela.getUTCDate() - DIAS_PARA_TRAS)
  const desde = opts.desde ?? (desdeConfig! > janela.toISOString().slice(0, 10) ? desdeConfig! : janela.toISOString().slice(0, 10))

  const grupo = new Set(((await getConfigTexto('sap_receber_ignorar_clientes')) ?? GRUPO_PADRAO).split(',').map((s) => s.trim().toUpperCase()))
  const automacao = await vendedoresAutomacaoSap()
  const odinTubos = await vendedoresOdinTubosSap()
  const lista = await db.query.empresas.findMany({ where: inArray(empresas.slug, ['joitec', 'odin-tubos', 'joitec-automacao']) })
  const empresaPorSlug = new Map(lista.map((e) => [e.slug, e]))
  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })

  const { pedidos, condicoes, notas } = await comSessaoSap(async (sap) => ({
    pedidos: await sap.getTodos<PedidoSap>(
      `/Orders?$filter=DocDate ge '${desde}' and (BPL_IDAssignedToInvoice eq 3 or BPL_IDAssignedToInvoice eq 4)` +
        (opts.docEntries?.length ? ` and (${opts.docEntries.map((e) => `DocEntry eq ${e}`).join(' or ')})` : '') +
        '&$select=DocEntry,DocNum,DocDate,DocTime,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,PaymentGroupCode,Cancelled,DocumentLines',
      100
    ),
    condicoes: new Map(
      (await sap.getTodos<{ GroupNumber: number; PaymentTermsGroupName: string }>('/PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName')).map((c) => [
        c.GroupNumber,
        c.PaymentTermsGroupName,
      ])
    ),
    // Notas dos últimos dias pra marcar a venda como faturada (nº da NF-e).
    notas: await sap.getTodos<{ SequenceSerial: number | null; DocNum: number; Cancelled: string; CancelStatus: string; DocumentLines: { BaseType: number; BaseEntry: number | null }[] }>(
      `/Invoices?$filter=DocDate ge '${desde}' and Cancelled eq 'tNO'&$select=SequenceSerial,DocNum,Cancelled,CancelStatus,DocumentLines`,
      100
    ),
  }))

  const r: SyncVendasResultado = { desde, pedidosNoSap: pedidos.length, criadas: 0, ligadas: 0, jaExistiam: 0, atualizadas: 0, canceladas: 0, faturadas: 0, semCliente: [], semVendedor: [] }

  const entries = pedidos.map((p) => p.DocEntry)
  const existentes = entries.length
    ? await db.select().from(vendas).where(and(inArray(vendas.pedidoSapEntry, entries), isNull(vendas.deletedAt)))
    : []
  const porEntry = new Map(existentes.map((v) => [v.pedidoSapEntry!, v]))

  // Um mesmo cliente às vezes tem MAIS DE UM cadastro na empresa (ex.: TC
  // Manutec na Odin Automação com o código antigo 5503 e com o C004638 do
  // SAP — a Pamela registrou a venda no antigo). Todos os cadastros
  // equivalentes contam: código do SAP, código antigo (inclusive o que outra
  // empresa do CRM liga a esse código) e mesma razão social.
  type Cli = { id: number; codigo: string; codigoAntigo: string | null; razaoSocial: string; vendedorAtualId: number | null }
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const todos = await db.query.clientes.findMany({
    where: isNull(clientes.deletedAt),
    columns: { id: true, empresaId: true, codigo: true, codigoAntigo: true, razaoSocial: true, vendedorAtualId: true },
  })
  const antigosDoSap = new Map<string, Set<string>>()
  for (const c of todos) {
    if (!c.codigoAntigo) continue
    const k = limparCodigo(c.codigo)
    antigosDoSap.set(k, (antigosDoSap.get(k) ?? new Set()).add(limparCodigo(c.codigoAntigo)))
  }
  const porEmpresa = new Map<number, { cod: Map<string, Cli[]>; nome: Map<string, Cli[]> }>()
  for (const c of todos) {
    const m = porEmpresa.get(c.empresaId) ?? { cod: new Map(), nome: new Map() }
    for (const cod of [c.codigo, c.codigoAntigo]) {
      if (!cod) continue
      for (const k of new Set([limparCodigo(cod), semZerosEsquerda(limparCodigo(cod))])) m.cod.set(k, [...(m.cod.get(k) ?? []), c])
    }
    const n = norm(c.razaoSocial)
    if (n.length >= 6) m.nome.set(n, [...(m.nome.get(n) ?? []), c])
    porEmpresa.set(c.empresaId, m)
  }
  const equivalentes = (empresaId: number, codigo: string, nome: string): Cli[] => {
    const m = porEmpresa.get(empresaId)
    if (!m) return []
    const chaves = new Set([codigo, semZerosEsquerda(codigo), ...(antigosDoSap.get(codigo) ?? [])])
    const achados = new Map<number, Cli>()
    for (const k of chaves) for (const c of m.cod.get(k) ?? []) achados.set(c.id, c)
    for (const c of m.nome.get(norm(nome)) ?? []) achados.set(c.id, c)
    return [...achados.values()]
  }

  for (const p of pedidos) {
    if (grupo.has(p.CardCode.toUpperCase())) continue
    const ja = porEntry.get(p.DocEntry)

    // Pedido cancelado no SAP: some a venda que o CRM criou sozinho.
    if (p.Cancelled === 'tYES') {
      if (ja?.criadaPeloSap) {
        await db.update(vendas).set({ deletedAt: agoraSqlite() }).where(eq(vendas.id, ja.id))
        await registrarAuditoria({ tabela: 'vendas', registroId: ja.id, acao: 'excluir', valorNovo: `pedido ${p.DocNum} cancelado no SAP`, alteradoPor: autor?.id ?? null })
        r.canceladas++
      }
      continue
    }
    if (ja) {
      if (ja.criadaPeloSap && Math.abs(ja.valorFechado - p.DocTotal) > 0.009) {
        await db.update(vendas).set({ valorFechado: p.DocTotal }).where(eq(vendas.id, ja.id))
        r.atualizadas++
      } else r.jaExistiam++
      continue
    }

    const slug = slugDoPedidoSap(p.BPL_IDAssignedToInvoice, p.SalesPersonCode, automacao, odinTubos)
    const empresa = slug ? empresaPorSlug.get(slug) : undefined
    if (!empresa) continue

    const codigo = limparCodigo(p.CardCode)
    const cadastros = equivalentes(empresa.id, codigo, p.CardName)
    if (!cadastros.length) {
      r.semCliente.push({ pedido: p.DocNum, codigo, nome: p.CardName, empresa: empresa.nome })
      continue
    }

    const dia = dataSap(p.DocDate)
    const dataFechamento = brParaUtc(dia, p.DocTime)
    const mesReferencia = `${dia.slice(0, 7)}-01`

    // Venda já registrada na mão? Liga em vez de criar outra.
    // O vendedor às vezes registra no CRM dias depois do pedido (até 4–5 dias
    // depois, passando por fim de semana, nos dados de outubro).
    const de = brParaUtc(addDias(dia, -5), '00:00:00')
    const ate = brParaUtc(addDias(dia, 15), '23:59:59')
    const idsCadastros = cadastros.map((c) => c.id)
    // Cadastro "principal": o que tem card neste mês (de preferência Fechado);
    // senão o do código do SAP; senão o primeiro com vendedor.
    const cardsDoMes = await db
      .select()
      .from(funilMensal)
      .where(and(inArray(funilMensal.clienteId, idsCadastros), eq(funilMensal.mesReferencia, mesReferencia), isNull(funilMensal.deletedAt)))
      .orderBy(desc(funilMensal.id))
    const cardPreferido = cardsDoMes.find((c) => c.etapa === 'fechado') ?? cardsDoMes[0]
    const cliente =
      (cardPreferido && cadastros.find((c) => c.id === cardPreferido.clienteId)) ??
      cadastros.find((c) => limparCodigo(c.codigo) === codigo && c.vendedorAtualId) ??
      cadastros.find((c) => c.vendedorAtualId) ??
      cadastros[0]
    const manuais = await db
      .select()
      .from(vendas)
      .where(and(inArray(vendas.clienteId, idsCadastros), isNull(vendas.deletedAt), isNull(vendas.pedidoSapEntry), gte(vendas.dataFechamento, de), lte(vendas.dataFechamento, ate)))
    // Mesmo pedido: nº do pedido igual; senão valor até 15% diferente; senão,
    // se o cliente tem UMA venda manual e UM pedido do SAP nesses dias, é a
    // mesma venda com valor digitado diferente (ex.: Retema 2.789 × 2.637).
    const pedidosDoClienteNaJanela = pedidos.filter(
      (o) => o.Cancelled !== 'tYES' && o.CardCode === p.CardCode && dataSap(o.DocDate) >= addDias(dia, -15) && dataSap(o.DocDate) <= addDias(dia, 5)
    ).length
    const manual =
      manuais.find((v) => v.numeroPedido && v.numeroPedido.replace(/\D/g, '') === String(p.DocNum)) ??
      [...manuais].sort((a, b) => Math.abs(a.valorFechado - p.DocTotal) - Math.abs(b.valorFechado - p.DocTotal)).find((v) => Math.abs(v.valorFechado - p.DocTotal) <= p.DocTotal * 0.15) ??
      (manuais.length === 1 && pedidosDoClienteNaJanela === 1 ? manuais[0] : undefined)
    if (manual) {
      // O valor oficial é o do pedido do SAP — corrige o digitado (fica na auditoria).
      if (Math.abs(manual.valorFechado - p.DocTotal) > 0.009) {
        await registrarAuditoria({
          tabela: 'vendas',
          registroId: manual.id,
          acao: 'editar',
          campo: 'valor_fechado',
          valorAnterior: String(manual.valorFechado),
          valorNovo: `${p.DocTotal} (pedido ${p.DocNum} do SAP)`,
          alteradoPor: autor?.id ?? null,
        })
      }
      await db
        .update(vendas)
        .set({ pedidoSapEntry: p.DocEntry, numeroPedido: manual.numeroPedido ?? String(p.DocNum), valorFechado: p.DocTotal })
        .where(eq(vendas.id, manual.id))
      const temItens = await db.select({ id: itensPedido.id }).from(itensPedido).where(and(eq(itensPedido.vendaId, manual.id), isNull(itensPedido.deletedAt))).limit(1)
      if (!temItens.length) await gravarItens(manual.id, manual.clienteId, p)
      r.ligadas++
      continue
    }

    // Card do cliente no mês: o que já está Fechado; senão o mais recente.
    let card = cardPreferido
    if (!card) {
      if (!cliente.vendedorAtualId) {
        r.semVendedor.push({ pedido: p.DocNum, cliente: cliente.razaoSocial })
        continue
      }
      const novo = await db.insert(funilMensal).values({ clienteId: cliente.id, vendedorId: cliente.vendedorAtualId, mesReferencia, etapa: 'fechado', dataEntradaEtapa: agoraSqlite() })
      card = (await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, Number(novo.lastInsertRowid)) }))!
    } else if (card.etapa !== 'fechado') {
      await db
        .update(funilMensal)
        .set({ etapa: 'fechado', dataEntradaEtapa: agoraSqlite(), updatedAt: agoraSqlite(), versao: sql`${funilMensal.versao} + 1` })
        .where(eq(funilMensal.id, card.id))
      await registrarAuditoria({
        tabela: 'funil_mensal',
        registroId: card.id,
        acao: 'mudar_etapa',
        campo: 'etapa',
        valorAnterior: card.etapa,
        valorNovo: `fechado (pedido ${p.DocNum} do SAP)`,
        alteradoPor: autor?.id ?? null,
      })
    }

    const res = await db.insert(vendas).values({
      funilMensalId: card.id,
      clienteId: cliente.id,
      vendedorId: card.vendedorId,
      mesReferencia,
      valorFechado: p.DocTotal,
      condicaoPagamento: (p.PaymentGroupCode != null ? condicoes.get(p.PaymentGroupCode) : null) ?? null,
      numeroPedido: String(p.DocNum),
      dataFechamento,
      pedidoSapEntry: p.DocEntry,
      criadaPeloSap: true,
    })
    const vendaId = Number(res.lastInsertRowid)
    await gravarItens(vendaId, cliente.id, p)
    await db
      .update(clientes)
      .set({ dataUltimaCompra: sql`max(coalesce(${clientes.dataUltimaCompra}, ''), ${dataFechamento})` })
      .where(eq(clientes.id, cliente.id))
    await registrarAuditoria({ tabela: 'vendas', registroId: vendaId, acao: 'criar', valorNovo: `pedido ${p.DocNum} do SAP`, alteradoPor: autor?.id ?? null })
    r.criadas++
  }
  // Pedido que já virou nota: a venda fica faturada com o nº da NF-e.
  const nfPorPedido = new Map<number, string>()
  for (const n of notas) {
    if (n.CancelStatus === 'csCancellation') continue
    for (const l of n.DocumentLines) if (l.BaseType === 17 && l.BaseEntry != null && !nfPorPedido.has(l.BaseEntry)) nfPorPedido.set(l.BaseEntry, String(n.SequenceSerial || n.DocNum))
  }
  if (nfPorPedido.size) {
    const semNf = await db
      .select({ id: vendas.id, entry: vendas.pedidoSapEntry })
      .from(vendas)
      .where(and(inArray(vendas.pedidoSapEntry, [...nfPorPedido.keys()]), isNull(vendas.numeroNotaFiscal), isNull(vendas.deletedAt)))
    for (const v of semNf) {
      await db.update(vendas).set({ numeroNotaFiscal: nfPorPedido.get(v.entry!)!, tipoComprovante: 'nota_fiscal', faturado: true }).where(eq(vendas.id, v.id))
      r.faturadas++
    }
  }
  return r
}

async function gravarItens(vendaId: number, clienteId: number, p: PedidoSap) {
  const linhas = p.DocumentLines.filter((l) => l.Quantity > 0)
  if (!linhas.length) return
  await db.insert(itensPedido).values(
    linhas.map((l) => ({
      vendaId,
      clienteId,
      descricao: (l.ItemDescription ?? '').trim() || l.ItemCode || '(sem descrição)',
      quantidade: l.Quantity,
      valorUnitario: l.Price,
      valorTotal: l.LineTotal,
    }))
  )
}

function addDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
