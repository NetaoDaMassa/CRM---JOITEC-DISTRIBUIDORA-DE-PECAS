import { router, protectedProcedure, publicProcedure } from './_base.js'
import { db } from '../db/client.js'

export const empresasRouter = router({
  // Sem autenticação (usado no seletor da tela de login, antes de logar) —
  // só nome/slug, nada sensível.
  listPublico: publicProcedure.query(async () => {
    return db.query.empresas.findMany({
      columns: { id: true, nome: true, slug: true },
      orderBy: (e, { asc }) => [asc(e.nome)],
    })
  }),

  // Só o superAdmin vê a lista completa (pra montar o seletor de troca no
  // Sidebar) — qualquer outro usuário recebe só a própria empresa.
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.superAdmin) {
      return db.query.empresas.findMany({ orderBy: (e, { asc }) => [asc(e.nome)] })
    }
    const propria = await db.query.empresas.findFirst({ where: (e, { eq }) => eq(e.id, ctx.user.empresaId) })
    return propria ? [propria] : []
  }),
})
