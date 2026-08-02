import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { notifications } from '../db/schema.js'

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.notifications.findMany({
      where: eq(notifications.vendedorId, ctx.user.id),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    })
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.id, input.id), eq(notifications.vendedorId, ctx.user.id)))
      return { success: true }
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.vendedorId, ctx.user.id), eq(notifications.read, false)))
    return { success: true }
  }),
})
