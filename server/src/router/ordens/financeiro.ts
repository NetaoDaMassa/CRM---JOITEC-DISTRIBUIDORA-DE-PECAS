// Liberação Financeira e dados do Pedido (etapas "liberacao_financeira" e
// "pedido") — só gestor aprova, mas edição de campo é liberada pro
// vendedor também (ele que costuma preencher os dados do pedido).
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemLiberacaoFinanceira, ordemDetalhes } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'

// "«antes» → «depois»" pra registrar a versão da observação no histórico.
export function diffObs(label: string, antes: string | null, depois: string | null | undefined): string {
  return `${label}: «${(antes ?? '').trim() || '—'}» → «${(depois ?? '').trim() || '—'}»`
}

async function upsertLiberacao(ordemId: number, values: Record<string, unknown>) {
  const existente = await db.query.ordemLiberacaoFinanceira.findFirst({ where: eq(ordemLiberacaoFinanceira.ordemId, ordemId) })
  if (existente) {
    await db.update(ordemLiberacaoFinanceira).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemLiberacaoFinanceira.ordemId, ordemId))
  } else {
    await db.insert(ordemLiberacaoFinanceira).values({ ordemId, ...values })
  }
}

async function upsertDetalhes(ordemId: number, values: Record<string, unknown>) {
  const existente = await db.query.ordemDetalhes.findFirst({ where: eq(ordemDetalhes.ordemId, ordemId) })
  if (existente) {
    await db.update(ordemDetalhes).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemDetalhes.ordemId, ordemId))
  } else {
    await db.insert(ordemDetalhes).values({ ordemId, ...values })
  }
}

export const ordensFinanceiroRouter = router({
  obterLiberacao: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemLiberacaoFinanceira.findFirst({ where: eq(ordemLiberacaoFinanceira.ordemId, input.ordemId) }) ?? null
  }),

  atualizarLiberacao: adminProcedure
    .input(
      z.object({
        ordemId: z.number(),
        formaPagamento: z.string().optional(),
        condicaoPagamento: z.string().optional(),
        dataPagamentoPrevista: z.string().optional(),
        observacoes: z.string().optional(),
        travar: z.boolean().optional(), // true = trava a observação após salvar; false = destrava (gestor "Editar")
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const atual = await db.query.ordemLiberacaoFinanceira.findFirst({ where: eq(ordemLiberacaoFinanceira.ordemId, input.ordemId) })
      const { ordemId, travar, ...values } = input
      const obsMudou = values.observacoes !== undefined && values.observacoes !== (atual?.observacoes ?? null)
      if (atual?.obsTravadaEm && obsMudou && travar !== false && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Observação travada — só o gestor pode editar (use 'Editar')." })
      }
      const extra: Record<string, unknown> = {}
      if (travar === true) { extra.obsTravadaEm = agoraSqlite(); extra.obsTravadaPor = ctx.user.id }
      else if (travar === false) { extra.obsTravadaEm = null; extra.obsTravadaPor = null }
      await upsertLiberacao(ordemId, { ...values, ...extra })
      if (obsMudou) {
        await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'update', description: diffObs('Observações da liberação financeira', atual?.observacoes ?? null, values.observacoes), stage: ordem.stage })
      }
      return { ok: true }
    }),

  aprovarLiberacao: adminProcedure.input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    await upsertLiberacao(input.ordemId, { aprovado: true, aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite() })
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'approval', description: 'Liberação financeira aprovada', stage: ordem.stage })
    return { ok: true }
  }),

  obterDetalhes: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemDetalhes.findFirst({ where: eq(ordemDetalhes.ordemId, input.ordemId) }) ?? null
  }),

  atualizarDetalhes: adminProcedure
    .input(
      z.object({
        ordemId: z.number(),
        numeroPedido: z.string().optional(),
        observacoes: z.string().optional(),
        prioridadeDespacho: z.enum(['normal', 'urgente', 'lead', 'direto']).optional(),
        comissaoRevenda: z.string().optional(),
        valorPedido: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId, ctx.user.id, ctx.user.role)
      const { ordemId, ...values } = input
      await upsertDetalhes(ordemId, values)
      await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'update', description: 'Dados do pedido atualizados', stage: ordem.stage })
      return { ok: true }
    }),
})
