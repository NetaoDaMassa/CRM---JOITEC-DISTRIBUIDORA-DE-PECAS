// Preparação (dados + aprovação do gestor) e as máquinas físicas do pedido.
// Regra de fotos obrigatórias por máquina (placa/vaso/válvula pra
// compressor, placa pra secador/separador — conforme prefixo do modelo)
// replicada aqui igual ao stage_service.approve_preparation do odincrm.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordemPreparacao, ordemMaquinas, ordemAnexos } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { assertEmpresaOrdens, assertOrdemAlcancavel } from './core.js'
import { diffObs } from './financeiro.js'

// Categorias de foto exigidas por tipo de máquina, inferido do prefixo do
// modelo — mesma convenção `{categoria}__{maquinaId}` do odincrm original.
function categoriasObrigatorias(modelo: string): string[] {
  const prefixo = modelo.trim().toUpperCase()
  if (prefixo.startsWith('OD')) return ['placa_vaso_pressao', 'placa_compressor', 'vaso_pressao', 'valvula_seguranca']
  if (prefixo.startsWith('SEC') || prefixo.startsWith('SEP')) return ['placa']
  return []
}

export const ordensPreparacaoRouter = router({
  obterPreparacao: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemPreparacao.findFirst({ where: eq(ordemPreparacao.ordemId, input.ordemId) }) ?? null
  }),

  atualizarPreparacao: adminProcedure
    .input(z.object({ ordemId: z.number(), dataEntradaEstoque: z.string().optional(), observacoes: z.string().optional(), travar: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { ordemId, travar, ...values } = input
      const existente = await db.query.ordemPreparacao.findFirst({ where: eq(ordemPreparacao.ordemId, ordemId) })
      const obsMudou = values.observacoes !== undefined && values.observacoes !== (existente?.observacoes ?? null)
      if (existente?.obsTravadaEm && obsMudou && travar !== false && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Observação travada — só o gestor pode editar (use 'Editar')." })
      }
      const extra: Record<string, unknown> = {}
      if (travar === true) { extra.obsTravadaEm = agoraSqlite(); extra.obsTravadaPor = ctx.user.id }
      else if (travar === false) { extra.obsTravadaEm = null; extra.obsTravadaPor = null }
      const set = { ...values, ...extra }
      if (existente) await db.update(ordemPreparacao).set({ ...set, updatedAt: agoraSqlite() }).where(eq(ordemPreparacao.ordemId, ordemId))
      else await db.insert(ordemPreparacao).values({ ordemId, ...set })
      if (obsMudou) {
        await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'update', description: diffObs('Observações da preparação', existente?.observacoes ?? null, values.observacoes), stage: ordem.stage })
      }
      return { ok: true }
    }),

  finalizarPreparacao: adminOrFeatureProcedure('pedidos_odin')
    .input(z.object({ ordemId: z.number(), finalizado: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const existente = await db.query.ordemPreparacao.findFirst({ where: eq(ordemPreparacao.ordemId, input.ordemId) })
      const values = {
        operadorFinalizou: input.finalizado,
        operadorFinalizouEm: input.finalizado ? agoraSqlite() : null,
        operadorFinalizouPor: input.finalizado ? ctx.user.id : null,
      }
      if (existente) await db.update(ordemPreparacao).set(values).where(eq(ordemPreparacao.ordemId, input.ordemId))
      else await db.insert(ordemPreparacao).values({ ordemId: input.ordemId, ...values })
      await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'confirmation', description: input.finalizado ? 'Operador finalizou a preparação' : 'Operador desfez a finalização da preparação', stage: ordem.stage })
      return { ok: true }
    }),

  aprovarPreparacao: adminProcedure.input(z.object({ ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)

    if (ordem.orderType === 'maquina') {
      const maquinas = await db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, input.ordemId) })
      if (maquinas.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Vincule ao menos uma máquina antes de aprovar a preparação' })

      for (const maquina of maquinas) {
        for (const categoria of categoriasObrigatorias(maquina.modelo)) {
          const anexo = await db.query.ordemAnexos.findFirst({
            where: and(eq(ordemAnexos.ordemId, input.ordemId), eq(ordemAnexos.fileCategory, `${categoria}__${maquina.id}`)),
          })
          if (!anexo) throw new TRPCError({ code: 'BAD_REQUEST', message: `Falta a foto "${categoria}" da máquina ${maquina.modelo} (${maquina.numeroSerie ?? 's/ nº série'})` })
        }
      }
    }

    const existente = await db.query.ordemPreparacao.findFirst({ where: eq(ordemPreparacao.ordemId, input.ordemId) })
    const values = { aprovadoGestor: true, aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite() }
    if (existente) await db.update(ordemPreparacao).set(values).where(eq(ordemPreparacao.ordemId, input.ordemId))
    else await db.insert(ordemPreparacao).values({ ordemId: input.ordemId, ...values })

    await registrarHistoricoOrdem({ ordemId: input.ordemId, userId: ctx.user.id, action: 'approval', description: 'Preparação aprovada', stage: ordem.stage })
    return { ok: true }
  }),

  listarMaquinas: adminOrFeatureProcedure('pedidos_odin').input(z.object({ ordemId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    return db.query.ordemMaquinas.findMany({ where: eq(ordemMaquinas.ordemId, input.ordemId) })
  }),

  criarMaquina: adminProcedure.input(z.object({ ordemId: z.number(), modelo: z.string().min(1), numeroSerie: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    const result = await db.insert(ordemMaquinas).values(input)
    return { id: Number(result.lastInsertRowid) }
  }),

  atualizarMaquina: adminProcedure
    .input(z.object({ id: z.number(), ordemId: z.number(), modelo: z.string().min(1).optional(), numeroSerie: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
      const { id, ordemId, ...values } = input
      await db.update(ordemMaquinas).set(values).where(and(eq(ordemMaquinas.id, id), eq(ordemMaquinas.ordemId, ordemId)))
      return { ok: true }
    }),

  excluirMaquina: adminProcedure.input(z.object({ id: z.number(), ordemId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.ordemId, ctx.empresaId)
    await db.delete(ordemMaquinas).where(and(eq(ordemMaquinas.id, input.id), eq(ordemMaquinas.ordemId, input.ordemId)))
    return { ok: true }
  }),
})
