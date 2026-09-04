import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { sidebarGroups, sidebarGroupItems } from '../db/schema.js'

// Antes validava contra uma cópia manual dos `to` de ADMIN_LINKS/VENDOR_LINKS
// (client/src/components/Sidebar.tsx) mantida solta aqui — toda tela nova
// quebrava "Grupos da Sidebar" até alguém lembrar de atualizar essa lista
// (aconteceu de novo com "Arquivos/Mídia", 2026-09-04: o item existia no
// Sidebar.tsx mas faltava aqui, e o superAdmin tomou "invalid_enum_value" ao
// tentar agrupar). Removida a lista: quem escolhe os itens em Grupos da
// Sidebar (SidebarGrupos.tsx) já só oferece os `to` que existem de verdade
// em ADMIN_LINKS/VENDOR_LINKS — nunca dá pra mandar um valor inventado por
// essa tela, então validar de novo aqui só duplicava a lista sem duplicar
// nenhuma segurança de verdade. Um `to` desatualizado que sobre num grupo
// antigo (tela removida depois) também não quebra nada — o Sidebar.tsx já
// filtra silenciosamente qualquer item que não bata com nenhum link atual.
const linkToSchema = z.string().min(1)

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
      // Novo grupo entra no fim da lista, não empatado em ordem=0 com todo
      // mundo — senão a ordem exibida vira "o que o SQLite devolver" em vez
      // do que o superAdmin de fato organizou.
      const existentes = await db.query.sidebarGroups.findMany({ columns: { ordem: true } })
      const proximaOrdem = existentes.length ? Math.max(...existentes.map((g) => g.ordem)) + 1 : 0

      const result = await db.insert(sidebarGroups).values({ nome: input.nome, icone: input.icone, ordem: proximaOrdem })
      const id = Number(result.lastInsertRowid)
      if (input.itens.length > 0) {
        await db.insert(sidebarGroupItems).values(input.itens.map((linkTo, idx) => ({ groupId: id, linkTo, ordem: idx })))
      }
      return { id }
    }),

  // Recebe os ids de todos os grupos na ordem final desejada (arrastar não
  // existe aqui — a tela usa botões de subir/descer, que já mandam a lista
  // inteira reordenada) e regrava `ordem` = posição no array.
  reordenarGrupos: superAdminProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      for (let i = 0; i < input.ids.length; i++) {
        await db.update(sidebarGroups).set({ ordem: i }).where(eq(sidebarGroups.id, input.ids[i]))
      }
      return { success: true }
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
