import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { sidebarGroups, sidebarGroupItems } from '../db/schema.js'

// Cópia manual dos `to` de ADMIN_LINKS/VENDOR_LINKS (client/src/components/Sidebar.tsx)
// + os 5 itens hardcoded que ficam soltos depois do loop lá (Painel de TV,
// Permissões, Funções, Regiões de Leads, Painel Financeiro) — não dá pra
// importar o array do client aqui, então valida contra esta lista fixa. Se
// um item novo for adicionado no Sidebar.tsx, precisa ser adicionado aqui
// também pra virar agrupável.
const LINK_TO_VALIDOS = [
  '/admin', '/admin/kanban', '/admin/pos-venda', '/admin/calendario', '/admin/clientes', '/admin/prospeccao',
  '/admin/aprovacoes', '/admin/carteira', '/admin/banco-clientes', '/admin/importar', '/admin/relatorios',
  '/admin/usuarios', '/admin/metas', '/admin/mensagens', '/admin/caixa', '/admin/compras', '/admin/lixeira',
  '/admin/configuracoes', '/admin/backup', '/admin/devolucoes', '/admin/devolucoes-mecanica',
  '/admin/devolucoes-demonstracao', '/admin/devolucoes-relatorios', '/admin/vagas', '/admin/candidatos',
  '/admin/mensagens-rh', '/admin/analytics', '/admin/leads', '/admin/leads/kanban', '/admin/leads-desqualificados',
  '/admin/leads-relatorios',
  '/vendedor', '/vendedor/fila-hoje', '/vendedor/pos-venda', '/vendedor/kanban', '/vendedor/calendario',
  '/vendedor/clientes', '/vendedor/prospeccao', '/vendedor/banco-clientes', '/vendedor/faturamento-geral',
  '/vendedor/relatorios', '/vendedor/solicitar-design', '/vendedor/devolucoes', '/vendedor/devolucoes-mecanica',
  '/vendedor/devolucoes-demonstracao', '/vendedor/devolucoes-relatorios', '/vendedor/leads', '/vendedor/leads/kanban',
  '/painel-tv', '/admin/permissoes', '/admin/funcoes', '/admin/leads-regioes', '/painel-financeiro',
  '/admin/sidebar-grupos',
] as const

const linkToSchema = z.enum(LINK_TO_VALIDOS)

export const sidebarGruposRouter = router({
  // Todo mundo lê — é o que monta a sidebar de qualquer usuário (admin ou
  // vendedor), não só do superAdmin que configura.
  listar: protectedProcedure.query(async () => {
    const grupos = await db.query.sidebarGroups.findMany({
      with: { itens: { orderBy: (i, { asc }) => [asc(i.ordem)] } },
      orderBy: (g, { asc }) => [asc(g.ordem)],
    })
    return grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      icone: g.icone,
      itens: g.itens.map((i) => i.linkTo),
    }))
  }),

  criar: superAdminProcedure
    .input(
      z.object({
        nome: z.string().min(2),
        icone: z.string().min(1),
        itens: z.array(linkToSchema),
      })
    )
    .mutation(async ({ input }) => {
      const result = await db.insert(sidebarGroups).values({ nome: input.nome, icone: input.icone })
      const id = Number(result.lastInsertRowid)
      if (input.itens.length > 0) {
        await db.insert(sidebarGroupItems).values(input.itens.map((linkTo, idx) => ({ groupId: id, linkTo, ordem: idx })))
      }
      return { id }
    }),

  atualizar: superAdminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(2).optional(),
        icone: z.string().min(1).optional(),
        itens: z.array(linkToSchema).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const grupo = await db.query.sidebarGroups.findFirst({ where: eq(sidebarGroups.id, input.id) })
      if (!grupo) throw new Error('Grupo não encontrado')

      if (input.nome !== undefined || input.icone !== undefined) {
        await db
          .update(sidebarGroups)
          .set({ ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.icone !== undefined ? { icone: input.icone } : {}) })
          .where(eq(sidebarGroups.id, input.id))
      }

      if (input.itens !== undefined) {
        await db.delete(sidebarGroupItems).where(eq(sidebarGroupItems.groupId, input.id))
        if (input.itens.length > 0) {
          await db.insert(sidebarGroupItems).values(input.itens.map((linkTo, idx) => ({ groupId: input.id, linkTo, ordem: idx })))
        }
      }

      return { success: true }
    }),

  excluir: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const grupo = await db.query.sidebarGroups.findFirst({ where: eq(sidebarGroups.id, input.id) })
    if (!grupo) throw new Error('Grupo não encontrado')
    await db.delete(sidebarGroups).where(eq(sidebarGroups.id, input.id))
    return { success: true }
  }),
})
