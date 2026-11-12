import { and, between, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sapEstoqueItens, sapItemMovimentos } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'
import { hojeBrString } from './dataBr.js'
import { comSessaoSap, dataSap, type SapSessao } from './sapServiceLayer.js'

// Estoque e giro por item no SAP — pedido do João, 2026-11-10: itens que
// menos venderam (30/60/90 dias ou período escolhido), estoque sem venda há
// mais de 60 dias e tempo de estoque (há quanto tempo está parado e pra
// quantos meses o estoque dá). Só depósitos de Revenda (*-REV), escolha dele.
//
// Duas tabelas (schema.ts):
//   - sap_estoque_itens: foto do estoque de Revenda por filial, refeita de
//     hora em hora (2.400 itens, ~30 s no SAP);
//   - sap_item_movimentos: vendas (todas as notas, de qualquer cliente) e
//     entradas (nota de entrada, entrada de mercadoria e transferência vinda
//     de outra filial) por documento.
// As vendas recentes vêm da rodada de itens que já existe (sapSyncItens.ts
// chama gravarVendasDasNotas com as notas que ele já baixou — não busca de
// novo). O histórico desde a implantação do SAP (31/03/2026) entra aos
// poucos, 15 dias por rodada: só as notas de outubro levam ~2 min no SAP, e
// a sessão do SAP é uma por vez (comSessaoSap), então uma carga única de
// ~17 min travaria a expedição e as outras rotinas.

export const SAP_INICIO = '2026-03-31'
const CHAVE_FOTO = 'sap_estoque_atualizado_em'
// Até que dia o histórico (vendas + entradas) já foi carregado. Vazio = nada.
const CHAVE_HISTORICO = 'sap_estoque_historico_ate'
const DIAS_POR_RODADA = 15
// Devoluções já carregadas desde a implantação (vazio = carregar tudo).
const CHAVE_DEVOLUCOES = 'sap_estoque_devolucoes_desde'
// Entradas recentes: margem pra trás, pra pegar documento lançado com data
// de dias anteriores.
const DIAS_ENTRADAS_RECENTES = 5

// Empresa do CRM → filial do SAP. A Odin Automação vende pelo CNPJ e pelo
// estoque da Joitec (filial 3).
const FILIAL_POR_SLUG: Record<string, number> = { joitec: 3, 'joitec-automacao': 3, 'odin-tubos': 4, 'odin-compressores': 1, compretec: 5 }
export const filialDaEmpresa = (slug: string): number | null => FILIAL_POR_SLUG[slug] ?? null

const ehRevenda = (deposito: string) => /-REV$/.test(deposito)
// Mercadoria entra na filial pelo Recebimento ou direto na Revenda.
const ehDepositoDeEntrada = (deposito: string) => /-(REV|REC)$/.test(deposito)

type Movimento = typeof sapItemMovimentos.$inferInsert

export interface NotaVendaSap {
  DocEntry: number
  DocDate: string
  BPL_IDAssignedToInvoice: number
  Cancelled?: string
  CancelStatus?: string
  DocumentLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; LineTotal: number }[]
}

interface DocEntradaSap {
  DocEntry: number
  DocDate: string
  Cancelled?: string
  CancelStatus?: string
  DocumentLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; LineTotal: number; WarehouseCode: string | null }[]
}

interface TransferenciaSap {
  DocEntry: number
  DocDate: string
  StockTransferLines: { ItemCode: string | null; ItemDescription: string | null; Quantity: number; WarehouseCode: string | null; FromWarehouseCode: string | null }[]
}

const cancelado = (d: { Cancelled?: string; CancelStatus?: string }) => d.Cancelled === 'tYES' || d.CancelStatus === 'csCancellation'

function somarPorItem(linhas: Movimento[]): Movimento[] {
  const mapa = new Map<string, Movimento>()
  for (const l of linhas) {
    const chave = `${l.origem}|${l.docEntry}|${l.filial}|${l.itemCodigo}`
    const atual = mapa.get(chave)
    if (atual) {
      atual.quantidade += l.quantidade
      atual.valor += l.valor
    } else mapa.set(chave, { ...l })
  }
  return [...mapa.values()]
}

// Troca os movimentos dessas origens no período pelos que vieram agora.
async function substituir(origens: Movimento['origem'][], de: string, ate: string, linhas: Movimento[]) {
  await db.transaction(async (tx) => {
    await tx.delete(sapItemMovimentos).where(and(inArray(sapItemMovimentos.origem, origens), between(sapItemMovimentos.dia, de, ate)))
    for (let i = 0; i < linhas.length; i += 500) await tx.insert(sapItemMovimentos).values(linhas.slice(i, i + 500))
  })
}

// Vendas de TODAS as notas de saída do período (nota cancelada e o
// documento de cancelamento ficam de fora; devolução não entra, igual ao
// relatório de itens). Chamada pela rodada de itens com as notas que ela já
// baixou e pela carga do histórico.
export async function gravarVendasDasNotas(notas: NotaVendaSap[], de: string, ate: string): Promise<number> {
  const linhas: Movimento[] = []
  for (const n of notas) {
    if (cancelado(n)) continue
    for (const l of n.DocumentLines) {
      if (!l.ItemCode) continue
      linhas.push({
        tipo: 'venda',
        origem: 'nota',
        docEntry: n.DocEntry,
        filial: n.BPL_IDAssignedToInvoice,
        itemCodigo: l.ItemCode,
        itemNome: (l.ItemDescription ?? '').trim() || null,
        dia: dataSap(n.DocDate),
        quantidade: l.Quantity ?? 0,
        valor: l.LineTotal ?? 0,
      })
    }
  }
  const somadas = somarPorItem(linhas)
  await substituir(['nota'], de, ate, somadas)
  return somadas.length
}

// Devoluções de cliente (CreditNotes) descontam da venda: entram como
// 'venda' com quantidade e valor negativos (João, 2026-11-11 — o AD2012
// teve 50 devolvidas em outubro que contavam como vendidas).
async function gravarDevolucoes(sap: SapSessao, de: string, ate: string): Promise<number> {
  const docs = await sap.getTodos<NotaVendaSap>(
    `/CreditNotes?$select=DocEntry,DocDate,BPL_IDAssignedToInvoice,Cancelled,CancelStatus,DocumentLines&$filter=${filtroPeriodo(de, ate)}&$orderby=DocEntry`,
    200
  )
  const linhas: Movimento[] = []
  for (const d of docs) {
    if (cancelado(d)) continue
    for (const l of d.DocumentLines) {
      if (!l.ItemCode) continue
      linhas.push({
        tipo: 'venda',
        origem: 'devolucao',
        docEntry: d.DocEntry,
        filial: d.BPL_IDAssignedToInvoice,
        itemCodigo: l.ItemCode,
        itemNome: (l.ItemDescription ?? '').trim() || null,
        dia: dataSap(d.DocDate),
        quantidade: -(l.Quantity ?? 0),
        valor: -(l.LineTotal ?? 0),
      })
    }
  }
  const somadas = somarPorItem(linhas)
  await substituir(['devolucao'], de, ate, somadas)
  return somadas.length
}

// Nota cancelada no SAP depois que já entrou aqui (a rodada de itens só olha
// os últimos dias): tira. Busca só o DocEntry dos cancelados desde a
// implantação — leve, roda junto com a foto de hora em hora.
async function tirarCanceladas(sap: SapSessao): Promise<number> {
  let tiradas = 0
  // Nota de entrada cancelada depois de 5 dias também ficava (auditoria
  // 2026-11-11: S000022, nota de entrada 2513 cancelada).
  for (const [entidade, origem] of [
    ['Invoices', 'nota'],
    ['CreditNotes', 'devolucao'],
    ['PurchaseInvoices', 'compra'],
    ['InventoryGenEntries', 'entrada'],
  ] as const) {
    const canceladas = await sap.getTodos<{ DocEntry: number }>(`/${entidade}?$select=DocEntry&$filter=Cancelled eq 'tYES' and DocDate ge '${SAP_INICIO}'`, 500)
    const ids = canceladas.map((c) => c.DocEntry)
    for (let i = 0; i < ids.length; i += 500) {
      const r = await db.delete(sapItemMovimentos).where(and(eq(sapItemMovimentos.origem, origem), inArray(sapItemMovimentos.docEntry, ids.slice(i, i + 500))))
      tiradas += r.rowsAffected ?? 0
    }
  }
  return tiradas
}

async function depositosPorFilial(sap: SapSessao): Promise<Map<string, number>> {
  const lista = await sap.getTodos<{ WarehouseCode: string; BusinessPlaceID: number | null }>('/Warehouses?$select=WarehouseCode,BusinessPlaceID', 100)
  return new Map(lista.filter((w) => w.BusinessPlaceID != null).map((w) => [w.WarehouseCode, w.BusinessPlaceID!]))
}

const filtroPeriodo = (de: string, ate: string) => `DocDate ge '${de}' and DocDate le '${ate}'`

async function buscarNotasVenda(sap: SapSessao, de: string, ate: string) {
  return sap.getTodos<NotaVendaSap>(
    `/Invoices?$select=DocEntry,DocDate,BPL_IDAssignedToInvoice,Cancelled,CancelStatus,DocumentLines&$filter=${filtroPeriodo(de, ate)}&$orderby=DocEntry`,
    200
  )
}

async function buscarEntradas(sap: SapSessao, depositos: Map<string, number>, de: string, ate: string): Promise<Movimento[]> {
  const linhas: Movimento[] = []
  const docs: [Movimento['origem'], string][] = [
    ['compra', 'PurchaseInvoices'],
    ['entrada', 'InventoryGenEntries'],
  ]
  for (const [origem, entidade] of docs) {
    const lista = await sap.getTodos<DocEntradaSap>(`/${entidade}?$select=DocEntry,DocDate,Cancelled,CancelStatus,DocumentLines&$filter=${filtroPeriodo(de, ate)}&$orderby=DocEntry`, 200)
    for (const d of lista) {
      if (cancelado(d)) continue
      for (const l of d.DocumentLines) {
        const filial = l.WarehouseCode ? depositos.get(l.WarehouseCode) : undefined
        if (!l.ItemCode || !filial || !ehDepositoDeEntrada(l.WarehouseCode!)) continue
        linhas.push({ tipo: 'entrada', origem, docEntry: d.DocEntry, filial, itemCodigo: l.ItemCode, itemNome: (l.ItemDescription ?? '').trim() || null, dia: dataSap(d.DocDate), quantidade: l.Quantity ?? 0, valor: l.LineTotal ?? 0 })
      }
    }
  }
  // Transferência só conta quando vem de OUTRA filial (Recebimento →
  // Revenda da mesma filial não é mercadoria nova).
  const transf = await sap.getTodos<TransferenciaSap>(`/StockTransfers?$select=DocEntry,DocDate,StockTransferLines&$filter=${filtroPeriodo(de, ate)}&$orderby=DocEntry`, 200)
  for (const t of transf) {
    for (const l of t.StockTransferLines) {
      const para = l.WarehouseCode ? depositos.get(l.WarehouseCode) : undefined
      const de_ = l.FromWarehouseCode ? depositos.get(l.FromWarehouseCode) : undefined
      if (!l.ItemCode || !para || para === de_ || !ehDepositoDeEntrada(l.WarehouseCode!)) continue
      linhas.push({ tipo: 'entrada', origem: 'transferencia', docEntry: t.DocEntry, filial: para, itemCodigo: l.ItemCode, itemNome: (l.ItemDescription ?? '').trim() || null, dia: dataSap(t.DocDate), quantidade: l.Quantity ?? 0, valor: 0 })
    }
  }
  return somarPorItem(linhas)
}

// Itens usados pra montar outros (componentes das estruturas de produção do
// SAP — ProductTrees). Ficam guardados na Revenda, mas saem pela montagem e
// não por venda, então apareceriam como parados. O João pediu (2026-11-10)
// pra tirar das três abas; o produto montado continua.
// E (2026-11-11) só entra item com Tipo de material "0 - Mercadoria para
// Revenda" no cadastro do SAP (Items.MaterialType = mt_GoodsForReseller);
// matéria-prima, embalagem, uso e consumo, produto acabado etc. ficam fora.
// O filtro vale só nas abas do relatório: a foto (sap_estoque_itens) guarda
// tudo da Revenda, porque as Cotações usam o saldo dela.
const CHAVE_COMPONENTES = 'sap_estoque_componentes'
async function componentesDeMontagem(sap: SapSessao): Promise<Set<string>> {
  const arvores = await sap.getTodos<{ TreeCode: string; ProductTreeLines?: { ItemCode: string | null }[] }>('/ProductTrees?$select=TreeCode,ProductTreeLines', 100)
  const codigos = new Set<string>()
  for (const a of arvores) for (const l of a.ProductTreeLines ?? []) if (l.ItemCode) codigos.add(l.ItemCode)
  const naoRevenda = await sap.getTodos<{ ItemCode: string }>("/Items?$select=ItemCode&$filter=MaterialType ne 'mt_GoodsForReseller'", 200)
  for (const i of naoRevenda) codigos.add(i.ItemCode)
  // Grupos de itens ATIVO e CONSUMO também ficam fora, mesmo com tipo "0"
  // (João, 2026-11-12: Espanador CON000368, moldes I000952/53/54).
  const grupos = await sap.getTodos<{ Number: number; GroupName: string }>('/ItemGroups?$select=Number,GroupName', 200)
  for (const g of grupos.filter((g) => ['ATIVO', 'CONSUMO'].includes(g.GroupName.trim().toUpperCase()))) {
    const doGrupo = await sap.getTodos<{ ItemCode: string }>(`/Items?$select=ItemCode&$filter=ItemsGroupCode eq ${g.Number}`, 500)
    for (const i of doGrupo) codigos.add(i.ItemCode)
  }
  await setConfig(CHAVE_COMPONENTES, JSON.stringify([...codigos].sort()))
  return codigos
}
async function componentesGravados(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await getConfigTexto(CHAVE_COMPONENTES)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

async function fotoEstoque(sap: SapSessao, depositos: Map<string, number>): Promise<number> {
  const itens = await sap.getTodos<{
    ItemCode: string
    ItemName: string | null
    U_CodigoAntigo?: string | null
    ItemWarehouseInfoCollection: { WarehouseCode: string; InStock: number; Committed?: number; StandardAveragePrice: number | null }[]
  }>('/Items?$select=ItemCode,ItemName,U_CodigoAntigo,ItemWarehouseInfoCollection&$filter=QuantityOnStock gt 0', 200)
  await componentesDeMontagem(sap)
  const agora = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const linhas = new Map<string, typeof sapEstoqueItens.$inferInsert>()
  for (const it of itens) {
    for (const w of it.ItemWarehouseInfoCollection ?? []) {
      const filial = depositos.get(w.WarehouseCode)
      if (!filial || !ehRevenda(w.WarehouseCode) || !(w.InStock > 0)) continue
      const chave = `${filial}|${it.ItemCode}`
      const l = linhas.get(chave) ?? { filial, itemCodigo: it.ItemCode, itemNome: it.ItemName?.trim() || null, codigoAntigo: it.U_CodigoAntigo?.trim() || null, quantidade: 0, disponivel: 0, valor: 0, atualizadoEm: agora }
      l.quantidade += w.InStock
      // Disponível = físico − reservado em pedidos (o que o SAP deixa vender;
      // usado nas Cotações, 2026-11-10).
      l.disponivel = (l.disponivel ?? 0) + Math.max(0, w.InStock - (w.Committed ?? 0))
      l.valor += w.InStock * (w.StandardAveragePrice ?? 0)
      linhas.set(chave, l)
    }
  }
  const lista = [...linhas.values()]
  await db.transaction(async (tx) => {
    await tx.delete(sapEstoqueItens)
    for (let i = 0; i < lista.length; i += 500) await tx.insert(sapEstoqueItens).values(lista.slice(i, i + 500))
  })
  await setConfig(CHAVE_FOTO, agora)
  return lista.length
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function situacaoHistoricoEstoque(): Promise<{ fotoEm: string | null; historicoAte: string | null; completo: boolean }> {
  const [fotoEm, historicoAte] = await Promise.all([getConfigTexto(CHAVE_FOTO), getConfigTexto(CHAVE_HISTORICO)])
  return { fotoEm, historicoAte, completo: !!historicoAte && historicoAte >= hojeBrString() }
}

// Rodada (scheduler, de 15 em 15 min): foto do estoque + entradas recentes
// se a última foto tem mais de 55 min; e mais 15 dias do histórico enquanto
// ele não chegou em hoje.
// `diasPorRodada`: carga avulsa do histórico (scripts/carregarEstoqueSap.ts).
export async function sincronizarEstoqueSap(opts: { diasPorRodada?: number } = {}): Promise<{ itensEstoque: number | null; entradas: number | null; historico: { de: string; ate: string; vendas: number; entradas: number } | null }> {
  const hoje = hojeBrString()
  const fotoEm = await getConfigTexto(CHAVE_FOTO)
  const fazerFoto = !fotoEm || Date.now() - Date.parse(`${fotoEm.replace(' ', 'T')}Z`) > 55 * 60_000
  const historicoAte = await getConfigTexto(CHAVE_HISTORICO)
  const proximo = historicoAte ? somarDias(historicoAte, 1) : SAP_INICIO
  const fazerHistorico = proximo <= hoje
  if (!fazerFoto && !fazerHistorico) return { itensEstoque: null, entradas: null, historico: null }

  return comSessaoSap(async (sap) => {
    const depositos = await depositosPorFilial(sap)
    let itensEstoque: number | null = null
    let entradas: number | null = null
    if (fazerFoto) {
      itensEstoque = await fotoEstoque(sap, depositos)
      const de = somarDias(hoje, -DIAS_ENTRADAS_RECENTES)
      const linhas = await buscarEntradas(sap, depositos, de, hoje)
      await substituir(['compra', 'entrada', 'transferencia'], de, hoje, linhas)
      entradas = linhas.length
      // Devoluções: na 1ª vez, desde a implantação (são poucas); depois, só
      // os últimos dias, junto com as entradas.
      const devolucoesCarregadas = await getConfigTexto(CHAVE_DEVOLUCOES)
      await gravarDevolucoes(sap, devolucoesCarregadas ? de : SAP_INICIO, hoje)
      if (!devolucoesCarregadas) await setConfig(CHAVE_DEVOLUCOES, hoje)
      await tirarCanceladas(sap)
    }
    let historico = null
    if (fazerHistorico) {
      const ate = [somarDias(proximo, (opts.diasPorRodada ?? DIAS_POR_RODADA) - 1), hoje].sort()[0]
      const notas = await buscarNotasVenda(sap, proximo, ate)
      const vendas = await gravarVendasDasNotas(notas, proximo, ate)
      await gravarDevolucoes(sap, proximo, ate)
      const linhas = await buscarEntradas(sap, depositos, proximo, ate)
      await substituir(['compra', 'entrada', 'transferencia'], proximo, ate, linhas)
      await setConfig(CHAVE_HISTORICO, ate)
      historico = { de: proximo, ate, vendas, entradas: linhas.length }
    }
    return { itensEstoque, entradas, historico }
  })
}

// ── Consultas do relatório ────────────────────────────────────────────────

export interface ItemEstoque {
  codigo: string
  codigoAntigo: string | null
  descricao: string
  estoque: number
  valor: number | null
  ultimaVenda: string | null
  ultimaEntrada: string | null
  // Dia em que entrou a unidade mais antiga que ainda está no estoque
  // (contando as entradas de trás pra frente até somar o estoque atual).
  estoqueDesde: string
  // Estoque anterior à implantação do SAP (ou maior que as entradas que o
  // SAP registrou): a data real é mais antiga que 31/03/2026.
  desdeImplantacao: boolean
  mesesEmEstoque: number
  vendido90: number
  mediaMes: number
  coberturaMeses: number | null
}

const DIAS_MES = 30.44
const mesesEntre = (de: string, ate: string) => Math.round(((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000 / DIAS_MES) * 10) / 10

async function nomesDosItens(filial: number): Promise<Map<string, string>> {
  const linhas = await db
    .select({ item: sapItemMovimentos.itemCodigo, nome: sql<string | null>`max(${sapItemMovimentos.itemNome})` })
    .from(sapItemMovimentos)
    .where(eq(sapItemMovimentos.filial, filial))
    .groupBy(sapItemMovimentos.itemCodigo)
  return new Map(linhas.filter((l) => l.nome).map((l) => [l.item, l.nome!]))
}

export async function estoqueDaFilial(filial: number, verValor: boolean): Promise<ItemEstoque[]> {
  const hoje = hojeBrString()
  const desde90 = somarDias(hoje, -90)
  const [estoqueTodo, ultimas, entradas, vendas90, fora] = await Promise.all([
    db.select().from(sapEstoqueItens).where(eq(sapEstoqueItens.filial, filial)),
    db
      .select({ item: sapItemMovimentos.itemCodigo, origem: sapItemMovimentos.origem, ultimo: sql<string>`max(${sapItemMovimentos.dia})` })
      .from(sapItemMovimentos)
      .where(eq(sapItemMovimentos.filial, filial))
      .groupBy(sapItemMovimentos.itemCodigo, sapItemMovimentos.origem),
    db
      .select({ item: sapItemMovimentos.itemCodigo, dia: sapItemMovimentos.dia, quantidade: sql<number>`sum(${sapItemMovimentos.quantidade})`.mapWith(Number) })
      .from(sapItemMovimentos)
      .where(and(eq(sapItemMovimentos.filial, filial), eq(sapItemMovimentos.tipo, 'entrada')))
      .groupBy(sapItemMovimentos.itemCodigo, sapItemMovimentos.dia),
    db
      .select({ item: sapItemMovimentos.itemCodigo, quantidade: sql<number>`sum(${sapItemMovimentos.quantidade})`.mapWith(Number) })
      .from(sapItemMovimentos)
      .where(and(eq(sapItemMovimentos.filial, filial), eq(sapItemMovimentos.tipo, 'venda'), gte(sapItemMovimentos.dia, desde90)))
      .groupBy(sapItemMovimentos.itemCodigo),
    componentesGravados(),
  ])
  const estoque = estoqueTodo.filter((e) => !fora.has(e.itemCodigo))
  // Última venda = última nota de saída (devolução não conta como venda).
  const ultimaVenda = new Map(ultimas.filter((u) => u.origem === 'nota').map((u) => [u.item, u.ultimo]))
  const ultimaEntrada = new Map<string, string>()
  for (const u of ultimas) if (u.origem !== 'nota' && u.origem !== 'devolucao' && u.ultimo > (ultimaEntrada.get(u.item) ?? '')) ultimaEntrada.set(u.item, u.ultimo)
  const entradasPorItem = new Map<string, { dia: string; quantidade: number }[]>()
  for (const e of entradas) entradasPorItem.set(e.item, [...(entradasPorItem.get(e.item) ?? []), e])
  // Vendido − devolvido (nunca negativo).
  const vendido90 = new Map(vendas90.map((v) => [v.item, Math.max(0, v.quantidade)]))

  return estoque.map((e) => {
    // Estoque "mais antigo": soma as entradas da mais nova pra mais antiga
    // até cobrir o estoque atual (o que sai primeiro é o mais antigo).
    let falta = e.quantidade
    let desde: string | null = null
    for (const ent of (entradasPorItem.get(e.itemCodigo) ?? []).sort((a, b) => b.dia.localeCompare(a.dia))) {
      falta -= ent.quantidade
      if (falta <= 0.0001) {
        desde = ent.dia
        break
      }
    }
    const desdeImplantacao = !desde || desde <= SAP_INICIO
    const estoqueDesde = desdeImplantacao ? SAP_INICIO : desde!
    const v90 = vendido90.get(e.itemCodigo) ?? 0
    const mediaMes = Math.round((v90 / 90) * DIAS_MES * 100) / 100
    return {
      codigo: e.itemCodigo,
      codigoAntigo: e.codigoAntigo,
      descricao: e.itemNome ?? e.itemCodigo,
      estoque: e.quantidade,
      valor: verValor ? Math.round(e.valor * 100) / 100 : null,
      ultimaVenda: ultimaVenda.get(e.itemCodigo) ?? null,
      ultimaEntrada: ultimaEntrada.get(e.itemCodigo) ?? null,
      estoqueDesde,
      desdeImplantacao,
      mesesEmEstoque: mesesEntre(estoqueDesde, hoje),
      vendido90: v90,
      mediaMes,
      coberturaMeses: v90 > 0 ? Math.round((e.quantidade / mediaMes) * 10) / 10 : null,
    }
  })
}

export interface ItemMenosVendido {
  codigo: string
  codigoAntigo: string | null
  descricao: string
  quantidade: number
  valor: number
  notas: number
  estoque: number
  ultimaVenda: string | null
}

// Todos os itens que têm estoque de Revenda hoje ou que venderam alguma vez
// desde a implantação, com o que venderam no período (zero entra).
export async function menosVendidosDaFilial(filial: number, de: string, ate: string): Promise<ItemMenosVendido[]> {
  const [estoque, periodo, ultimas, nomes, componentes] = await Promise.all([
    db.select().from(sapEstoqueItens).where(eq(sapEstoqueItens.filial, filial)),
    db
      .select({
        item: sapItemMovimentos.itemCodigo,
        quantidade: sql<number>`sum(${sapItemMovimentos.quantidade})`.mapWith(Number),
        valor: sql<number>`sum(${sapItemMovimentos.valor})`.mapWith(Number),
        notas: sql<number>`count(distinct case when ${sapItemMovimentos.origem} = 'nota' then ${sapItemMovimentos.docEntry} end)`.mapWith(Number),
      })
      .from(sapItemMovimentos)
      .where(and(eq(sapItemMovimentos.filial, filial), eq(sapItemMovimentos.tipo, 'venda'), between(sapItemMovimentos.dia, de, ate)))
      .groupBy(sapItemMovimentos.itemCodigo),
    db
      .select({ item: sapItemMovimentos.itemCodigo, ultimo: sql<string>`max(${sapItemMovimentos.dia})` })
      .from(sapItemMovimentos)
      .where(and(eq(sapItemMovimentos.filial, filial), eq(sapItemMovimentos.origem, 'nota')))
      .groupBy(sapItemMovimentos.itemCodigo),
    nomesDosItens(filial),
    componentesGravados(),
  ])
  const est = new Map(estoque.map((e) => [e.itemCodigo, e]))
  const per = new Map(periodo.map((p) => [p.item, p]))
  const ult = new Map(ultimas.map((u) => [u.item, u.ultimo]))
  const codigos = new Set([...est.keys(), ...ult.keys()].filter((c) => !componentes.has(c)))
  return [...codigos].map((codigo) => {
    const e = est.get(codigo)
    const p = per.get(codigo)
    return {
      codigo,
      codigoAntigo: e?.codigoAntigo ?? null,
      descricao: e?.itemNome ?? nomes.get(codigo) ?? codigo,
      // Vendido − devolvido no período (devolução maior que a venda = 0).
      quantidade: Math.max(0, p?.quantidade ?? 0),
      valor: Math.max(0, Math.round((p?.valor ?? 0) * 100) / 100),
      notas: p?.notas ?? 0,
      estoque: e?.quantidade ?? 0,
      ultimaVenda: ult.get(codigo) ?? null,
    }
  })
}
