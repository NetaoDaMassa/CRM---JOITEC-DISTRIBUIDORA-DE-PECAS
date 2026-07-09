import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { regions, ddds, regionVendors, roundRobinState, users } from '../db/schema.js'

export const regionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.regions.findMany({
      where: eq(regions.companyId, ctx.user.companyId),
      with: {
        ddds: true,
        regionVendors: { with: { vendor: { columns: { passwordHash: false } } } },
        roundRobinState: true,
      },
      orderBy: (r, { asc }) => [asc(r.name)],
    })
  }),

  roundRobinStatus: protectedProcedure.query(async ({ ctx }) => {
    const allRegions = await db.query.regions.findMany({
      where: eq(regions.companyId, ctx.user.companyId),
      with: {
        regionVendors: {
          with: { vendor: { columns: { passwordHash: false } } },
        },
        roundRobinState: true,
      },
      orderBy: (r, { asc }) => [asc(r.name)],
    })

    return allRegions.map((reg) => {
      const activeVendors = reg.regionVendors.filter((rv) => rv.vendor.isActive)
      const nextIndex = reg.roundRobinState
        ? reg.roundRobinState.nextIndex % Math.max(activeVendors.length, 1)
        : 0
      const nextVendor = activeVendors[nextIndex]?.vendor ?? null
      return {
        regionId: reg.id,
        regionName: reg.name,
        vendors: activeVendors.map((rv) => rv.vendor),
        nextVendor,
        nextIndex: reg.roundRobinState?.nextIndex ?? 0,
      }
    })
  }),

  addDDD: adminProcedure
    .input(z.object({ regionId: z.number(), ddd: z.number().min(11).max(99) }))
    .mutation(async ({ ctx, input }) => {
      const region = await db.query.regions.findFirst({ where: eq(regions.id, input.regionId) })
      if (!region || region.companyId !== ctx.user.companyId) throw new Error('Região inválida')
      await db.insert(ddds).values({ ddd: input.ddd, regionId: input.regionId, companyId: ctx.user.companyId })
      return { success: true }
    }),

  removeDDD: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(ddds)
        .where(and(eq(ddds.id, input.id), eq(ddds.companyId, ctx.user.companyId)))
      return { success: true }
    }),

  addVendor: adminProcedure
    .input(z.object({ regionId: z.number(), vendorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const region = await db.query.regions.findFirst({ where: eq(regions.id, input.regionId) })
      if (!region || region.companyId !== ctx.user.companyId) throw new Error('Região inválida')
      const vendor = await db.query.users.findFirst({ where: eq(users.id, input.vendorId) })
      if (!vendor || vendor.companyId !== ctx.user.companyId) throw new Error('Vendedor inválido')

      const existing = await db.query.regionVendors.findFirst({
        where: (rv, { and, eq }) =>
          and(eq(rv.regionId, input.regionId), eq(rv.vendorId, input.vendorId)),
      })
      if (existing) throw new Error('Vendedor já associado a esta região')
      await db.insert(regionVendors).values(input)
      return { success: true }
    }),

  removeVendor: adminProcedure
    .input(z.object({ regionId: z.number(), vendorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const region = await db.query.regions.findFirst({ where: eq(regions.id, input.regionId) })
      if (!region || region.companyId !== ctx.user.companyId) throw new Error('Região inválida')

      await db
        .delete(regionVendors)
        .where(
          and(
            eq(regionVendors.regionId, input.regionId),
            eq(regionVendors.vendorId, input.vendorId)
          )
        )
      return { success: true }
    }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.regions.findFirst({
        where: and(eq(regions.companyId, ctx.user.companyId), eq(regions.name, input.name)),
      })
      if (existing) throw new Error('Já existe uma região com esse nome')

      const [result] = await db.insert(regions).values({ name: input.name, companyId: ctx.user.companyId })
      await db.insert(roundRobinState).values({ regionId: result.insertId, nextIndex: 0 })
      return { id: result.insertId }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(regions)
        .where(and(eq(regions.id, input.id), eq(regions.companyId, ctx.user.companyId)))
      return { success: true }
    }),
})
