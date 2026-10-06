// Devolução E-commerce (Compretec E-commerce) — registro simples das
// devoluções dos marketplaces (ML/Shopee/TikTok), substituindo a planilha
// que o time usava. Pedido do João, 2026-10-06. Sem workflow de etapas
// (diferente do resto do módulo de Devolução) — é só um log pra relatório
// (total/com recurso/sem recurso, por plataforma) que também alimenta o
// Painel Financeiro.
import { z } from 'zod'
import { and, between, eq, isNull, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { devolucaoEcommerce, empresas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

export const SLUG_DEVOLUCAO_ECOMMERCE = 'compretec-ecommerce'

export async function assertEmpresaDevolucaoEcommerce(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_DEVOLUCAO_ECOMMERCE) throw new TRPCError({ code: 'FORBIDDEN', message: 'Tela disponível só pra Compretec E-commerce' })
}

const CamposSchema = z.object({
  data: z.string().min(1),
  marketplace: z.enum(['mercado_livre', 'shopee', 'tiktok', 'outro']),
  loja: z.string().min(1),
  pedido: z.string().min(1),
  nfEntrada: z.string().optional(),
  nfDevolucao: z.string().optional(),
  valorVenda: z.number().min(0),
  motivo: z.string().min(1),
  statusRecurso: z.enum(['sem_recurso', 'aguardando', 'aprovado', 'negado', 'reembolsado']),
  valorRecurso: z.number().optional(),
  custoDevolucao: z.number().optional(),
  erroExpedicao: z.boolean().optional(),
  observacoes: z.string().optional(),
})

export const devolucaoEcommerceRouter = router({
  listar: adminOrFeatureProcedure('devolucoes_ecommerce')
    .input(
      z.object({
        dataInicio: z.string().optional(),
        dataFim: z.string().optional(),
        marketplace: z.enum(['mercado_livre', 'shopee', 'tiktok', 'outro']).optional(),
        statusRecurso: z.enum(['sem_recurso', 'aguardando', 'aprovado', 'negado', 'reembolsado']).optional(),
        busca: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertEmpresaDevolucaoEcommerce(ctx.empresaId)
      const condicoes = [eq(devolucaoEcommerce.empresaId, ctx.empresaId)]
      if (input.dataInicio && input.dataFim) condicoes.push(between(devolucaoEcommerce.data, input.dataInicio, input.dataFim))
      if (input.marketplace) condicoes.push(eq(devolucaoEcommerce.marketplace, input.marketplace))
      if (input.statusRecurso) condicoes.push(eq(devolucaoEcommerce.statusRecurso, input.statusRecurso))
      if (input.busca?.trim()) {
        const termo = `%${input.busca.trim()}%`
        condicoes.push(sql`(${devolucaoEcommerce.pedido} LIKE ${termo} OR ${devolucaoEcommerce.loja} LIKE ${termo} OR ${devolucaoEcommerce.motivo} LIKE ${termo})`)
      }
      return db.query.devolucaoEcommerce.findMany({
        where: and(...condicoes),
        orderBy: (d, { desc }) => [desc(d.data), desc(d.id)],
      })
    }),

  criar: adminOrFeatureProcedure('devolucoes_ecommerce')
    .input(CamposSchema)
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaDevolucaoEcommerce(ctx.empresaId)
      const result = await db.insert(devolucaoEcommerce).values({
        empresaId: ctx.empresaId,
        criadoPor: ctx.user.id,
        ...input,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizar: adminOrFeatureProcedure('devolucoes_ecommerce')
    .input(CamposSchema.partial().extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaDevolucaoEcommerce(ctx.empresaId)
      const { id, ...campos } = input
      const existente = await db.query.devolucaoEcommerce.findFirst({ where: and(eq(devolucaoEcommerce.id, id), eq(devolucaoEcommerce.empresaId, ctx.empresaId)) })
      if (!existente) throw new TRPCError({ code: 'NOT_FOUND', message: 'Devolução não encontrada' })
      await db.update(devolucaoEcommerce).set({ ...campos, updatedAt: agoraSqlite() }).where(eq(devolucaoEcommerce.id, id))
      return { ok: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaDevolucaoEcommerce(ctx.empresaId)
    const existente = await db.query.devolucaoEcommerce.findFirst({ where: and(eq(devolucaoEcommerce.id, input.id), eq(devolucaoEcommerce.empresaId, ctx.empresaId)) })
    if (!existente) throw new TRPCError({ code: 'NOT_FOUND', message: 'Devolução não encontrada' })
    await db.delete(devolucaoEcommerce).where(eq(devolucaoEcommerce.id, input.id))
    return { ok: true }
  }),

  // Resumo pro cabeçalho da tela + também usado pelo Painel Financeiro
  // (financeiro.ts chama a função exportada abaixo direto, sem passar por
  // aqui, pra não exigir a feature 'devolucoes_ecommerce' de quem só
  // acessa o Painel Financeiro).
  relatorio: adminOrFeatureProcedure('devolucoes_ecommerce')
    .input(z.object({ dataInicio: z.string(), dataFim: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertEmpresaDevolucaoEcommerce(ctx.empresaId)
      return calcularRelatorioDevolucaoEcommerce(ctx.empresaId, input.dataInicio, input.dataFim)
    }),
})

export async function calcularRelatorioDevolucaoEcommerce(empresaId: number, dataInicio: string, dataFim: string) {
  const rows = await db.query.devolucaoEcommerce.findMany({
    where: and(eq(devolucaoEcommerce.empresaId, empresaId), between(devolucaoEcommerce.data, dataInicio, dataFim)),
    columns: { statusRecurso: true, valorVenda: true, valorRecurso: true, custoDevolucao: true, marketplace: true },
  })

  const comRecurso = rows.filter((r) => r.statusRecurso !== 'sem_recurso')
  const semRecurso = rows.filter((r) => r.statusRecurso === 'sem_recurso')

  const porPlataforma = new Map<string, number>()
  for (const r of rows) porPlataforma.set(r.marketplace, (porPlataforma.get(r.marketplace) ?? 0) + 1)

  return {
    total: rows.length,
    comRecurso: comRecurso.length,
    semRecurso: semRecurso.length,
    valorVendasTotal: rows.reduce((s, r) => s + r.valorVenda, 0),
    valorRecursoTotal: rows.reduce((s, r) => s + (r.valorRecurso ?? 0), 0),
    custoDevolucaoTotal: rows.reduce((s, r) => s + (r.custoDevolucao ?? 0), 0),
    porPlataforma: Object.fromEntries(porPlataforma),
  }
}
