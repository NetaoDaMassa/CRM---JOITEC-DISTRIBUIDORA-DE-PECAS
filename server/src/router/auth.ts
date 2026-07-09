import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq, and } from 'drizzle-orm'
import { router, publicProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ companyId: z.number(), username: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const user = await db.query.users.findFirst({
        where: and(eq(users.username, input.username), eq(users.companyId, input.companyId)),
        with: { company: true },
      })
      if (!user || !user.isActive || !user.company) {
        throw new Error('Usuário ou senha inválidos')
      }
      const valid = await bcrypt.compare(input.password, user.passwordHash)
      if (!valid) throw new Error('Usuário ou senha inválidos')

      const token = signToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        companyId: user.company.id,
        companyName: user.company.name,
      })
      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          companyId: user.company.id,
          companyName: user.company.name,
        },
      }
    }),

  me: protectedProcedure.query(({ ctx }) => ctx.user),
})
