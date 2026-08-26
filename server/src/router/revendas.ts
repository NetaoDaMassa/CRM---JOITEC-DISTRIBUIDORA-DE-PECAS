// Lista de Revendas (Odin Compressores) — CRUD simples, portado de
// app/routers/settings.py (seção revendas) do odincrm. Listar é liberado
// pra qualquer um com a feature; criar/editar/excluir é gestor-only.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, revendas } from '../db/schema.js'

const SLUG_REVENDAS = 'odin-compressores'

async function assertEmpresaRevendas(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_REVENDAS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

export const revendasRouter = router({
  listar: adminOrFeatureProcedure('revendas_odin').query(async ({ ctx }) => {
    await assertEmpresaRevendas(ctx.empresaId)
    return db.query.revendas.findMany({ where: eq(revendas.empresaId, ctx.empresaId), orderBy: (r, { asc }) => [asc(r.nome)] })
  }),

  criar: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        nomeContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        observacoes: z.string().optional(),
        responsavel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaRevendas(ctx.empresaId)
      const result = await db.insert(revendas).values({ empresaId: ctx.empresaId, criadoPor: ctx.user.id, ...input })
      return db.query.revendas.findFirst({ where: eq(revendas.id, Number(result.lastInsertRowid)) })
    }),

  atualizar: adminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().optional(),
        nomeContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        observacoes: z.string().optional(),
        responsavel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaRevendas(ctx.empresaId)
      const { id, ...values } = input
      await db.update(revendas).set(values).where(and(eq(revendas.id, id), eq(revendas.empresaId, ctx.empresaId)))
      return { ok: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaRevendas(ctx.empresaId)
    await db.delete(revendas).where(and(eq(revendas.id, input.id), eq(revendas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
})
