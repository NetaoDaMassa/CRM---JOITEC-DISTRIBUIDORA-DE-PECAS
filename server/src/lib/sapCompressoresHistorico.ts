import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, ordens, sapCotacoesHistorico, sapCotacoesItens, sapImportacoes, sapVendasHistorico, vendas } from '../db/schema.js'
import { registrarAuditoria } from './auditoria.js'
import { hojeBrString } from './dataBr.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { FILIAL_COMPRESSORES, SLUG_COMPRESSORES, carteirasCompressores, clientesCompressoresPorCodigoSap, vendedoresSapCompressores } from './sapCompressores.js'
import { limparCodigo } from './importSapHistorico.js'

// Histórico da carteira da Bruna (Odin Compressores) direto do SAP — pedido
// do João, 2026-10-30: "trazer as informações igual das outras pessoas". A
// Joitec e a Odin Tubos receberam isso por planilha (lotes de vendas abr–jul,
// cotações abr–jul e itens de cotação abr→out); aqui vem do Service Layer,
// nos MESMOS lotes/tabelas, então a ficha e os relatórios já enxergam. Os
// itens das notas vêm da sincronização normal (sincronizarItensSap
// --so-compressores). Só consulta: nada vai pro SAP.
//
// Pra não contar venda 2x nos relatórios (que já somam vendas do CRM e
// Pedidos/ordens da Odin Compressores):
//   - pedido da Bruna no SAP: até a véspera da 1ª venda dela no Kanban;
//   - pedido de outro vendedor (máquina, externo): até a véspera do 1º
//     Pedido (ordem) da Odin Compressores no CRM.
// Cotações: cabeçalho até 31/07 (de agosto em diante o orçamento é o card do
// CRM, como nas outras); itens de cotação do período todo.

export const NOME_LOTE_COMPRESSORES = 'SAP Service Layer — carteira da Bruna'
const ATE_CABECALHO_COTACOES = '2026-07-31'

interface DocSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  Cancelled: string
  DocumentStatus?: string
  DocumentLines?: { LineNum: number; ItemCode: string | null; ItemDescription: string | null; Quantity: number; Price: number; LineTotal: number }[]
}

export interface HistoricoCompressoresResultado {
  de: string
  ate: string
  cortePedidosBruna: string | null
  cortePedidosOutros: string | null
  clientesCarteira: number
  clientesNoSap: number
  pedidos: { lidos: number; gravar: number; jaExistiam: number; depoisDoCorte: number; valor: number }
  cotacoes: { lidas: number; cabecalhos: number; comItens: number; linhas: number; jaExistiam: number; valor: number }
  foraDaCarteira: number
  gravado: boolean
}

function vespera(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function carregarHistoricoCompressores(opts: { confirmar: boolean; usuarioId: number; de?: string }): Promise<HistoricoCompressoresResultado> {
  const de = opts.de ?? '2026-04-01'
  const ate = hojeBrString()
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_COMPRESSORES) })
  if (!empresa) throw new Error('Empresa odin-compressores não existe')
  const carteiras = [...(await carteirasCompressores())]
  const vendedoresBruna = await vendedoresSapCompressores()

  const daCarteira = carteiras.length
    ? await db.query.clientes.findMany({
        where: and(eq(clientes.empresaId, empresa.id), isNull(clientes.deletedAt), inArray(clientes.vendedorAtualId, carteiras)),
        columns: { id: true },
      })
    : []
  const idsCarteira = daCarteira.map((c) => c.id)

  // Cortes (ver cabeçalho).
  const [primeiraVenda] = idsCarteira.length
    ? await db
        .select({ d: sql<string | null>`min(${vendas.dataFechamento})` })
        .from(vendas)
        .where(and(inArray(vendas.clienteId, idsCarteira), isNull(vendas.deletedAt)))
    : [{ d: null }]
  const [primeiraOrdem] = await db
    .select({ d: sql<string | null>`min(date(${ordens.createdAt}, '-3 hours'))` })
    .from(ordens)
    .where(eq(ordens.empresaId, empresa.id))
  // dataFechamento é UTC; o dia que conta é o de Brasília.
  const cortePedidosBruna = primeiraVenda?.d
    ? vespera(new Date(Date.parse(`${primeiraVenda.d.replace(' ', 'T')}Z`) - 3 * 3600_000).toISOString().slice(0, 10))
    : null
  const cortePedidosOutros = primeiraOrdem?.d ? vespera(primeiraOrdem.d) : null

  const { pedidos, cotacoes, mapa } = await comSessaoSap(async (sap) => {
    const filtro = `BPL_IDAssignedToInvoice eq ${FILIAL_COMPRESSORES} and DocDate ge '${de}' and DocDate le '${ate}'`
    const pedidos = await sap.getTodos<DocSap>(`/Orders?$filter=${filtro}&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,Cancelled`, 200)
    const cabecalhos = await sap.getTodos<DocSap>(
      `/Quotations?$filter=${filtro}&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,Cancelled,DocumentStatus`,
      500
    )
    const mapa = await clientesCompressoresPorCodigoSap(sap, [...pedidos, ...cabecalhos].map((d) => d.CardCode))
    // Itens só das cotações dos clientes da carteira (com linhas é pesado).
    const daCarteira = cabecalhos.filter((q) => mapa.has(q.CardCode))
    const cotacoes: DocSap[] = []
    for (let i = 0; i < daCarteira.length; i += 20) {
      const f = daCarteira
        .slice(i, i + 20)
        .map((q) => `DocEntry eq ${q.DocEntry}`)
        .join(' or ')
      cotacoes.push(...(await sap.getTodos<DocSap>(`/Quotations?$filter=${f}&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,Cancelled,DocumentStatus,DocumentLines`, 20)))
    }
    return { pedidos, cotacoes: [...cotacoes, ...cabecalhos.filter((q) => !mapa.has(q.CardCode))], mapa }
  })

  const r: HistoricoCompressoresResultado = {
    de,
    ate,
    cortePedidosBruna,
    cortePedidosOutros,
    clientesCarteira: idsCarteira.length,
    clientesNoSap: new Set([...mapa.values()].map((c) => c.id)).size,
    pedidos: { lidos: 0, gravar: 0, jaExistiam: 0, depoisDoCorte: 0, valor: 0 },
    cotacoes: { lidas: 0, cabecalhos: 0, comItens: 0, linhas: 0, jaExistiam: 0, valor: 0 },
    foraDaCarteira: 0,
    gravado: false,
  }

  // O que já está em lotes LIGADOS da empresa (rodar de novo não duplica).
  const pedidosExistentes = new Set(
    (
      await db
        .select({ n: sapVendasHistorico.numeroPedido })
        .from(sapVendasHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
        .where(and(eq(sapVendasHistorico.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
    ).map((x) => x.n)
  )
  const cotacoesExistentes = new Set(
    (
      await db
        .select({ n: sapCotacoesHistorico.numeroCotacao })
        .from(sapCotacoesHistorico)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
        .where(and(eq(sapCotacoesHistorico.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
    ).map((x) => x.n)
  )
  const itensCotacaoExistentes = new Set(
    (
      await db
        .selectDistinct({ n: sapCotacoesItens.numeroCotacao })
        .from(sapCotacoesItens)
        .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesItens.importacaoId))
        .where(and(eq(sapCotacoesItens.empresaId, empresa.id), eq(sapImportacoes.ativo, true)))
    ).map((x) => x.n)
  )

  const novosPedidos: (typeof sapVendasHistorico.$inferInsert)[] = []
  for (const p of pedidos) {
    if (p.Cancelled === 'tYES') continue
    const c = mapa.get(p.CardCode)
    if (!c) {
      r.foraDaCarteira++
      continue
    }
    r.pedidos.lidos++
    const dia = dataSap(p.DocDate)
    const corte = vendedoresBruna.has(p.SalesPersonCode) ? cortePedidosBruna : cortePedidosOutros
    if (corte && dia > corte) {
      r.pedidos.depoisDoCorte++
      continue
    }
    if (pedidosExistentes.has(String(p.DocNum))) {
      r.pedidos.jaExistiam++
      continue
    }
    novosPedidos.push({
      empresaId: empresa.id,
      importacaoId: 0,
      clienteId: c.id,
      codigoCliente: limparCodigo(p.CardCode),
      nomeCliente: p.CardName,
      dataPedido: dia,
      numeroPedido: String(p.DocNum),
      valor: p.DocTotal,
      casadoPor: c.casadoPor,
    })
    r.pedidos.valor += p.DocTotal
  }
  r.pedidos.gravar = novosPedidos.length

  const novasCotacoes: (typeof sapCotacoesHistorico.$inferInsert)[] = []
  const novosItensCotacao: (typeof sapCotacoesItens.$inferInsert)[] = []
  for (const q of cotacoes) {
    const c = mapa.get(q.CardCode)
    if (!c) {
      r.foraDaCarteira++
      continue
    }
    r.cotacoes.lidas++
    const numero = String(q.DocNum)
    const dia = dataSap(q.DocDate)
    const status = q.Cancelled === 'tYES' ? 'cancelado' : q.DocumentStatus === 'bost_Open' ? 'aberto' : 'fechado'
    const jaCabecalho = cotacoesExistentes.has(numero)
    const jaItens = itensCotacaoExistentes.has(numero)
    if ((jaCabecalho || dia > ATE_CABECALHO_COTACOES) && jaItens) {
      r.cotacoes.jaExistiam++
      continue
    }
    if (!jaCabecalho && dia <= ATE_CABECALHO_COTACOES) {
      novasCotacoes.push({
        empresaId: empresa.id,
        importacaoId: 0,
        clienteId: c.id,
        codigoCliente: limparCodigo(q.CardCode),
        nomeCliente: q.CardName,
        dataCotacao: dia,
        numeroCotacao: numero,
        valor: q.DocTotal,
        status,
        casadoPor: c.casadoPor,
      })
      r.cotacoes.valor += q.DocTotal
    }
    if (!jaItens && q.DocumentLines?.length) {
      r.cotacoes.comItens++
      for (const l of q.DocumentLines) {
        novosItensCotacao.push({
          empresaId: empresa.id,
          importacaoId: 0,
          clienteId: c.id,
          codigoCliente: limparCodigo(q.CardCode),
          numeroCotacao: numero,
          dataCotacao: dia,
          status,
          valorCotacao: q.DocTotal,
          linha: l.LineNum + 1,
          codigoItem: l.ItemCode || null,
          descricao: (l.ItemDescription ?? '').trim() || l.ItemCode || '(sem descrição)',
          quantidade: l.Quantity,
          valorUnitario: l.Price,
          valorTotal: l.LineTotal,
          filialSap: 'odin compressores',
        })
      }
    }
  }
  r.cotacoes.cabecalhos = novasCotacoes.length
  r.cotacoes.linhas = novosItensCotacao.length

  if (!opts.confirmar) return r

  const gravarLote = async <T extends { importacaoId: number }>(
    tipo: 'vendas' | 'cotacoes' | 'cotacoes_itens',
    linhas: T[],
    tabela: typeof sapVendasHistorico | typeof sapCotacoesHistorico | typeof sapCotacoesItens,
    valor: number,
    datas: string[]
  ) => {
    if (!linhas.length) return
    const id = await db.transaction(async (tx) => {
      const lote = await tx.insert(sapImportacoes).values({
        empresaId: empresa.id,
        tipo,
        nomeArquivo: NOME_LOTE_COMPRESSORES,
        importadoPor: opts.usuarioId,
        totalLinhas: linhas.length,
        importadas: linhas.length,
        valorTotal: valor,
        dataInicio: datas.reduce((a, b) => (a < b ? a : b)),
        dataFim: datas.reduce((a, b) => (a > b ? a : b)),
      })
      const loteId = Number(lote.lastInsertRowid)
      for (let i = 0; i < linhas.length; i += 500) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(tabela).values(linhas.slice(i, i + 500).map((l) => ({ ...l, importacaoId: loteId })) as any)
      }
      return loteId
    })
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: id,
      acao: 'criar',
      valorNovo: `${NOME_LOTE_COMPRESSORES} · ${tipo} · ${linhas.length} linhas`,
      alteradoPor: opts.usuarioId,
    })
  }
  await gravarLote('vendas', novosPedidos, sapVendasHistorico, r.pedidos.valor, novosPedidos.map((p) => p.dataPedido))
  await gravarLote('cotacoes', novasCotacoes, sapCotacoesHistorico, r.cotacoes.valor, novasCotacoes.map((c) => c.dataCotacao))
  await gravarLote(
    'cotacoes_itens',
    novosItensCotacao,
    sapCotacoesItens,
    novosItensCotacao.reduce((s, l) => s + (l.valorTotal ?? 0), 0),
    novosItensCotacao.map((l) => l.dataCotacao)
  )
  r.gravado = true
  return r
}
