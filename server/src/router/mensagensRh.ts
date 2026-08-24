import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { candidateMessageTemplates } from '../db/schema.js'

const templateInput = z.object({
  label: z.string().min(1),
  whatsappText: z.string().min(1),
})

export const mensagensRhRouter = router({
  list: featureProcedure('mensagens_rh').query(async ({ ctx }) => {
    return db.query.candidateMessageTemplates.findMany({
      where: eq(candidateMessageTemplates.empresaId, ctx.empresaId),
      orderBy: (t, { asc }) => [asc(t.id)],
    })
  }),

  create: featureProcedure('mensagens_rh')
    .input(templateInput)
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(candidateMessageTemplates).values({ ...input, empresaId: ctx.empresaId })
      return { id: Number(result.lastInsertRowid) }
    }),

  update: featureProcedure('mensagens_rh')
    .input(templateInput.extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const alvo = await db.query.candidateMessageTemplates.findFirst({ where: eq(candidateMessageTemplates.id, id) })
      if (!alvo || alvo.empresaId !== ctx.empresaId) throw new Error('Mensagem não encontrada')

      await db
        .update(candidateMessageTemplates)
        .set({ ...rest, updatedAt: new Date().toISOString() })
        .where(eq(candidateMessageTemplates.id, id))
      return { success: true }
    }),

  delete: featureProcedure('mensagens_rh').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await db
      .delete(candidateMessageTemplates)
      .where(and(eq(candidateMessageTemplates.id, input.id), eq(candidateMessageTemplates.empresaId, ctx.empresaId)))
    return { success: true }
  }),
})
