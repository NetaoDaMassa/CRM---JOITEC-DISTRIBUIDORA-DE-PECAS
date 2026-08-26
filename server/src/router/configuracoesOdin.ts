// Configurações auxiliares (Odin Compressores) — condições de pagamento,
// transportadoras e modelos de e-mail. Portado de app/routers/settings.py
// do odincrm. Listar é liberado pra qualquer um com a feature; criar/
// editar/excluir é gestor-only.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, condicoesPagamento, transportadorasOdin, modelosEmailOdin } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

const SLUG_CONFIG = 'odin-compressores'

async function assertEmpresaConfig(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_CONFIG) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

export const configuracoesOdinRouter = router({
  // ── Condições de pagamento ───────────────────────────────────────────
  listarCondicoes: adminOrFeatureProcedure('configuracoes_odin').query(async ({ ctx }) => {
    await assertEmpresaConfig(ctx.empresaId)
    return db.query.condicoesPagamento.findMany({ where: eq(condicoesPagamento.empresaId, ctx.empresaId), orderBy: (c, { asc }) => [asc(c.nome)] })
  }),
  criarCondicao: adminProcedure.input(z.object({ nome: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    const result = await db.insert(condicoesPagamento).values({ empresaId: ctx.empresaId, criadoPor: ctx.user.id, nome: input.nome })
    return { id: Number(result.lastInsertRowid) }
  }),
  excluirCondicao: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    await db.delete(condicoesPagamento).where(and(eq(condicoesPagamento.id, input.id), eq(condicoesPagamento.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ── Transportadoras ───────────────────────────────────────────────────
  listarTransportadoras: adminOrFeatureProcedure('configuracoes_odin').query(async ({ ctx }) => {
    await assertEmpresaConfig(ctx.empresaId)
    return db.query.transportadorasOdin.findMany({ where: eq(transportadorasOdin.empresaId, ctx.empresaId), orderBy: (t, { asc }) => [asc(t.nome)] })
  }),
  criarTransportadora: adminProcedure.input(z.object({ nome: z.string().min(1), telefoneContato: z.string().optional(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    const result = await db.insert(transportadorasOdin).values({ empresaId: ctx.empresaId, criadoPor: ctx.user.id, ...input })
    return { id: Number(result.lastInsertRowid) }
  }),
  atualizarTransportadora: adminProcedure.input(z.object({ id: z.number(), nome: z.string().optional(), telefoneContato: z.string().optional(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    const { id, ...values } = input
    await db.update(transportadorasOdin).set(values).where(and(eq(transportadorasOdin.id, id), eq(transportadorasOdin.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
  excluirTransportadora: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    await db.delete(transportadorasOdin).where(and(eq(transportadorasOdin.id, input.id), eq(transportadorasOdin.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ── Modelos de e-mail ─────────────────────────────────────────────────
  listarModelosEmail: adminOrFeatureProcedure('configuracoes_odin').query(async ({ ctx }) => {
    await assertEmpresaConfig(ctx.empresaId)
    return db.query.modelosEmailOdin.findMany({ where: eq(modelosEmailOdin.empresaId, ctx.empresaId), orderBy: (m, { asc }) => [asc(m.nome)] })
  }),
  criarModeloEmail: adminProcedure.input(z.object({ nome: z.string().min(1), assunto: z.string().min(1), mensagem: z.string().min(1), etapa: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    const result = await db.insert(modelosEmailOdin).values({ empresaId: ctx.empresaId, criadoPor: ctx.user.id, ...input })
    return { id: Number(result.lastInsertRowid) }
  }),
  atualizarModeloEmail: adminProcedure.input(z.object({ id: z.number(), nome: z.string().optional(), assunto: z.string().optional(), mensagem: z.string().optional(), etapa: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    const { id, ...values } = input
    await db.update(modelosEmailOdin).set({ ...values, updatedAt: agoraSqlite() }).where(and(eq(modelosEmailOdin.id, id), eq(modelosEmailOdin.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
  excluirModeloEmail: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaConfig(ctx.empresaId)
    await db.delete(modelosEmailOdin).where(and(eq(modelosEmailOdin.id, input.id), eq(modelosEmailOdin.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
})
