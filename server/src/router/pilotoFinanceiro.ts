import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import { lerPiloto, noPiloto, salvarPiloto } from '../lib/pilotoFinanceiro.js'

export const pilotoFinanceiroRouter = router({
  // O próprio usuário: está no piloto? (menu/telas decidem o que mostrar)
  // superAdmin (João) sempre vê as opções novas — pra conferir antes de liberar.
  eu: protectedProcedure.query(async ({ ctx }) => ({ noPiloto: !!ctx.user.superAdmin || (await noPiloto(ctx.user.id)) })),

  obter: superAdminProcedure.query(async () => {
    const p = await lerPiloto()
    const todos = await db
      .select({ id: users.id, name: users.name, username: users.username, role: users.role, empresaNome: empresas.nome, ativo: users.isActive })
      .from(users)
      .leftJoin(empresas, eq(empresas.id, users.empresaId))
      .orderBy(asc(users.name))
    return { todos: p.todos, usuarios: p.usuarios, pessoas: todos.filter((u) => u.ativo) }
  }),

  salvar: superAdminProcedure
    .input(z.object({ todos: z.boolean(), usuarios: z.array(z.number().int()).max(500) }))
    .mutation(async ({ input }) => {
      await salvarPiloto(input)
      return { ok: true }
    }),
})
