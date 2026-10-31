import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, sapCotacoesItens, sapImportacoes, users } from '../db/schema.js'
import { getConfigBool, getConfigTexto, setConfig } from './configuracoes.js'
import { hojeBrString } from './dataBr.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'
import { slugDoPedidoSap, vendedoresOdinTubosSap } from './sapVendasAuto.js'
import { FILIAL_COMPRESSORES, SLUG_COMPRESSORES, clientesCompressoresPorCodigoSap, vendedoresSapCompressores } from './sapCompressores.js'

// Cotações do SAP ao vivo — Fase 1 da proposta aprovada pelo João em
// 2026-10-31: a cada 2 minutos o CRM busca as cotações novas/alteradas e
// guarda com os itens em sap_cotacoes_itens (lote fixo "SAP automático" por
// empresa). Só MOSTRA: etiqueta no card do Kanban e lista na ficha — não
// move card, não preenche valor orçado, não entra em relatório de orçamento
// (só no "Itens mais orçados", que já usa essa tabela). Fases 2 e 3 depois.
//
// Mesmas regras de empresa do resto do SAP: filial Joitec com item PPR é da
// Odin Tubos (importSapCotacoesItens.ts); vendedor da Automação / da Odin
// Tubos manda na filial Joitec (slugDoPedidoSap); Odin Compressores só a
// carteira da Bruna, cotação feita por ela (lib/sapCompressores.ts).
// Desligar: config `sap_cotacoes_auto` = 0.

const NOME_LOTE = 'SAP automático (Service Layer)'
const CHAVE_ULTIMA = 'sap_cotacoes_auto_ate'
// O Service Layer só filtra UpdateDate por dia: relê os 2 últimos dias de
// cabeçalho (leve) e só baixa os itens do que é novo ou mudou.
const DIAS_RELEITURA = 2
const ehPpr = (descricao: string) => /\bPPR/i.test(descricao)
// Cotação de cliente fora do CRM (ou fora da carteira da Bruna): lembra a
// situação pra não baixar os itens de novo a cada 2 minutos.
const ignoradas = new Map<number, string>()

interface CotacaoSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  Cancelled: string
  DocumentStatus: string
  DocumentLines?: { LineNum: number; ItemCode: string | null; ItemDescription: string | null; Quantity: number; Price: number; LineTotal: number }[]
}

export interface SyncCotacoesResultado {
  desde: string
  noSap: number
  novas: number
  alteradas: number
  semMudanca: number
  deOutroLote: number
  semCliente: number
}

function statusDe(q: CotacaoSap): 'aberto' | 'fechado' | 'cancelado' {
  return q.Cancelled === 'tYES' ? 'cancelado' : q.DocumentStatus === 'bost_Open' ? 'aberto' : 'fechado'
}

function addDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function sincronizarCotacoesSap(opts: { desde?: string } = {}): Promise<SyncCotacoesResultado | null> {
  if (!(await getConfigBool('sap_cotacoes_auto', true))) return null
  const hoje = hojeBrString()
  const ultima = await getConfigTexto(CHAVE_ULTIMA)
  // Primeira vez: a planilha de itens de cotação foi até 22/10/2026.
  const desde = opts.desde ?? addDias(ultima ?? '2026-10-22', -DIAS_RELEITURA)

  const slugs = ['joitec', 'odin-tubos', 'joitec-automacao', SLUG_COMPRESSORES]
  const listaEmpresas = await db.query.empresas.findMany({ where: inArray(empresas.slug, slugs) })
  const empresaPorSlug = new Map(listaEmpresas.map((e) => [e.slug, e]))
  const automacao = await vendedoresAutomacaoSap()
  const odinTubos = await vendedoresOdinTubosSap()
  const vendedoresBruna = await vendedoresSapCompressores()
  const autor = await db.query.users.findFirst({ where: eq(users.superAdmin, true), columns: { id: true } })

  // Clientes por código em cada empresa (Odin Compressores é à parte).
  const porCodigo = new Map<number, Map<string, number>>()
  for (const e of listaEmpresas) {
    if (e.slug === SLUG_COMPRESSORES) continue
    const m = new Map<string, number>()
    const lista = await db.query.clientes.findMany({ where: and(eq(clientes.empresaId, e.id), isNull(clientes.deletedAt)), columns: { id: true, codigo: true, codigoAntigo: true } })
    for (const c of lista)
      for (const cod of [c.codigo, c.codigoAntigo]) {
        if (!cod) continue
        const limpo = limparCodigo(cod)
        if (!m.has(limpo)) m.set(limpo, c.id)
        if (!m.has(semZerosEsquerda(limpo))) m.set(semZerosEsquerda(limpo), c.id)
      }
    porCodigo.set(e.id, m)
  }

  // O que já está guardado: nº → {lote, status, valor} (lotes ligados).
  const guardadas = await db
    .selectDistinct({ empresaId: sapCotacoesItens.empresaId, numero: sapCotacoesItens.numeroCotacao, lote: sapCotacoesItens.importacaoId, status: sapCotacoesItens.status, valor: sapCotacoesItens.valorCotacao })
    .from(sapCotacoesItens)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesItens.importacaoId))
    .where(and(inArray(sapCotacoesItens.empresaId, listaEmpresas.map((e) => e.id)), eq(sapImportacoes.ativo, true)))
  const jaTem = new Map(guardadas.map((g) => [`${g.empresaId}:${g.numero}`, g]))

  const lotes = new Map<number, number>()
  const loteDa = async (empresaId: number) => {
    if (lotes.has(empresaId)) return lotes.get(empresaId)!
    const l = await db.query.sapImportacoes.findFirst({
      where: and(eq(sapImportacoes.empresaId, empresaId), eq(sapImportacoes.tipo, 'cotacoes_itens'), eq(sapImportacoes.nomeArquivo, NOME_LOTE)),
    })
    const id = l?.id ?? Number((await db.insert(sapImportacoes).values({ empresaId, tipo: 'cotacoes_itens', nomeArquivo: NOME_LOTE, importadoPor: autor?.id ?? null })).lastInsertRowid)
    lotes.set(empresaId, id)
    return id
  }

  const r: SyncCotacoesResultado = { desde, noSap: 0, novas: 0, alteradas: 0, semMudanca: 0, deOutroLote: 0, semCliente: 0 }

  await comSessaoSap(async (sap) => {
    const cabecalhos = await sap.getTodos<CotacaoSap>(
      `/Quotations?$filter=UpdateDate ge '${desde}' and (BPL_IDAssignedToInvoice eq 3 or BPL_IDAssignedToInvoice eq 4 or BPL_IDAssignedToInvoice eq ${FILIAL_COMPRESSORES})` +
        '&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,Cancelled,DocumentStatus',
      500
    )
    r.noSap = cabecalhos.length
    const compressores = empresaPorSlug.has(SLUG_COMPRESSORES)
      ? await clientesCompressoresPorCodigoSap(
          sap,
          cabecalhos.filter((q) => q.BPL_IDAssignedToInvoice === FILIAL_COMPRESSORES && vendedoresBruna.has(q.SalesPersonCode)).map((q) => q.CardCode)
        )
      : new Map()

    for (const cab of cabecalhos) {
      const status = statusDe(cab)
      const numero = String(cab.DocNum)
      // Já guardada em alguma empresa e sem mudança? Nada a fazer (evita
      // baixar os itens de novo a cada 2 minutos).
      const existentes = listaEmpresas.map((e) => jaTem.get(`${e.id}:${numero}`)).filter(Boolean)
      const assinatura = `${status}:${cab.DocTotal}:${cab.CardCode}`
      if (
        (existentes.length && existentes.every((g) => g!.status === status && Math.abs((g!.valor ?? 0) - cab.DocTotal) < 0.01)) ||
        ignoradas.get(cab.DocEntry) === assinatura
      ) {
        r.semMudanca++
        continue
      }
      const [q] = await sap.getTodos<CotacaoSap>(
        `/Quotations?$filter=DocEntry eq ${cab.DocEntry}&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,Cancelled,DocumentStatus,DocumentLines`
      )
      if (!q) continue
      const linhas = q.DocumentLines ?? []
      if (!linhas.length) {
        ignoradas.set(q.DocEntry, assinatura)
        continue
      }

      let slug: string | undefined
      let clienteId: number | undefined
      if (q.BPL_IDAssignedToInvoice === FILIAL_COMPRESSORES) {
        const c = vendedoresBruna.has(q.SalesPersonCode) ? compressores.get(q.CardCode) : undefined
        if (!c) {
          ignoradas.set(q.DocEntry, assinatura)
          continue
        }
        slug = SLUG_COMPRESSORES
        clienteId = c.id
      } else {
        slug = slugDoPedidoSap(q.BPL_IDAssignedToInvoice, q.SalesPersonCode, automacao, odinTubos)
        if (slug === 'joitec' && linhas.some((l) => ehPpr(l.ItemDescription ?? ''))) slug = 'odin-tubos'
        const empresa = slug ? empresaPorSlug.get(slug) : undefined
        const codigo = limparCodigo(q.CardCode)
        clienteId = empresa ? (porCodigo.get(empresa.id)?.get(codigo) ?? porCodigo.get(empresa.id)?.get(semZerosEsquerda(codigo))) : undefined
      }
      const empresa = slug ? empresaPorSlug.get(slug) : undefined
      if (!empresa || !clienteId) {
        r.semCliente++
        ignoradas.set(q.DocEntry, assinatura)
        continue
      }

      // Cotação que veio da planilha (outro lote): só acompanha a situação.
      const anterior = jaTem.get(`${empresa.id}:${numero}`)
      const loteAuto = await loteDa(empresa.id)
      if (anterior && anterior.lote !== loteAuto) {
        await db
          .update(sapCotacoesItens)
          .set({ status, valorCotacao: q.DocTotal })
          .where(and(eq(sapCotacoesItens.importacaoId, anterior.lote), eq(sapCotacoesItens.numeroCotacao, numero)))
        r.deOutroLote++
        jaTem.set(`${empresa.id}:${numero}`, { ...anterior, status, valor: q.DocTotal })
        continue
      }
      await db.transaction(async (tx) => {
        await tx.delete(sapCotacoesItens).where(and(eq(sapCotacoesItens.importacaoId, loteAuto), eq(sapCotacoesItens.numeroCotacao, numero)))
        const dia = dataSap(q.DocDate)
        const valores = linhas.map((l) => ({
          empresaId: empresa.id,
          importacaoId: loteAuto,
          clienteId: clienteId!,
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
          filialSap: String(q.BPL_IDAssignedToInvoice),
        }))
        await tx.insert(sapCotacoesItens).values(valores)
      })
      if (anterior) r.alteradas++
      else r.novas++
      jaTem.set(`${empresa.id}:${numero}`, { empresaId: empresa.id, numero, lote: loteAuto, status, valor: q.DocTotal })
    }
  })

  if (!opts.desde) await setConfig(CHAVE_ULTIMA, hoje)
  return r
}
