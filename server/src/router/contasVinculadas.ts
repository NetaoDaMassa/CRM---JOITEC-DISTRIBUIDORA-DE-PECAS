import { z } from 'zod'
import { eq, or } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { contasVinculadas, users } from '../db/schema.js'
import { registrarAuditoria } from '../lib/auditoria.js'

export const contasVinculadasRouter = router({
  // Todo usuário ativo (qualquer empresa/role, menos superAdmin — ele já
  // troca de empresa sem precisar de vínculo) + os vínculos já cadastrados,
  // pra montar a tela "Vincular contas".
  listarUsuarios: superAdminProcedure.query(async () => {
    const todos = await db.query.users.findMany({
      where: eq(users.superAdmin, false),
      columns: { id: true, name: true, username: true, empresaId: true, role: true, isActive: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    const todasEmpresas = await db.query.empresas.findMany({ columns: { id: true, nome: true } })
    const nomeEmpresa = new Map(todasEmpresas.map((e) => [e.id, e.nome]))

    const vinculos = await db.query.contasVinculadas.findMany()
    const porUsuario = new Map<number, number[]>()
    for (const v of vinculos) {
      const lista = porUsuario.get(v.userId) ?? []
      lista.push(v.contaVinculadaId)
      porUsuario.set(v.userId, lista)
    }

    return todos.map((u) => ({ ...u, empresaNome: nomeEmpresa.get(u.empresaId) ?? '?', contasVinculadas: porUsuario.get(u.id) ?? [] }))
  }),

  // Substitui o conjunto de contas vinculadas a `userId`. Sempre grava nos
  // dois sentidos — cada conta selecionada também ganha uma linha de volta
  // pra `userId` — e só mexe nos pares que envolvem `userId` (vínculos de
  // outras pessoas não tocadas ficam intactos).
  atualizar: superAdminProcedure
    .input(z.object({ userId: z.number(), contasVinculadasIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      if (!alvo) throw new Error('Usuário não encontrado')
      if (input.contasVinculadasIds.includes(input.userId)) throw new Error('Não pode vincular uma conta a ela mesma')

      await db.delete(contasVinculadas).where(or(eq(contasVinculadas.userId, input.userId), eq(contasVinculadas.contaVinculadaId, input.userId)))

      if (input.contasVinculadasIds.length > 0) {
        const linhas = input.contasVinculadasIds.flatMap((contaId) => [
          { userId: input.userId, contaVinculadaId: contaId },
          { userId: contaId, contaVinculadaId: input.userId },
        ])
        await db.insert(contasVinculadas).values(linhas)
      }

      await registrarAuditoria({
        tabela: 'contas_vinculadas',
        registroId: input.userId,
        acao: 'editar',
        valorNovo: input.contasVinculadasIds.join(','),
        alteradoPor: ctx.user.id,
      })
      return { success: true }
    }),
})
