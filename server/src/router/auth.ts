import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { router, publicProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, logAcessoUsuario, contasVinculadas } from '../db/schema.js'
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

  // Contas vinculadas (mesma pessoa, empresa diferente — ver
  // contas_vinculadas no schema) que o usuário logado pode trocar sem
  // digitar senha de novo.
  minhasContasVinculadas: protectedProcedure.query(async ({ ctx }) => {
    const vinculos = await db.query.contasVinculadas.findMany({ where: eq(contasVinculadas.userId, ctx.user.id) })
    if (vinculos.length === 0) return []

    const contas = await db.query.users.findMany({
      where: (u, { inArray, and: andFn, eq: eqFn }) =>
        andFn(
          inArray(
            u.id,
            vinculos.map((v) => v.contaVinculadaId)
          ),
          eqFn(u.isActive, true)
        ),
      columns: { id: true, name: true, empresaId: true },
    })
    const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })
    const nomeEmpresa = new Map(todasEmpresas.map((e) => [e.id, e.nome]))
    return contas.map((c) => ({ id: c.id, name: c.name, empresaNome: nomeEmpresa.get(c.empresaId) ?? '?' }))
  }),

  // Troca pra uma conta vinculada sem pedir senha — só funciona se existir
  // um vínculo de verdade (cadastrado pelo superAdmin em Permissões), não é
  // um "entrar como qualquer um".
  trocarConta: protectedProcedure
    .input(z.object({ contaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const vinculo = await db.query.contasVinculadas.findFirst({
        where: (v, { and: andFn, eq: eqFn }) => andFn(eqFn(v.userId, ctx.user.id), eqFn(v.contaVinculadaId, input.contaId)),
      })
      if (!vinculo) throw new Error('Essa conta não está vinculada à sua')

      const conta = await db.query.users.findFirst({ where: eq(users.id, input.contaId) })
      if (!conta || !conta.isActive) throw new Error('Conta não encontrada ou desativada')

      await registrarAcesso(conta.id)

      const token = signToken({
        id: conta.id,
        username: conta.username,
        name: conta.name,
        role: conta.role,
        empresaId: conta.empresaId,
        superAdmin: conta.superAdmin,
      })
      return {
        token,
        user: {
          id: conta.id,
          name: conta.name,
          username: conta.username,
          role: conta.role,
          empresaId: conta.empresaId,
          superAdmin: conta.superAdmin,
          senhaTrocarNoLogin: conta.senhaTrocarNoLogin,
        },
      }
    }),

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
