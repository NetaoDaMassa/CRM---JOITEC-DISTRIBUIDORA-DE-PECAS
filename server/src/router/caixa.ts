import { z } from 'zod'
import { and, desc, eq, gte, isNull, lte, sql, sum } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'

const caixaProcedure = featureProcedure('caixa')
import { db } from '../db/client.js'
import { caixaMovimentacoes } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Caixa da empresa — entradas/saídas de dinheiro lançadas manualmente pelo
// admin, com saldo consolidado por mês. Pedido do João pra Compretec Loja
// Física, mas escopado por empresaId igual o resto do app (não é
// exclusivo dela).
export const caixaRouter = router({
  // `dataInicio`/`dataFim` no formato "YYYY-MM-DD" — lista os lançamentos do
  // período e já devolve os totais pra não precisar somar duas vezes no
  // client. Antes só aceitava mês fechado; João pediu um filtro de data
  // livre (ex: conferir só a primeira quinzena, ou atravessar dois meses).
  listar: caixaProcedure
    .input(
      z.object({
        dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(caixaMovimentacoes.empresaId, ctx.empresaId),
        isNull(caixaMovimentacoes.deletedAt),
        gte(caixaMovimentacoes.data, input.dataInicio),
        lte(caixaMovimentacoes.data, input.dataFim)
      )

      const registros = await db.query.caixaMovimentacoes.findMany({
        where,
        orderBy: [desc(caixaMovimentacoes.data), desc(caixaMovimentacoes.id)],
      })

      const [{ totalEntradas }] = await db
        .select({ totalEntradas: sum(sql`case when ${caixaMovimentacoes.tipo} = 'entrada' then ${caixaMovimentacoes.valor} else 0 end`).mapWith(Number) })
        .from(caixaMovimentacoes)
        .where(where)
      const [{ totalSaidas }] = await db
        .select({ totalSaidas: sum(sql`case when ${caixaMovimentacoes.tipo} = 'saida' then ${caixaMovimentacoes.valor} else 0 end`).mapWith(Number) })
        .from(caixaMovimentacoes)
        .where(where)

      const entradas = totalEntradas ?? 0
      const saidas = totalSaidas ?? 0

      return {
        registros,
        totalEntradas: entradas,
        totalSaidas: saidas,
        saldo: entradas - saidas,
      }
    }),

  criar: caixaProcedure
    .input(
      z.object({
        tipo: z.enum(['entrada', 'saida']),
        valor: z.number().positive(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        descricao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(caixaMovimentacoes).values({
        empresaId: ctx.empresaId,
        tipo: input.tipo,
        valor: input.valor,
        data: input.data,
        descricao: input.descricao || null,
        criadoPor: ctx.user.id,
      })
      const id = Number(result.lastInsertRowid)
      await registrarAuditoria({ tabela: 'caixa_movimentacoes', registroId: id, acao: 'criar', alteradoPor: ctx.user.id })
      return { id }
    }),

  // Entradas/saídas/saldo agrupados por mês, últimos 12 meses (incluindo o
  // atual) — pra dar uma visão histórica além do mês selecionado na tela.
  resumoMensal: caixaProcedure.query(async ({ ctx }) => {
    const hoje = new Date()
    const mesLimite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 11, 1))
    const dataLimite = `${mesLimite.getUTCFullYear()}-${String(mesLimite.getUTCMonth() + 1).padStart(2, '0')}-01`

    const linhas = await db
      .select({
        mes: sql<string>`substr(${caixaMovimentacoes.data}, 1, 7)`,
        totalEntradas: sum(sql`case when ${caixaMovimentacoes.tipo} = 'entrada' then ${caixaMovimentacoes.valor} else 0 end`).mapWith(Number),
        totalSaidas: sum(sql`case when ${caixaMovimentacoes.tipo} = 'saida' then ${caixaMovimentacoes.valor} else 0 end`).mapWith(Number),
      })
      .from(caixaMovimentacoes)
      .where(and(eq(caixaMovimentacoes.empresaId, ctx.empresaId), isNull(caixaMovimentacoes.deletedAt), gte(caixaMovimentacoes.data, dataLimite)))
      .groupBy(sql`substr(${caixaMovimentacoes.data}, 1, 7)`)
      .orderBy(sql`substr(${caixaMovimentacoes.data}, 1, 7)`)

    return linhas.map((l) => ({
      mes: l.mes,
      totalEntradas: l.totalEntradas ?? 0,
      totalSaidas: l.totalSaidas ?? 0,
      saldo: (l.totalEntradas ?? 0) - (l.totalSaidas ?? 0),
    }))
  }),

  remover: caixaProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.caixaMovimentacoes.findFirst({ where: eq(caixaMovimentacoes.id, input.id) })
    if (!registro || registro.empresaId !== ctx.empresaId) throw new Error('Lançamento não encontrado')

    await db.update(caixaMovimentacoes).set({ deletedAt: agoraSqlite() }).where(eq(caixaMovimentacoes.id, input.id))
    await registrarAuditoria({ tabela: 'caixa_movimentacoes', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { success: true }
  }),
})
