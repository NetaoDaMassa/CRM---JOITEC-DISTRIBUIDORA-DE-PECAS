// Cotações de frete, aprovação de frete e frete finalizado — cotações são
// gestor-only (mesmo do odincrm original), aprovar cotação é liberado pro
// vendedor (é ele quem geralmente recebe a resposta do cliente).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemCotacoesFrete, ordemAprovacaoFrete, ordemFreteFinalizado } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'

export const ordensFreteRouter = router({
  listarCotacoes: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemCotacoesFrete.findMany({ where: eq(ordemCotacoesFrete.ordemId, input.ordemId), orderBy: (c, { asc }) => [asc(c.numeroSequencial)] })
  }),

  criarCotacao: adminProcedure
    .input(
      z.object({
        ordemId: z.number(),
        numeroCotacaoTransportadora: z.string().optional(),
        transportadora: z.string().optional(),
        valor: z.number().optional(),
        peso: z.number().optional(),
        volume: z.number().optional(),
        prazo: z.string().optional(),
        tipoFrete: z.enum(['CIF', 'FOB']).optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const existentes = await db.query.ordemCotacoesFrete.findMany({ where: eq(ordemCotacoesFrete.ordemId, input.ordemId) })
      const proximoNumero = existentes.reduce((acc, c) => Math.max(acc, c.numeroSequencial), 0) + 1
      const { ordemId, ...values } = input
      const result = await db.insert(ordemCotacoesFrete).values({ ordemId, numeroSequencial: proximoNumero, ...values })
      await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'update', description: `Cotação de frete #${proximoNumero} adicionada`, stage: ordem.stage })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizarCotacao: adminProcedure
    .input(
      z.object({
        id: z.number(),
        ordemId: z.number(),
        numeroCotacaoTransportadora: z.string().optional(),
        transportadora: z.string().optional(),
        valor: z.number().optional(),
        peso: z.number().optional(),
        volume: z.number().optional(),
        prazo: z.string().optional(),
        tipoFrete: z.enum(['CIF', 'FOB']).optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { id, ordemId, ...values } = input
      await db.update(ordemCotacoesFrete).set({ ...values, updatedAt: agoraSqlite() }).where(and(eq(ordemCotacoesFrete.id, id), eq(ordemCotacoesFrete.ordemId, ordemId)))
      return { ok: true }
    }),

  excluirCotacao: adminProcedure.input(z.object({ id: z.number(), ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    await db.delete(ordemCotacoesFrete).where(and(eq(ordemCotacoesFrete.id, input.id), eq(ordemCotacoesFrete.ordemId, input.ordemId)))
    return { ok: true }
  }),

  obterAprovacao: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, input.ordemId) }) ?? null
  }),

  aprovarCotacao: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number(), cotacaoId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    const cotacao = await db.query.ordemCotacoesFrete.findFirst({ where: and(eq(ordemCotacoesFrete.id, input.cotacaoId), eq(ordemCotacoesFrete.ordemId, input.ordemId)) })
    if (!cotacao) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cotação não encontrada' })

    const existente = await db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, input.ordemId) })
    const values = { cotacaoSelecionadaId: input.cotacaoId, retiradaLocal: false, semFrete: false, aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite() }
    if (existente) await db.update(ordemAprovacaoFrete).set(values).where(eq(ordemAprovacaoFrete.ordemId, input.ordemId))
    else await db.insert(ordemAprovacaoFrete).values({ ordemId: input.ordemId, ...values })

    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'approval', description: `Cotação de frete #${cotacao.numeroSequencial} aprovada`, stage: ordem.stage })
    return { ok: true }
  }),

  definirRetiradaLocal: adminProcedure
    .input(z.object({ ordemId: z.number(), retiradaEmpresa: z.string().optional(), retiradaData: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const existente = await db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, input.ordemId) })
      const values = {
        retiradaLocal: true,
        retiradaEmpresa: input.retiradaEmpresa,
        retiradaData: input.retiradaData,
        cotacaoSelecionadaId: null,
        semFrete: false,
        aprovadoPor: ctx.user.id,
        aprovadoEm: agoraSqlite(),
      }
      if (existente) await db.update(ordemAprovacaoFrete).set(values).where(eq(ordemAprovacaoFrete.ordemId, input.ordemId))
      else await db.insert(ordemAprovacaoFrete).values({ ordemId: input.ordemId, ...values })
      await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'update', description: 'Definida retirada local', stage: ordem.stage })
      return { ok: true }
    }),

  definirSemFrete: adminProcedure.input(z.object({ ordemId: z.number(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    const existente = await db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, input.ordemId) })
    const values = {
      semFrete: true,
      semFreteObservacoes: input.observacoes,
      cotacaoSelecionadaId: null,
      retiradaLocal: false,
      aprovadoPor: ctx.user.id,
      aprovadoEm: agoraSqlite(),
    }
    if (existente) await db.update(ordemAprovacaoFrete).set(values).where(eq(ordemAprovacaoFrete.ordemId, input.ordemId))
    else await db.insert(ordemAprovacaoFrete).values({ ordemId: input.ordemId, ...values })
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'update', description: 'Marcado como "sem frete"', stage: ordem.stage })
    return { ok: true }
  }),

  // Marca do operador — "cotação finalizada" (acende selo na frente do card).
  finalizarCotacao: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), finalizado: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const existente = await db.query.ordemAprovacaoFrete.findFirst({ where: eq(ordemAprovacaoFrete.ordemId, input.ordemId) })
      const values = {
        cotacaoFinalizada: input.finalizado,
        cotacaoFinalizadaEm: input.finalizado ? agoraSqlite() : null,
        cotacaoFinalizadaPor: input.finalizado ? ctx.user.id : null,
      }
      if (existente) await db.update(ordemAprovacaoFrete).set(values).where(eq(ordemAprovacaoFrete.ordemId, input.ordemId))
      else await db.insert(ordemAprovacaoFrete).values({ ordemId: input.ordemId, ...values })
      await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: input.finalizado ? 'Cotação finalizada' : 'Finalização da cotação desfeita', stage: ordem.stage })
      return { ok: true }
    }),

  obterFreteFinalizado: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemFreteFinalizado.findFirst({ where: eq(ordemFreteFinalizado.ordemId, input.ordemId) }) ?? null
  }),

  confirmarFreteFinalizado: adminProcedure.input(z.object({ ordemId: z.number(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    const existente = await db.query.ordemFreteFinalizado.findFirst({ where: eq(ordemFreteFinalizado.ordemId, input.ordemId) })
    const values = { confirmado: true, confirmadoPor: ctx.user.id, confirmadoEm: agoraSqlite(), observacoes: input.observacoes }
    if (existente) await db.update(ordemFreteFinalizado).set(values).where(eq(ordemFreteFinalizado.ordemId, input.ordemId))
    else await db.insert(ordemFreteFinalizado).values({ ordemId: input.ordemId, ...values })
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: 'Frete finalizado confirmado', stage: ordem.stage })
    return { ok: true }
  }),
})
