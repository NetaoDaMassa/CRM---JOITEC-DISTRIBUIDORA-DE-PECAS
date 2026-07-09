import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq, and } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

export const usersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.users.findMany({
      where: eq(users.companyId, ctx.user.companyId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
  }),

  vendors: protectedProcedure.query(async ({ ctx }) => {
    const all = await db.query.users.findMany({
      where: eq(users.companyId, ctx.user.companyId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return all.filter((u) => u.role === 'vendor')
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2),
        username: z.string().min(3),
        password: z.string().min(6),
        role: z.enum(['admin', 'vendor']).default('vendor'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.users.findFirst({
        where: and(eq(users.username, input.username), eq(users.companyId, ctx.user.companyId)),
      })
      if (existing) throw new Error('Nome de usuário já existe')
      const hash = await bcrypt.hash(input.password, 12)
      const result = await db.insert(users).values({
        companyId: ctx.user.companyId,
        name: input.name,
        username: input.username,
        passwordHash: hash,
        role: input.role,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        username: z.string().min(3).optional(),
        password: z.string().min(6).optional(),
        role: z.enum(['admin', 'vendor']).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, password, ...rest } = input
      const target = await db.query.users.findFirst({ where: eq(users.id, id) })
      if (!target || target.companyId !== ctx.user.companyId) throw new Error('Usuário não encontrado')

      const updates: Record<string, unknown> = { ...rest }
      if (password) updates.passwordHash = await bcrypt.hash(password, 12)
      await db.update(users).set(updates).where(eq(users.id, id))
      return { success: true }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(users)
        .where(and(eq(users.id, input.id), eq(users.companyId, ctx.user.companyId)))
      return { success: true }
    }),
})
