import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leadRegions, leadDdds, leadRegionVendedores, leadRoundRobinState, users } from '../db/schema.js'

// Controle de regiões/DDDs/vendedores-por-região/rodízio do módulo de Leads
// — restrito ao superAdmin ("admin principal"), fase 2 do plano em
// /Users/weslley/.claude/plans/stateful-soaring-moore.md (Bloco F). As
// tabelas já existem desde a fase 1 (server/src/db/schema.ts) — aqui só a
// tela de gerenciar o que antes só dava pra editar direto no banco.
export const leadsRegioesRouter = router({
  listarRegioes: superAdminProcedure.query(async ({ ctx }) => {
    const regioes = await db.query.leadRegions.findMany({
      where: eq(leadRegions.empresaId, ctx.empresaId),
      orderBy: [asc(leadRegions.name)],
      with: {
        ddds: true,
        vendedores: { with: { vendor: { columns: { id: true, name: true } } } },
      },
    })
    const estados = await db.query.leadRoundRobinState.findMany()
    const estadoPorRegiao = new Map(estados.map((e) => [e.regionId, e]))

    return regioes.map((r) => ({
      id: r.id,
      name: r.name,
      ddds: r.ddds.map((d) => ({ id: d.id, ddd: d.ddd })),
      vendedores: r.vendedores.map((v) => ({ id: v.id, vendorId: v.vendorId, nome: v.vendor.name })),
      rodizio: estadoPorRegiao.get(r.id) ? { nextIndex: estadoPorRegiao.get(r.id)!.nextIndex } : null,
    }))
  }),

  criarRegiao: superAdminProcedure
    .input(z.object({ nome: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(leadRegions).values({ empresaId: ctx.empresaId, name: input.nome.trim() })
      return { id: Number(result.lastInsertRowid) }
    }),

  renomearRegiao: superAdminProcedure
    .input(z.object({ id: z.number(), nome: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const regiao = await db.query.leadRegions.findFirst({ where: eq(leadRegions.id, input.id) })
      if (!regiao || regiao.empresaId !== ctx.empresaId) throw new Error('Região não encontrada')
      await db
        .update(leadRegions)
        .set({ name: input.nome.trim(), updatedAt: new Date().toISOString() })
        .where(eq(leadRegions.id, input.id))
      return { ok: true }
    }),

  excluirRegiao: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const regiao = await db.query.leadRegions.findFirst({ where: eq(leadRegions.id, input.id) })
    if (!regiao || regiao.empresaId !== ctx.empresaId) throw new Error('Região não encontrada')
    // Cascade no schema já apaga ddds/vendedores/rodízio vinculados — leads
    // que referenciam essa região ficam com region_id nulo (onDelete: set null).
    await db.delete(leadRegions).where(eq(leadRegions.id, input.id))
    return { ok: true }
  }),

  adicionarDdd: superAdminProcedure
    .input(z.object({ regionId: z.number(), ddd: z.number().min(11).max(99) }))
    .mutation(async ({ ctx, input }) => {
      const regiao = await db.query.leadRegions.findFirst({ where: eq(leadRegions.id, input.regionId) })
      if (!regiao || regiao.empresaId !== ctx.empresaId) throw new Error('Região não encontrada')
      const existente = await db.query.leadDdds.findFirst({
        where: and(eq(leadDdds.empresaId, ctx.empresaId), eq(leadDdds.ddd, input.ddd)),
      })
      if (existente) throw new Error(`DDD ${input.ddd} já está vinculado a outra região desta empresa`)
      await db.insert(leadDdds).values({ empresaId: ctx.empresaId, ddd: input.ddd, regionId: input.regionId })
      return { ok: true }
    }),

  removerDdd: superAdminProcedure.input(z.object({ dddId: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.leadDdds.findFirst({ where: eq(leadDdds.id, input.dddId) })
    if (!registro || registro.empresaId !== ctx.empresaId) throw new Error('DDD não encontrado')
    await db.delete(leadDdds).where(eq(leadDdds.id, input.dddId))
    return { ok: true }
  }),

  // Só vendedores (role='vendor') da empresa ativa — pro seletor "adicionar vendedor à região".
  listarVendedoresDisponiveis: superAdminProcedure.query(async ({ ctx }) => {
    return db.query.users.findMany({
      where: and(eq(users.empresaId, ctx.empresaId), eq(users.role, 'vendor')),
      columns: { id: true, name: true, isActive: true },
      orderBy: [asc(users.name)],
    })
  }),

  adicionarVendedorRegiao: superAdminProcedure
    .input(z.object({ regionId: z.number(), vendorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const regiao = await db.query.leadRegions.findFirst({ where: eq(leadRegions.id, input.regionId) })
      if (!regiao || regiao.empresaId !== ctx.empresaId) throw new Error('Região não encontrada')
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, input.vendorId) })
      if (!vendedor || vendedor.empresaId !== ctx.empresaId || vendedor.role !== 'vendor') {
        throw new Error('Vendedor inválido')
      }
      const jaVinculado = await db.query.leadRegionVendedores.findFirst({
        where: and(eq(leadRegionVendedores.regionId, input.regionId), eq(leadRegionVendedores.vendorId, input.vendorId)),
      })
      if (jaVinculado) throw new Error('Esse vendedor já está nessa região')
      await db.insert(leadRegionVendedores).values({ regionId: input.regionId, vendorId: input.vendorId })
      return { ok: true }
    }),

  removerVendedorRegiao: superAdminProcedure.input(z.object({ vinculoId: z.number() })).mutation(async ({ input }) => {
    await db.delete(leadRegionVendedores).where(eq(leadRegionVendedores.id, input.vinculoId))
    return { ok: true }
  }),

  // Zera o cursor do rodízio de volta pro início da lista de vendedores da
  // região — ação administrativa rara (ex: depois de reorganizar o time).
  resetarRodizio: superAdminProcedure.input(z.object({ regionId: z.number() })).mutation(async ({ ctx, input }) => {
    const regiao = await db.query.leadRegions.findFirst({ where: eq(leadRegions.id, input.regionId) })
    if (!regiao || regiao.empresaId !== ctx.empresaId) throw new Error('Região não encontrada')
    const existente = await db.query.leadRoundRobinState.findFirst({ where: eq(leadRoundRobinState.regionId, input.regionId) })
    if (existente) {
      await db
        .update(leadRoundRobinState)
        .set({ nextIndex: 0, updatedAt: new Date().toISOString() })
        .where(eq(leadRoundRobinState.regionId, input.regionId))
    } else {
      await db.insert(leadRoundRobinState).values({ regionId: input.regionId, nextIndex: 0 })
    }
    return { ok: true }
  }),
})
