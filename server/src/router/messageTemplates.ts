import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { messageTemplates } from '../db/schema.js'

const templateInput = z.object({
  label: z.string().min(1),
  whatsappText: z.string().min(1),
  emailSubject: z.string().min(1),
  emailBody: z.string().min(1),
})

export const messageTemplatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.messageTemplates.findMany({
      where: eq(messageTemplates.empresaId, ctx.empresaId),
      orderBy: (t, { asc }) => [asc(t.id)],
    })
  }),

  create: adminProcedure.input(templateInput).mutation(async ({ ctx, input }) => {
    const result = await db.insert(messageTemplates).values({ ...input, empresaId: ctx.empresaId })
    return { id: Number(result.lastInsertRowid) }
  }),

  update: adminProcedure
    .input(templateInput.extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const target = await db.query.messageTemplates.findFirst({
        where: and(eq(messageTemplates.id, id), eq(messageTemplates.empresaId, ctx.empresaId)),
      })
      if (!target) throw new Error('Mensagem não encontrada')

      await db
        .update(messageTemplates)
        .set({ ...rest, updatedAt: new Date().toISOString() })
        .where(eq(messageTemplates.id, id))
      return { success: true }
    }),

  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const target = await db.query.messageTemplates.findFirst({
      where: and(eq(messageTemplates.id, input.id), eq(messageTemplates.empresaId, ctx.empresaId)),
    })
    if (!target) throw new Error('Mensagem não encontrada')
    await db.delete(messageTemplates).where(eq(messageTemplates.id, input.id))
    return { success: true }
  }),
})
