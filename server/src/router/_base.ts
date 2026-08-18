import { initTRPC, TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import type { Context } from '../types/context.js'
import { db } from '../db/client.js'
import { permissoesAdmin } from '../db/schema.js'

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

// Setores sensíveis (Compras, Caixa) — além de ser admin, precisa ter a
// feature liberada em permissoesAdmin (superAdmin sempre passa, nunca
// depende de linha na tabela). Uso: `featureProcedure('compras')`.
export function featureProcedure(feature: string) {
  return adminProcedure.use(async ({ ctx, next }) => {
    if (ctx.user.superAdmin) return next({ ctx })
    const liberado = await db.query.permissoesAdmin.findFirst({
      where: and(eq(permissoesAdmin.userId, ctx.user.id), eq(permissoesAdmin.feature, feature)),
    })
    if (!liberado) throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a esse setor' })
    return next({ ctx })
  })
}

// Telas que hoje são "admin-only" mas o superAdmin pode liberar pra um
// vendedor específico (ex: Banco de Clientes) — qualquer admin continua
// passando direto (nunca fica mais restrito que hoje), vendedor só passa
// com a feature liberada em Permissões. Diferente de `featureProcedure`
// (que exige role admin sempre); esse aqui é o único jeito de um vendedor
// chegar numa rota historicamente admin-only.
export function adminOrFeatureProcedure(feature: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (ctx.user.role === 'admin' || ctx.user.superAdmin) return next({ ctx })
    const liberado = await db.query.permissoesAdmin.findFirst({
      where: and(eq(permissoesAdmin.userId, ctx.user.id), eq(permissoesAdmin.feature, feature)),
    })
    if (!liberado) throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a esse setor' })
    return next({ ctx })
  })
}
