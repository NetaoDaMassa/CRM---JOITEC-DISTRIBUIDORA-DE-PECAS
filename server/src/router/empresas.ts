import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { router, protectedProcedure, publicProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { adminEmpresasExtras, empresas, users } from '../db/schema.js'
import { registrarAuditoria } from '../lib/auditoria.js'

export const empresasRouter = router({
  // Sem autenticação (usado no seletor da tela de login, antes de logar) —
  // só nome/slug, nada sensível.
  listPublico: publicProcedure.query(async () => {
    return db.query.empresas.findMany({
      columns: { id: true, nome: true, slug: true },
      orderBy: (e, { asc }) => [asc(e.nome)],
    })
  }),

  // superAdmin vê a lista completa (pra montar o seletor de troca no
  // Sidebar). Admin comum recebe a própria empresa + as que um superAdmin
  // liberou explicitamente pra ele (adminEmpresasExtras — ver Permissões,
  // seção "Empresas extras"). Vendedor continua só com a própria.
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.superAdmin) {
      return db.query.empresas.findMany({ orderBy: (e, { asc }) => [asc(e.nome)] })
    }
    const propria = await db.query.empresas.findFirst({ where: (e, { eq }) => eq(e.id, ctx.user.empresaId) })
    if (!propria) return []
    if (ctx.user.role !== 'admin') return [propria]

    const extras = await db.query.adminEmpresasExtras.findMany({
      where: eq(adminEmpresasExtras.userId, ctx.user.id),
      with: { empresa: true },
    })
    const outras = extras.map((e) => e.empresa).filter((e) => e.id !== propria.id)
    return [propria, ...outras].sort((a, b) => a.nome.localeCompare(b.nome))
  }),

  // Todo admin comum (não-superAdmin) + as empresas extras já concedidas a
  // cada um, pra montar a tela "Empresas extras" em Permissões.
  listarComExtras: superAdminProcedure.query(async () => {
    const admins = await db.query.users.findMany({
      where: eq(users.role, 'admin'),
      columns: { id: true, name: true, username: true, empresaId: true, superAdmin: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasEmpresas = await db.query.empresas.findMany({ orderBy: (e, { asc }) => [asc(e.nome)] })
    const nomeEmpresa = new Map(todasEmpresas.map((e) => [e.id, e.nome]))

    const extras = await db.query.adminEmpresasExtras.findMany()
    const porAdmin = new Map<number, number[]>()
    for (const e of extras) {
      const lista = porAdmin.get(e.userId) ?? []
      lista.push(e.empresaId)
      porAdmin.set(e.userId, lista)
    }

    return {
      admins: admins
        .filter((a) => !a.superAdmin)
        .map((a) => ({
          id: a.id,
          name: a.name,
          username: a.username,
          empresaId: a.empresaId,
          empresaNome: nomeEmpresa.get(a.empresaId) ?? '?',
          empresasExtras: porAdmin.get(a.id) ?? [],
        })),
      empresas: todasEmpresas,
    }
  }),

  // Substitui o conjunto de empresas extras de `userId` (apaga tudo e
  // reinsere) — mesmo padrão de contasVinculadas.atualizar/funcaoTemplates.
  atualizarExtras: superAdminProcedure
    .input(z.object({ userId: z.number(), empresaIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      if (!alvo) throw new Error('Usuário não encontrado')
      if (alvo.role !== 'admin' || alvo.superAdmin) throw new Error('Empresas extras só se aplicam a admins comuns')

      await db.delete(adminEmpresasExtras).where(eq(adminEmpresasExtras.userId, input.userId))

      const semPropria = input.empresaIds.filter((id) => id !== alvo.empresaId)
      if (semPropria.length > 0) {
        // Confere que os ids realmente existem antes de gravar — evita
        // linha órfã se o client mandar algo inválido.
        const validas = await db.query.empresas.findMany({ where: inArray(empresas.id, semPropria) })
        const validasIds = new Set(validas.map((e) => e.id))
        const linhas = semPropria.filter((id) => validasIds.has(id)).map((empresaId) => ({ userId: input.userId, empresaId }))
        if (linhas.length > 0) await db.insert(adminEmpresasExtras).values(linhas)
      }

      await registrarAuditoria({
        tabela: 'admin_empresas_extras',
        registroId: input.userId,
        acao: 'editar',
        valorNovo: semPropria.join(','),
        alteradoPor: ctx.user.id,
      })
      return { success: true }
    }),
})
