import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { permissoesAdmin, users } from '../db/schema.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Chaves fixas — 1:1 com ADMIN_LINKS em client/src/components/Sidebar.tsx.
// superAdmin nunca depende dessa lista: sempre vê tudo (ver Sidebar/rotas).
export const FEATURES_ADMIN = [
  'dashboard',
  'kanban',
  'pos_venda',
  'agenda',
  'clientes',
  'prospeccao',
  'aprovacoes',
  'carteira',
  'banco_clientes',
  'importar',
  'relatorios',
  'usuarios',
  'metas',
  'mensagens',
  'caixa',
  'compras',
  'lixeira',
  'configuracoes',
  'backup',
] as const

export const permissoesRouter = router({
  // Lista todos os admins (de qualquer empresa) pra tela de configuração —
  // só o superAdmin monta essa tela.
  listarAdmins: superAdminProcedure.query(async () => {
    const admins = await db.query.users.findMany({
      where: eq(users.role, 'admin'),
      columns: { id: true, name: true, username: true, empresaId: true, superAdmin: true, isActive: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasPermissoes = await db.query.permissoesAdmin.findMany()
    const porUsuario = new Map<number, string[]>()
    for (const p of todasPermissoes) {
      const lista = porUsuario.get(p.userId) ?? []
      lista.push(p.feature)
      porUsuario.set(p.userId, lista)
    }
    return admins.map((a) => ({ ...a, features: porUsuario.get(a.id) ?? [] }))
  }),

  // Features liberadas pro usuário logado — usado pelo Sidebar/route guard.
  // superAdmin sempre recebe a lista completa, sem depender de linhas na tabela.
  minhasPermissoes: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.superAdmin) return [...FEATURES_ADMIN]
    const linhas = await db.query.permissoesAdmin.findMany({ where: eq(permissoesAdmin.userId, ctx.user.id) })
    return linhas.map((l) => l.feature)
  }),

  // Substitui o conjunto inteiro de features liberadas pro admin alvo.
  atualizar: superAdminProcedure
    .input(z.object({ userId: z.number(), features: z.array(z.enum(FEATURES_ADMIN)) }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      if (!alvo || alvo.role !== 'admin') throw new Error('Usuário admin não encontrado')

      await db.delete(permissoesAdmin).where(eq(permissoesAdmin.userId, input.userId))
      if (input.features.length > 0) {
        await db.insert(permissoesAdmin).values(input.features.map((feature) => ({ userId: input.userId, feature })))
      }

      await registrarAuditoria({
        tabela: 'permissoes_admin',
        registroId: input.userId,
        acao: 'editar',
        valorNovo: input.features.join(','),
        alteradoPor: ctx.user.id,
      })
      return { success: true }
    }),
})
