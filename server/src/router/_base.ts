import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from '../types/context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Não autenticado' })
  if (!ctx.empresaId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Empresa não resolvida' })
  return next({ ctx: { ...ctx, user: ctx.user, empresaId: ctx.empresaId } })
})

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito ao administrador' })
  return next({ ctx })
})

// Pra endpoints que atravessam mais de uma empresa (ex: Painel Financeiro,
// que consolida 3 empresas de uma vez) — ctx.empresaId continua sendo só a
// empresa ativa no momento, então esses endpoints ignoram ele e consultam
// os empresaId que precisarem direto. Só quem é users.superAdmin chega aqui.
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.superAdmin)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito' })
  return next({ ctx })
})
