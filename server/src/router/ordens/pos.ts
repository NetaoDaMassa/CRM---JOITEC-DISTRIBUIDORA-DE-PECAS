// Etapas finais do pipeline: Coleta, Rastreio, Qualidade e Pós-Venda.
// Coleta/Pós-venda têm edição liberada pro vendedor (mesmo do odincrm
// original — "any user" nesses PUTs); confirmar coleta e editar
// rastreio/qualidade são gestor-only.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemColeta, ordemRastreio, ordemQualidade, ordemPosVenda } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'

export const ordensPosRouter = router({
  obterColeta: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemColeta.findFirst({ where: eq(ordemColeta.ordemId, input.ordemId) }) ?? null
  }),

  atualizarColeta: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        ordemId: z.number(),
        dataColeta: z.string().optional(),
        horaColetaInicio: z.string().optional(),
        horaColetaFim: z.string().optional(),
        transportadora: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const { ordemId, ...values } = input
      const existente = await db.query.ordemColeta.findFirst({ where: eq(ordemColeta.ordemId, ordemId) })
      if (existente) await db.update(ordemColeta).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemColeta.ordemId, ordemId))
      else await db.insert(ordemColeta).values({ ordemId, ...values })
      return { ok: true }
    }),

  confirmarColeta: adminProcedure.input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const existente = await db.query.ordemColeta.findFirst({ where: eq(ordemColeta.ordemId, input.ordemId) })
    const values = { confirmado: true, confirmadoPor: ctx.user.id, confirmadoEm: agoraSqlite() }
    if (existente) await db.update(ordemColeta).set(values).where(eq(ordemColeta.ordemId, input.ordemId))
    else await db.insert(ordemColeta).values({ ordemId: input.ordemId, ...values })
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: 'Coleta confirmada', stage: ordem.stage })
    return { ok: true }
  }),

  obterRastreio: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemRastreio.findFirst({ where: eq(ordemRastreio.ordemId, input.ordemId) }) ?? null
  }),

  atualizarRastreio: adminProcedure
    .input(z.object({ ordemId: z.number(), transportadora: z.string().optional(), codigoRastreio: z.string().optional(), linkRastreio: z.string().optional(), observacoes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const { ordemId, ...values } = input
      const existente = await db.query.ordemRastreio.findFirst({ where: eq(ordemRastreio.ordemId, ordemId) })
      if (existente) await db.update(ordemRastreio).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemRastreio.ordemId, ordemId))
      else await db.insert(ordemRastreio).values({ ordemId, ...values })
      return { ok: true }
    }),

  obterQualidade: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemQualidade.findFirst({ where: eq(ordemQualidade.ordemId, input.ordemId) }) ?? null
  }),

  atualizarQualidade: adminProcedure.input(z.object({ ordemId: z.number(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    const { ordemId, ...values } = input
    const existente = await db.query.ordemQualidade.findFirst({ where: eq(ordemQualidade.ordemId, ordemId) })
    if (existente) await db.update(ordemQualidade).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemQualidade.ordemId, ordemId))
    else await db.insert(ordemQualidade).values({ ordemId, ...values })
    return { ok: true }
  }),

  obterPosVenda: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemPosVenda.findFirst({ where: eq(ordemPosVenda.ordemId, input.ordemId) }) ?? null
  }),

  atualizarPosVenda: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        ordemId: z.number(),
        feedbackCliente: z.string().optional(),
        npsScore: z.number().optional(),
        dataLembrete: z.string().optional(),
        notaLembrete: z.string().optional(),
        vendaPeca: z.boolean().optional(),
        primeiraPreventiva: z.string().optional(),
        nomeRevenda: z.string().optional(),
        dataRecebimentoMercadoria: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const { ordemId, ...values } = input
      const existente = await db.query.ordemPosVenda.findFirst({ where: eq(ordemPosVenda.ordemId, ordemId) })
      if (existente) await db.update(ordemPosVenda).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemPosVenda.ordemId, ordemId))
      else await db.insert(ordemPosVenda).values({ ordemId, ...values })
      return { ok: true }
    }),
})
