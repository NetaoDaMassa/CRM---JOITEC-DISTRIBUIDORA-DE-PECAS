import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
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

// Abas de dentro de Relatórios — controle mais fino que o 'relatorios' acima
// (esse continua controlando a página inteira pro admin; estas controlam
// aba por aba, tanto pra admin quanto pra vendedor). "Todas as Empresas" não
// entra aqui: é superAdminOnly sempre, direto no componente, sem depender
// dessa tabela. Reaproveita a mesma tabela `permissoes_admin` (o nome ficou
// datado, mas a coluna `feature` é só uma string livre, serve pra qualquer
// papel de usuário).
export const FEATURES_RELATORIOS = [
  'relatorio_visao_geral',
  'relatorio_contatos',
  'relatorio_orcamentos',
  'relatorio_alertas',
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

  // Mesma ideia de listarAdmins, mas pra vendedores — usado só na tela de
  // "Relatórios por vendedor" (abas de dentro de Relatórios, não tem os
  // outros itens de menu porque vendedor não usa ADMIN_LINKS).
  listarVendedores: superAdminProcedure.query(async () => {
    const vendedores = await db.query.users.findMany({
      where: eq(users.role, 'vendor'),
      columns: { id: true, name: true, username: true, empresaId: true, isActive: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasPermissoes = await db.query.permissoesAdmin.findMany({
      where: inArray(permissoesAdmin.feature, [...FEATURES_RELATORIOS]),
    })
    const porUsuario = new Map<number, string[]>()
    for (const p of todasPermissoes) {
      const lista = porUsuario.get(p.userId) ?? []
      lista.push(p.feature)
      porUsuario.set(p.userId, lista)
    }
    return vendedores.map((v) => ({ ...v, features: porUsuario.get(v.id) ?? [] }))
  }),

  // Features liberadas pro usuário logado — usado pelo Sidebar/route guard.
  // superAdmin sempre recebe a lista completa, sem depender de linhas na tabela.
  minhasPermissoes: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.superAdmin) return [...FEATURES_ADMIN]
    const linhas = await db.query.permissoesAdmin.findMany({ where: eq(permissoesAdmin.userId, ctx.user.id) })
    return linhas.map((l) => l.feature)
  }),

  // Substitui o conjunto inteiro de features liberadas pro admin alvo
  // (itens de menu + abas de relatórios, as duas listas juntas).
  atualizar: superAdminProcedure
    .input(z.object({ userId: z.number(), features: z.array(z.enum([...FEATURES_ADMIN, ...FEATURES_RELATORIOS])) }))
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

  // Só as abas de relatório, só pra vendedor — não mexe em nada mais (admin
  // usa `atualizar` acima, que já inclui as abas de relatório junto).
  atualizarRelatorios: superAdminProcedure
    .input(z.object({ userId: z.number(), features: z.array(z.enum(FEATURES_RELATORIOS)) }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      if (!alvo || alvo.role !== 'vendor') throw new Error('Usuário vendedor não encontrado')

      await db
        .delete(permissoesAdmin)
        .where(and(eq(permissoesAdmin.userId, input.userId), inArray(permissoesAdmin.feature, [...FEATURES_RELATORIOS])))
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
