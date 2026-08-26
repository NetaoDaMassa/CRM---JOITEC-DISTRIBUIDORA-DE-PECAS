// Almoxarifado (Odin Compressores) — porta-pallets, vagas, máquinas em
// estoque e catálogo de modelos. Portado de app/routers/inventory.py do
// odincrm. No sistema original, TUDO aqui (incl. listar) é gestor-only,
// exceto o catálogo de modelos (leitura aberta pra qualquer autenticado —
// usado pra sugerir o campo "modelo" em outras telas).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, estoquePortaPallets, estoqueVagas, estoqueMaquinas, estoqueCatalogoModelos } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

const SLUG_ESTOQUE = 'odin-compressores'

async function assertEmpresaEstoque(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_ESTOQUE) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

export const estoqueRouter = router({
  // ── Porta-pallets ──────────────────────────────────────────────────────
  listarRacks: adminProcedure.query(async ({ ctx }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    return db.query.estoquePortaPallets.findMany({
      where: eq(estoquePortaPallets.empresaId, ctx.empresaId),
      with: { vagas: { with: { maquinas: { columns: { id: true, numeroSerie: true, modelo: true, porte: true } } } } },
      orderBy: (r, { asc }) => [asc(r.codigo)],
    })
  }),

  criarRack: adminProcedure.input(z.object({ codigo: z.string().min(1), andaresCount: z.number().min(1).default(1), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const result = await db.insert(estoquePortaPallets).values({ empresaId: ctx.empresaId, ...input })
    return { id: Number(result.lastInsertRowid) }
  }),

  atualizarRack: adminProcedure.input(z.object({ id: z.number(), codigo: z.string().optional(), andaresCount: z.number().optional(), observacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const { id, ...values } = input
    await db.update(estoquePortaPallets).set({ ...values, updatedAt: agoraSqlite() }).where(and(eq(estoquePortaPallets.id, id), eq(estoquePortaPallets.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  excluirRack: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    await db.delete(estoqueVagas).where(eq(estoqueVagas.portaPalletId, input.id))
    await db.delete(estoquePortaPallets).where(and(eq(estoquePortaPallets.id, input.id), eq(estoquePortaPallets.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ── Vagas ──────────────────────────────────────────────────────────────
  criarVagas: adminProcedure
    .input(z.object({ portaPalletId: z.number(), andar: z.number(), quantidade: z.number().min(1).max(50), capacidade: z.number().min(1).default(2) }))
    .mutation(async ({ input }) => {
      const existentes = await db.query.estoqueVagas.findMany({ where: and(eq(estoqueVagas.portaPalletId, input.portaPalletId), eq(estoqueVagas.andar, input.andar)) })
      const proximaPosicao = existentes.reduce((acc, v) => Math.max(acc, v.posicao), 0) + 1
      const criadas = []
      for (let i = 0; i < input.quantidade; i++) {
        const result = await db.insert(estoqueVagas).values({ portaPalletId: input.portaPalletId, andar: input.andar, posicao: proximaPosicao + i, capacidade: input.capacidade })
        criadas.push(Number(result.lastInsertRowid))
      }
      return { ids: criadas }
    }),

  excluirVaga: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.delete(estoqueVagas).where(eq(estoqueVagas.id, input.id))
    return { ok: true }
  }),

  // ── Máquinas em estoque ────────────────────────────────────────────────
  listarMaquinas: adminProcedure.input(z.object({ q: z.string().optional(), status: z.string().optional() })).query(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const todas = await db.query.estoqueMaquinas.findMany({
      where: eq(estoqueMaquinas.empresaId, ctx.empresaId),
      with: { vaga: { with: { portaPallet: true } }, ordem: { columns: { id: true } } },
      orderBy: (m, { desc }) => [desc(m.createdAt)],
    })
    return todas.filter((m) => {
      if (input.status && m.status !== input.status) return false
      if (input.q) {
        const q = input.q.toLowerCase()
        if (!m.numeroSerie.toLowerCase().includes(q) && !m.modelo?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }),

  criarMaquina: adminProcedure
    .input(
      z.object({
        numeroSerie: z.string().min(1),
        modelo: z.string().optional(),
        voltagem: z.string().optional(),
        pressaoBar: z.string().optional(),
        porte: z.enum(['pequeno', 'grande']).optional(),
        dataEntrada: z.string().optional(),
        observacoes: z.string().optional(),
        vagaId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaEstoque(ctx.empresaId)
      const result = await db.insert(estoqueMaquinas).values({ empresaId: ctx.empresaId, criadoPor: ctx.user.id, ...input })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizarMaquina: adminProcedure
    .input(
      z.object({
        id: z.number(),
        numeroSerie: z.string().optional(),
        modelo: z.string().optional(),
        voltagem: z.string().optional(),
        pressaoBar: z.string().optional(),
        porte: z.enum(['pequeno', 'grande']).optional(),
        status: z.enum(['estoque', 'reservada', 'alocada', 'vendida']).optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaEstoque(ctx.empresaId)
      const { id, ...values } = input
      await db.update(estoqueMaquinas).set({ ...values, updatedAt: agoraSqlite() }).where(and(eq(estoqueMaquinas.id, id), eq(estoqueMaquinas.empresaId, ctx.empresaId)))
      return { ok: true }
    }),

  alocarVaga: adminProcedure.input(z.object({ id: z.number(), vagaId: z.number().nullable() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    await db.update(estoqueMaquinas).set({ vagaId: input.vagaId, updatedAt: agoraSqlite() }).where(and(eq(estoqueMaquinas.id, input.id), eq(estoqueMaquinas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  alocarOrdem: adminProcedure.input(z.object({ id: z.number(), ordemId: z.number().nullable() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    await db
      .update(estoqueMaquinas)
      .set({ ordemId: input.ordemId, status: input.ordemId ? 'alocada' : 'estoque', updatedAt: agoraSqlite() })
      .where(and(eq(estoqueMaquinas.id, input.id), eq(estoqueMaquinas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  excluirMaquina: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    await db.delete(estoqueMaquinas).where(and(eq(estoqueMaquinas.id, input.id), eq(estoqueMaquinas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ── Catálogo de modelos ────────────────────────────────────────────────
  listarCatalogo: adminProcedure.input(z.object({ q: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const todos = await db.query.estoqueCatalogoModelos.findMany({ where: eq(estoqueCatalogoModelos.empresaId, ctx.empresaId), orderBy: (c, { asc }) => [asc(c.categoria), asc(c.modelo)] })
    if (!input?.q) return todos
    const q = input.q.toLowerCase()
    return todos.filter((c) => c.modelo.toLowerCase().includes(q) || c.categoria.toLowerCase().includes(q))
  }),

  criarCatalogo: adminProcedure.input(z.object({ categoria: z.string().min(1), linha: z.string().optional(), modelo: z.string().min(1), especificacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const result = await db.insert(estoqueCatalogoModelos).values({ empresaId: ctx.empresaId, ...input })
    return { id: Number(result.lastInsertRowid) }
  }),

  atualizarCatalogo: adminProcedure.input(z.object({ id: z.number(), categoria: z.string().optional(), linha: z.string().optional(), modelo: z.string().optional(), especificacoes: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    const { id, ...values } = input
    await db.update(estoqueCatalogoModelos).set({ ...values, updatedAt: agoraSqlite() }).where(and(eq(estoqueCatalogoModelos.id, id), eq(estoqueCatalogoModelos.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  excluirCatalogo: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaEstoque(ctx.empresaId)
    await db.delete(estoqueCatalogoModelos).where(and(eq(estoqueCatalogoModelos.id, input.id), eq(estoqueCatalogoModelos.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
})
