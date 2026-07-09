import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { campaigns, leads } from '../db/schema.js'

const CHANNEL_VALUES = ['facebook', 'instagram', 'google', 'whatsapp', 'site', 'indicacao', 'outro'] as const

export const campaignsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        channel: campaigns.channel,
        description: campaigns.description,
        isActive: campaigns.isActive,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        leadCount: sql<number>`count(${leads.id})`,
      })
      .from(campaigns)
      .leftJoin(leads, eq(campaigns.id, leads.campaignId))
      .where(eq(campaigns.companyId, ctx.user.companyId))
      .groupBy(campaigns.id)
      .orderBy(campaigns.createdAt)

    return rows
  }),

  listActive: protectedProcedure.query(async ({ ctx }) => {
    return db.query.campaigns.findMany({
      where: and(eq(campaigns.isActive, true), eq(campaigns.companyId, ctx.user.companyId)),
      orderBy: (c, { asc }) => [asc(c.name)],
    })
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(2),
      channel: z.enum(CHANNEL_VALUES).default('outro'),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(campaigns).values({
        companyId: ctx.user.companyId,
        name: input.name,
        channel: input.channel,
        description: input.description || null,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(2).optional(),
      channel: z.enum(CHANNEL_VALUES).optional(),
      description: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const target = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
      if (!target || target.companyId !== ctx.user.companyId) throw new Error('Campanha não encontrada')

      const updates: Record<string, unknown> = {}
      if (rest.name !== undefined) updates.name = rest.name
      if (rest.channel !== undefined) updates.channel = rest.channel
      if (rest.description !== undefined) updates.description = rest.description
      if (rest.isActive !== undefined) updates.isActive = rest.isActive
      updates.updatedAt = new Date().toISOString()
      await db.update(campaigns).set(updates).where(eq(campaigns.id, id))
      return { success: true }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(campaigns)
        .where(and(eq(campaigns.id, input.id), eq(campaigns.companyId, ctx.user.companyId)))
      return { success: true }
    }),
})
