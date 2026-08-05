import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { users, clientes, metasMensais } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { getConfigNumero } from '../lib/configuracoes.js'

const REGIAO_VALUES = ['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul'] as const

function gerarSenhaTemporaria(): string {
  return `Joitec${Math.random().toString(36).slice(2, 8)}9x`
}

export const usersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
  }),

  // "Vendors" aqui não é só quem tem role='vendor' — um admin de uma
  // empresa (ex: Pamela na Joitec Automação) também pode ter carteira
  // própria e vender. Só o superAdmin (cross-empresa, puramente
  // administrativo) fica de fora dessa lista.
  vendors: protectedProcedure.query(async ({ ctx }) => {
    const all = await db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => [asc(u.name)],
    })
    return all.filter((u) => u.isActive && !u.superAdmin)
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2),
        username: z.string().min(3),
        role: z.enum(['admin', 'vendor']).default('vendor'),
        regiao: z.enum(REGIAO_VALUES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // username é único globalmente (o login não sabe de qual empresa é
      // antes de autenticar), então essa checagem não leva empresaId.
      const existing = await db.query.users.findFirst({ where: eq(users.username, input.username) })
      if (existing) throw new Error('Nome de usuário já existe')

      const senhaTemporaria = gerarSenhaTemporaria()
      const hash = await bcrypt.hash(senhaTemporaria, 12)
      const result = await db.insert(users).values({
        empresaId: ctx.empresaId,
        name: input.name,
        username: input.username,
        passwordHash: hash,
        role: input.role,
        regiao: input.regiao,
        senhaTrocarNoLogin: true,
      })
      const id = Number(result.lastInsertRowid)

      // Vendedor novo já nasce com meta do mês corrente (padrão configurável
      // em Configurações) — evita aparecer sem meta no dashboard/TV.
      if (input.role === 'vendor') {
        const metaFaturamento = await getConfigNumero('meta_faturamento_padrao', 100000)
        const metaLigacoesDia = await getConfigNumero('meta_ligacoes_dia_padrao', 25)
        await db.insert(metasMensais).values({
          vendedorId: id,
          mesReferencia: mesReferenciaAtual(),
          metaFaturamento,
          metaLigacoesDia,
        })
      }

      return { id, senhaTemporaria }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        regiao: z.enum(REGIAO_VALUES).optional(),
        role: z.enum(['admin', 'vendor']).optional(),
        isActive: z.boolean().optional(),
        ocultoPainelTv: z.boolean().optional(),
        fotoUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      const target = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.empresaId, ctx.empresaId)) })
      if (!target) throw new Error('Usuário não encontrado')
      await db.update(users).set(updates).where(eq(users.id, id))
      return { success: true }
    }),

  resetPassword: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const target = await db.query.users.findFirst({ where: and(eq(users.id, input.id), eq(users.empresaId, ctx.empresaId)) })
      if (!target) throw new Error('Usuário não encontrado')
      const senhaTemporaria = gerarSenhaTemporaria()
      const hash = await bcrypt.hash(senhaTemporaria, 12)
      await db.update(users).set({ passwordHash: hash, senhaTrocarNoLogin: true }).where(eq(users.id, input.id))
      return { senhaTemporaria }
    }),

  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const target = await db.query.users.findFirst({ where: and(eq(users.id, input.id), eq(users.empresaId, ctx.empresaId)) })
    if (!target) throw new Error('Usuário não encontrado')

    const ativos = await db.query.clientes.findMany({
      where: and(eq(clientes.vendedorAtualId, input.id), isNull(clientes.deletedAt)),
      columns: { id: true },
    })
    if (ativos.length > 0) {
      throw new Error(`Este vendedor ainda tem ${ativos.length} cliente(s) na carteira. Redistribua antes de excluir.`)
    }
    await db.delete(users).where(eq(users.id, input.id))
    return { success: true }
  }),
})
