import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from '../types/context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Não autenticado' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito ao administrador' })
  return next({ ctx })
})
