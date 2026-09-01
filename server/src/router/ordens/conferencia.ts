// Conferência (checklist de embalagem + por máquina) — edição liberada pro
// vendedor (é quem confere fisicamente), confirmar é gestor-only e exige o
// checklist completo (mesma regra de stage_service.confirm_conference).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemConferencia, ordemConferenciaItens, ordemMaquinas, ordemAnexos } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'
import { diffObs } from './financeiro.js'

export const ordensConferenciaRouter = router({
  obter: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemConferencia.findFirst({ where: eq(ordemConferencia.ordemId, input.ordemId) }) ?? null
  }),

  atualizar: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        ordemId: z.number(),
        placaOk: z.boolean().optional(),
        adesivoOk: z.boolean().optional(),
        fichaTecnicaOk: z.boolean().optional(),
        kitCompressor: z.boolean().optional(),
        kitReservatorio: z.boolean().optional(),
        kitSecador: z.boolean().optional(),
        inspecaoVisualAvaria: z.boolean().optional(),
        embalagemOk: z.boolean().optional(),
        embalagemPor: z.string().optional(),
        observacoes: z.string().optional(),
        observacoesGerais: z.string().optional(),
        travar: z.boolean().optional(), // trava observacoes + observacoesGerais após "Salvar"
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { ordemId, embalagemOk, travar, ...resto } = input
      const existente = await db.query.ordemConferencia.findFirst({ where: eq(ordemConferencia.ordemId, ordemId) })
      const values: Record<string, unknown> = { ...resto }
      if (embalagemOk !== undefined) {
        values.embalagemOk = embalagemOk
        if (embalagemOk) {
          values.embalagemConfirmadoPor = ctx.user.id
          values.embalagemConfirmadoEm = agoraSqlite()
        }
      }
      const camposObs = ['observacoes', 'observacoesGerais'] as const
      const mudouObs = camposObs.some((c) => resto[c] !== undefined && resto[c] !== (existente?.[c] ?? null))
      if (existente?.obsTravadaEm && mudouObs && travar !== false && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Observações da conferência travadas — só o gestor pode editar (use 'Editar')." })
      }
      if (travar === true) { values.obsTravadaEm = agoraSqlite(); values.obsTravadaPor = ctx.user.id }
      else if (travar === false) { values.obsTravadaEm = null; values.obsTravadaPor = null }
      if (existente) await db.update(ordemConferencia).set({ ...values, updatedAt: agoraSqlite() }).where(eq(ordemConferencia.ordemId, ordemId))
      else await db.insert(ordemConferencia).values({ ordemId, ...values })
      if (mudouObs) {
        const partes = camposObs
          .filter((c) => resto[c] !== undefined && resto[c] !== (existente?.[c] ?? null))
          .map((c) => diffObs(c === 'observacoesGerais' ? 'Observações da conferência' : 'Instrução de embalagem', existente?.[c] ?? null, resto[c]))
        await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'update', description: partes.join('; '), stage: ordem.stage })
      }
      return { ok: true }
    }),

  confirmar: adminProcedure.input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)

    const conf = await db.query.ordemConferencia.findFirst({ where: eq(ordemConferencia.ordemId, input.ordemId) })
    if (!conf?.embalagemOk) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Marque a embalagem como OK antes de confirmar' })

    const maquinas = await db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, input.ordemId) })
    if (maquinas.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Vincule ao menos uma máquina antes de confirmar a conferência' })

    for (const maquina of maquinas) {
      const item = await db.query.ordemConferenciaItens.findFirst({ where: and(eq(ordemConferenciaItens.ordemId, input.ordemId), eq(ordemConferenciaItens.maquinaId, maquina.id)) })
      if (item?.naoAplicavel) continue
      if (item?.inspecaoVisualAvaria === null || item?.inspecaoVisualAvaria === undefined) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Responda a inspeção visual de avaria da máquina ${maquina.modelo}` })
      }
      if (item.inspecaoVisualAvaria) {
        const anexo = await db.query.ordemAnexos.findFirst({ where: and(eq(ordemAnexos.ordemId, input.ordemId), eq(ordemAnexos.fileCategory, `avaria__${maquina.id}`)) })
        if (!anexo) throw new TRPCError({ code: 'BAD_REQUEST', message: `Anexe a foto da avaria da máquina ${maquina.modelo}` })
      }
    }

    await db.update(ordemConferencia).set({ confirmado: true, confirmadoPor: ctx.user.id, confirmadoEm: agoraSqlite() }).where(eq(ordemConferencia.ordemId, input.ordemId))
    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: 'Conferência confirmada', stage: ordem.stage })
    return { ok: true }
  }),

  listarItens: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)

    // Cria o item de conferência que ainda não existe pra cada máquina já
    // vinculada ao pedido (em Preparação) — sem isso a Conferência aparecia
    // "sem máquina vinculada" mesmo com máquina de verdade no pedido, porque
    // vincular na Preparação nunca criava a linha aqui (achado do João,
    // 2026-09-01). Idempotente: só insere o que faltar.
    const maquinasDoPedido = await db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, input.ordemId) })
    const itensExistentes = await db.query.ordemConferenciaItens.findMany({ where: eq(ordemConferenciaItens.ordemId, input.ordemId) })
    const maquinasComItem = new Set(itensExistentes.map((i) => i.maquinaId))
    const faltando = maquinasDoPedido.filter((m) => !maquinasComItem.has(m.id))
    if (faltando.length > 0) {
      await db.insert(ordemConferenciaItens).values(faltando.map((m) => ({ ordemId: input.ordemId, maquinaId: m.id })))
    }

    return db.query.ordemConferenciaItens.findMany({ where: eq(ordemConferenciaItens.ordemId, input.ordemId), with: { maquina: true } })
  }),

  atualizarItem: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        ordemId: z.number(),
        maquinaId: z.number(),
        placaOk: z.boolean().optional(),
        adesivoOk: z.boolean().optional(),
        fichaTecnicaOk: z.boolean().optional(),
        voltagemOk: z.boolean().optional(),
        kitOk: z.boolean().optional(),
        inspecaoVisualAvaria: z.boolean().optional(),
        naoAplicavel: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { ordemId, maquinaId, ...values } = input
      const existente = await db.query.ordemConferenciaItens.findFirst({ where: and(eq(ordemConferenciaItens.ordemId, ordemId), eq(ordemConferenciaItens.maquinaId, maquinaId)) })
      if (existente) await db.update(ordemConferenciaItens).set(values).where(and(eq(ordemConferenciaItens.ordemId, ordemId), eq(ordemConferenciaItens.maquinaId, maquinaId)))
      else await db.insert(ordemConferenciaItens).values({ ordemId, maquinaId, ...values })
      return { ok: true }
    }),
})
