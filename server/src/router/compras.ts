import { z } from 'zod'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import { router, adminProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { comprasInvoices } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'

const EMPRESA_VALUES = ['odin-tubos', 'odin-compressores', 'joitec'] as const
const STATUS_VALUES = ['em_producao', 'embarcado', 'a_caminho', 'chegou'] as const

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
  listar: adminProcedure
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

  criar: adminProcedure
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

  atualizar: adminProcedure
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

  remover: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existente = await db.query.comprasInvoices.findFirst({ where: eq(comprasInvoices.id, input.id) })
    if (!existente || existente.deletedAt) throw new Error('Invoice não encontrada')

    await db.update(comprasInvoices).set({ deletedAt: agoraSqlite() }).where(eq(comprasInvoices.id, input.id))
    await registrarAuditoria({ tabela: 'compras_invoices', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { success: true }
  }),

  // Segunda página do Painel Financeiro (TV) — só invoices ainda "em
  // andamento" (não chegou), pra sala de compras acompanhar sem precisar
  // abrir o CRM. Mesmo gate de superAdmin do resto do Painel Financeiro.
  painelImportacoes: superAdminProcedure.query(async () => {
    return db.query.comprasInvoices.findMany({
      where: and(isNull(comprasInvoices.deletedAt), ne(comprasInvoices.status, 'chegou')),
      orderBy: [desc(comprasInvoices.dataChegada)],
    })
  }),
})
