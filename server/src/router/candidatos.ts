import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { candidates } from '../db/schema.js'

const STATUS_VALUES = ['novo', 'em_analise', 'entrevista', 'aprovado', 'reprovado'] as const

export const candidatosRouter = router({
  list: featureProcedure('candidatos')
    .input(z.object({ jobPostingId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await db.query.candidates.findMany({
        where: eq(candidates.empresaId, ctx.empresaId),
        with: { jobPosting: true },
        orderBy: (c, { desc }) => [desc(c.createdAt)],
      })
      return input?.jobPostingId ? rows.filter((c) => c.jobPostingId === input.jobPostingId) : rows
    }),

  updateStatus: featureProcedure('candidatos')
    .input(z.object({ id: z.number(), status: z.enum(STATUS_VALUES) }))
    .mutation(async ({ ctx, input }) => {
      const candidato = await db.query.candidates.findFirst({ where: eq(candidates.id, input.id) })
      if (!candidato || candidato.empresaId !== ctx.empresaId) throw new Error('Candidato não encontrado')
      await db.update(candidates).set({ status: input.status }).where(eq(candidates.id, input.id))
      return { success: true }
    }),
})
