import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { router, publicProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, logAcessoUsuario } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'
import { getConfigNumero } from '../lib/configuracoes.js'
import { agoraSqlite } from '../lib/dataBr.js'

async function registrarAcesso(userId: number): Promise<void> {
  await db.insert(logAcessoUsuario).values({ usuarioId: userId })
  await db.update(users).set({ lastLoginAt: agoraSqlite() }).where(eq(users.id, userId))
}

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const user = await db.query.users.findFirst({ where: eq(users.username, input.username) })
      const MAX_TENTATIVAS = await getConfigNumero('senha_max_tentativas_login', 5)
      const BLOQUEIO_MINUTOS = await getConfigNumero('senha_bloqueio_minutos', 15)

      if (user?.bloqueadoAte && new Date(user.bloqueadoAte).getTime() > Date.now()) {
        const minutos = Math.ceil((new Date(user.bloqueadoAte).getTime() - Date.now()) / 60_000)
        throw new Error(`Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em ${minutos} min.`)
      }

      if (user && !user.isActive) {
        throw new Error('Usuário desativado. Fale com o gestor.')
      }

      const valid = user ? await bcrypt.compare(input.password, user.passwordHash) : false
      if (!user || !valid) {
        if (user) {
          const novasTentativas = user.tentativasLoginFalhas + 1
          const deveBloquear = novasTentativas >= MAX_TENTATIVAS
          await db
            .update(users)
            .set({
              tentativasLoginFalhas: deveBloquear ? 0 : novasTentativas,
              bloqueadoAte: deveBloquear ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000).toISOString() : null,
            })
            .where(eq(users.id, user.id))
          if (deveBloquear) {
            throw new Error(`Muitas tentativas incorretas. Conta bloqueada por ${BLOQUEIO_MINUTOS} minutos.`)
          }
        }
        throw new Error('Usuário ou senha inválidos')
      }

      await db.update(users).set({ tentativasLoginFalhas: 0, bloqueadoAte: null }).where(eq(users.id, user.id))
      await registrarAcesso(user.id)

      const token = signToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        empresaId: user.empresaId,
        superAdmin: user.superAdmin,
      })
      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          empresaId: user.empresaId,
          superAdmin: user.superAdmin,
          senhaTrocarNoLogin: user.senhaTrocarNoLogin,
        },
      }
    }),

  me: protectedProcedure.query(({ ctx }) => ctx.user),

  trocarSenha: protectedProcedure
    .input(z.object({ novaSenha: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      if (!/[a-zA-Z]/.test(input.novaSenha) || !/[0-9]/.test(input.novaSenha)) {
        throw new Error('Senha deve ter pelo menos 8 caracteres, com letras e números.')
      }
      const hash = await bcrypt.hash(input.novaSenha, 12)
      await db.update(users).set({ passwordHash: hash, senhaTrocarNoLogin: false }).where(eq(users.id, ctx.user.id))
      return { success: true }
    }),
})
