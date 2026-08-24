import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { jobPostings } from '../db/schema.js'

export const vagasRouter = router({
  list: featureProcedure('vagas').query(async ({ ctx }) => {
    return db.query.jobPostings.findMany({
      where: eq(jobPostings.empresaId, ctx.empresaId),
      orderBy: (j, { desc }) => [desc(j.createdAt)],
    })
  }),

  create: featureProcedure('vagas')
    .input(
      z.object({
        title: z.string().min(2),
        description: z.string().min(1),
        benefits: z.string().optional(),
        requirements: z.string().optional(),
        city: z.string().optional(),
        // Só superAdmin publica em mais de uma empresa de uma vez; pra
        // qualquer outro admin esse campo é ignorado, sempre publica na
        // própria empresa ativa.
        empresaIds: z.array(z.number()).min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const targetEmpresaIds = ctx.user.superAdmin && input.empresaIds?.length ? input.empresaIds : [ctx.empresaId]

      const ids: number[] = []
      for (const empresaId of targetEmpresaIds) {
        const result = await db.insert(jobPostings).values({
          empresaId,
          title: input.title,
          description: input.description,
          benefits: input.benefits || null,
          requirements: input.requirements || null,
          city: input.city || null,
          createdBy: ctx.user.id,
        })
        ids.push(Number(result.lastInsertRowid))
      }
      return { ids }
    }),

  update: featureProcedure('vagas')
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(2).optional(),
        description: z.string().min(1).optional(),
        benefits: z.string().optional(),
        requirements: z.string().optional(),
        city: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const vaga = await db.query.jobPostings.findFirst({ where: eq(jobPostings.id, id) })
      if (!vaga || vaga.empresaId !== ctx.empresaId) throw new Error('Vaga não encontrada')

      await db
        .update(jobPostings)
        .set({ ...rest, updatedAt: new Date().toISOString() })
        .where(eq(jobPostings.id, id))
      return { success: true }
    }),

  delete: featureProcedure('vagas').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const vaga = await db.query.jobPostings.findFirst({ where: eq(jobPostings.id, input.id) })
    if (!vaga || vaga.empresaId !== ctx.empresaId) throw new Error('Vaga não encontrada')
    await db.delete(jobPostings).where(eq(jobPostings.id, input.id))
    return { success: true }
  }),
})
