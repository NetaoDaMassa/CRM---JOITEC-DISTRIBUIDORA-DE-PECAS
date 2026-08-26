import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemFaturamento } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'

export const ordensFaturamentoRouter = router({
  obter: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemFaturamento.findFirst({ where: eq(ordemFaturamento.ordemId, input.ordemId) }) ?? null
  }),

  atualizar: adminProcedure
    .input(
      z.object({
        ordemId: z.number(),
        dataPagamento: z.string().optional(),
        numeroNotaFiscal: z.string().optional(),
        numeroPicking: z.string().optional(),
        dataFaturamento: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { ordemId, ...values } = input
      const existente = await db.query.ordemFaturamento.findFirst({ where: eq(ordemFaturamento.ordemId, ordemId) })
      if (existente) await db.update(ordemFaturamento).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemFaturamento.ordemId, ordemId))
      else await db.insert(ordemFaturamento).values({ ordemId, ...values })
      return { ok: true }
    }),

  confirmar: adminProcedure.input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    const existente = await db.query.ordemFaturamento.findFirst({ where: eq(ordemFaturamento.ordemId, input.ordemId) })
    const values = { pagamentoConfirmado: true, confirmadoPor: ctx.user.id, confirmadoEm: agoraSqlite() }
    if (existente) await db.update(ordemFaturamento).set(values).where(eq(ordemFaturamento.ordemId, input.ordemId))
    else await db.insert(ordemFaturamento).values({ ordemId: input.ordemId, ...values })
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: 'Pagamento confirmado (faturamento)', stage: ordem.stage })
    return { ok: true }
  }),
})
