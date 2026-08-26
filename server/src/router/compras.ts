import { z } from 'zod'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'

const comprasProcedure = featureProcedure('compras')
import { db } from '../db/client.js'
import { comprasInvoices, comprasNacionais } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'

const EMPRESA_VALUES = ['odin-tubos', 'odin-compressores', 'joitec'] as const
const STATUS_VALUES = ['em_producao', 'embarcado', 'a_caminho', 'chegou'] as const
const STATUS_NACIONAL_VALUES = ['aguardando_aprovacao', 'a_caminho', 'chegou', 'entrada_nota', 'recusado'] as const

const camposInvoice = {
  empresa: z.enum(EMPRESA_VALUES),
  numeroInvoice: z.string().min(1),
  fornecedor: z.string().optional(),
  status: z.enum(STATUS_VALUES),
  dataEmbarque: z.string().optional(),
  dataChegada: z.string().optional(),
  invoicePaga: z.boolean(),
  valorDolar: z.number().optional(),
  valorInvoiceReais: z.number().optional(),
  numeroContainer: z.string().optional(),
  navio: z.string().optional(),
  portoOrigem: z.string().optional(),
  portoDestino: z.string().optional(),
  observacoes: z.string().optional(),
}

export const comprasRouter = router({
  listar: comprasProcedure
    .input(z.object({ empresa: z.enum(EMPRESA_VALUES).optional(), status: z.enum(STATUS_VALUES).optional() }).optional())
    .query(async ({ input }) => {
      const filtros = [isNull(comprasInvoices.deletedAt)]
      if (input?.empresa) filtros.push(eq(comprasInvoices.empresa, input.empresa))
      if (input?.status) filtros.push(eq(comprasInvoices.status, input.status))

      return db.query.comprasInvoices.findMany({
        where: and(...filtros),
        orderBy: [desc(comprasInvoices.createdAt)],
      })
    }),

  criar: comprasProcedure
    .input(z.object(camposInvoice))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(comprasInvoices).values({
        ...input,
        fornecedor: input.fornecedor || null,
        dataEmbarque: input.dataEmbarque || null,
        dataChegada: input.dataChegada || null,
        valorDolar: input.invoicePaga ? (input.valorDolar ?? null) : null,
        valorInvoiceReais: input.valorInvoiceReais ?? null,
        numeroContainer: input.numeroContainer || null,
        navio: input.navio || null,
        portoOrigem: input.portoOrigem || null,
        portoDestino: input.portoDestino || null,
        observacoes: input.observacoes || null,
        criadoPor: ctx.user.id,
      })
      const id = Number(result.lastInsertRowid)
      await registrarAuditoria({ tabela: 'compras_invoices', registroId: id, acao: 'criar', alteradoPor: ctx.user.id })
      return { id }
    }),

  atualizar: comprasProcedure
    .input(z.object({ id: z.number() }).extend(camposInvoice))
    .mutation(async ({ ctx, input }) => {
      const { id, ...campos } = input
      const existente = await db.query.comprasInvoices.findFirst({ where: eq(comprasInvoices.id, id) })
      if (!existente || existente.deletedAt) throw new Error('Invoice não encontrada')

      await db
        .update(comprasInvoices)
        .set({
          ...campos,
          fornecedor: campos.fornecedor || null,
          dataEmbarque: campos.dataEmbarque || null,
          dataChegada: campos.dataChegada || null,
          valorDolar: campos.invoicePaga ? (campos.valorDolar ?? null) : null,
          valorInvoiceReais: campos.valorInvoiceReais ?? null,
          numeroContainer: campos.numeroContainer || null,
          navio: campos.navio || null,
          portoOrigem: campos.portoOrigem || null,
          portoDestino: campos.portoDestino || null,
          observacoes: campos.observacoes || null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(comprasInvoices.id, id))

      await registrarAuditoria({ tabela: 'compras_invoices', registroId: id, acao: 'editar', alteradoPor: ctx.user.id })
      return { success: true }
    }),

  remover: comprasProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existente = await db.query.comprasInvoices.findFirst({ where: eq(comprasInvoices.id, input.id) })
    if (!existente || existente.deletedAt) throw new Error('Invoice não encontrada')

    await db.update(comprasInvoices).set({ deletedAt: agoraSqlite() }).where(eq(comprasInvoices.id, input.id))
    await registrarAuditoria({ tabela: 'compras_invoices', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  // Segunda página do Painel Financeiro (TV) — só invoices ainda "em
  // andamento" (não chegou), pra sala de compras acompanhar sem precisar
  // abrir o CRM. Mesmo gate de LEITURA do resto do Painel Financeiro:
  // liberado pra quem tem a feature 'painel_financeiro' (ex: conta
  // dedicada da TV), não só superAdmin — ver painelResumo em financeiro.ts.
  painelImportacoes: featureProcedure('painel_financeiro').query(async () => {
    return db.query.comprasInvoices.findMany({
      where: and(isNull(comprasInvoices.deletedAt), ne(comprasInvoices.status, 'chegou')),
      orderBy: [desc(comprasInvoices.dataChegada)],
    })
  }),

  // Compras nacionais — aba separada da invoice (que é só importação).
  // Toda solicitação nasce "aguardando_aprovacao" e só segue pro resto do
  // fluxo (a_caminho/chegou/entrada_nota) depois que o diretor de compras
  // aprova; se ele recusar, fica marcada "recusado" (histórico, não
  // exclui).
  listarNacionais: comprasProcedure
    .input(z.object({ status: z.enum(STATUS_NACIONAL_VALUES).optional() }).optional())
    .query(async ({ input }) => {
      const filtros = [isNull(comprasNacionais.deletedAt)]
      if (input?.status) filtros.push(eq(comprasNacionais.status, input.status))

      return db.query.comprasNacionais.findMany({
        where: and(...filtros),
        orderBy: [desc(comprasNacionais.createdAt)],
        with: {
          solicitadoPorUser: { columns: { id: true, name: true } },
          aprovadoPorUser: { columns: { id: true, name: true } },
        },
      })
    }),

  criarNacional: comprasProcedure
    .input(
      z.object({
        fornecedor: z.string().min(1),
        produtos: z.string().min(1),
        valorTotal: z.number().positive(),
        dataPrevistaChegada: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(comprasNacionais).values({
        fornecedor: input.fornecedor,
        produtos: input.produtos,
        valorTotal: input.valorTotal,
        dataPrevistaChegada: input.dataPrevistaChegada || null,
        observacoes: input.observacoes || null,
        solicitadoPor: ctx.user.id,
      })
      const id = Number(result.lastInsertRowid)
      await registrarAuditoria({ tabela: 'compras_nacionais', registroId: id, acao: 'criar', alteradoPor: ctx.user.id })
      return { id }
    }),

  aprovarNacional: comprasProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existente = await db.query.comprasNacionais.findFirst({ where: eq(comprasNacionais.id, input.id) })
    if (!existente || existente.deletedAt) throw new Error('Solicitação não encontrada')
    if (existente.status !== 'aguardando_aprovacao') throw new Error('Essa solicitação já foi decidida')

    await db
      .update(comprasNacionais)
      .set({ status: 'a_caminho', aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite(), updatedAt: agoraSqlite() })
      .where(eq(comprasNacionais.id, input.id))

    await registrarAuditoria({ tabela: 'compras_nacionais', registroId: input.id, acao: 'editar', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  recusarNacional: comprasProcedure
    .input(z.object({ id: z.number(), motivo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existente = await db.query.comprasNacionais.findFirst({ where: eq(comprasNacionais.id, input.id) })
      if (!existente || existente.deletedAt) throw new Error('Solicitação não encontrada')
      if (existente.status !== 'aguardando_aprovacao') throw new Error('Essa solicitação já foi decidida')

      await db
        .update(comprasNacionais)
        .set({
          status: 'recusado',
          aprovadoPor: ctx.user.id,
          aprovadoEm: agoraSqlite(),
          motivoRecusa: input.motivo || null,
          updatedAt: agoraSqlite(),
        })
        .where(eq(comprasNacionais.id, input.id))

      await registrarAuditoria({ tabela: 'compras_nacionais', registroId: input.id, acao: 'editar', alteradoPor: ctx.user.id })
      return { success: true }
    }),

  // Avança o status já aprovado (a_caminho → chegou → entrada_nota) — não
  // usa pra aprovação/recusa, só pro pós-aprovação seguir o fluxo.
  atualizarStatusNacional: comprasProcedure
    .input(z.object({ id: z.number(), status: z.enum(['a_caminho', 'chegou', 'entrada_nota']) }))
    .mutation(async ({ ctx, input }) => {
      const existente = await db.query.comprasNacionais.findFirst({ where: eq(comprasNacionais.id, input.id) })
      if (!existente || existente.deletedAt) throw new Error('Solicitação não encontrada')
      if (existente.status === 'aguardando_aprovacao' || existente.status === 'recusado') {
        throw new Error('Essa solicitação ainda não foi aprovada')
      }

      await db.update(comprasNacionais).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(comprasNacionais.id, input.id))
      await registrarAuditoria({ tabela: 'compras_nacionais', registroId: input.id, acao: 'editar', alteradoPor: ctx.user.id })
      return { success: true }
    }),

  removerNacional: comprasProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existente = await db.query.comprasNacionais.findFirst({ where: eq(comprasNacionais.id, input.id) })
    if (!existente || existente.deletedAt) throw new Error('Solicitação não encontrada')

    await db.update(comprasNacionais).set({ deletedAt: agoraSqlite() }).where(eq(comprasNacionais.id, input.id))
    await registrarAuditoria({ tabela: 'compras_nacionais', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  // Painel de indicadores gerais de Compras (importação + nacional juntos).
  // Meses são sempre os últimos 6 a partir de hoje, mesmo sem dado — o
  // gráfico não "pula" mês vazio.
  indicadores: comprasProcedure.query(async () => {
    const [invoices, nacionais] = await Promise.all([
      db.query.comprasInvoices.findMany({ where: isNull(comprasInvoices.deletedAt) }),
      db.query.comprasNacionais.findMany({ where: isNull(comprasNacionais.deletedAt) }),
    ])

    const hoje = new Date()
    const meses = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
    const gastoPorMes = meses.map((mes) => ({
      mes,
      valorImportacoes:
        invoices.filter((i) => i.createdAt.slice(0, 7) === mes).reduce((s, i) => s + (i.valorInvoiceReais ?? 0), 0),
      valorNacionais: nacionais.filter((n) => n.createdAt.slice(0, 7) === mes).reduce((s, n) => s + n.valorTotal, 0),
    }))

    // Tempo médio de entrega: importações usam embarque→chegada (dois
    // campos explícitos, confiável em qualquer status "chegou"). Nacionais
    // não têm um campo de "chegou de verdade" separado — aproxima com
    // aprovado→última atualização, só pras que estão EXATAMENTE em
    // "chegou" agora (evita contar quem já passou pra "entrada_nota", cujo
    // updatedAt não é mais o momento da chegada).
    function mediaDias(pares: { de: string | null; ate: string | null }[]): number | null {
      const dias = pares
        .filter((p): p is { de: string; ate: string } => !!p.de && !!p.ate)
        .map((p) => (new Date(p.ate).getTime() - new Date(p.de).getTime()) / (1000 * 60 * 60 * 24))
        .filter((d) => d >= 0)
      if (dias.length === 0) return null
      return Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10
    }

    const tempoMedioEntregaDias = {
      importacoes: mediaDias(invoices.filter((i) => i.status === 'chegou').map((i) => ({ de: i.dataEmbarque, ate: i.dataChegada }))),
      nacionais: mediaDias(nacionais.filter((n) => n.status === 'chegou').map((n) => ({ de: n.aprovadoEm, ate: n.updatedAt }))),
    }

    const nacionaisDecididas = nacionais.filter((n) => n.status !== 'aguardando_aprovacao')
    const taxaRecusaNacionais =
      nacionaisDecididas.length > 0
        ? Math.round((nacionaisDecididas.filter((n) => n.status === 'recusado').length / nacionaisDecididas.length) * 1000) / 10
        : 0

    const gastoPorFornecedorMap = new Map<string, number>()
    for (const i of invoices) {
      if (!i.fornecedor || !i.valorInvoiceReais) continue
      gastoPorFornecedorMap.set(i.fornecedor, (gastoPorFornecedorMap.get(i.fornecedor) ?? 0) + i.valorInvoiceReais)
    }
    for (const n of nacionais) {
      if (n.status === 'recusado') continue
      gastoPorFornecedorMap.set(n.fornecedor, (gastoPorFornecedorMap.get(n.fornecedor) ?? 0) + n.valorTotal)
    }
    const gastoPorFornecedor = [...gastoPorFornecedorMap.entries()]
      .map(([fornecedor, valor]) => ({ fornecedor, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)

    return {
      gastoPorMes,
      tempoMedioEntregaDias,
      taxaRecusaNacionais,
      qtdNacionaisRecusadas: nacionaisDecididas.filter((n) => n.status === 'recusado').length,
      qtdNacionaisDecididas: nacionaisDecididas.length,
      gastoPorFornecedor,
    }
  }),
})
