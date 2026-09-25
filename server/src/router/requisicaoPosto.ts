import { z } from 'zod'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { requisicaoPosto, requisicaoPostoColaboradores, requisicaoPostoVeiculos, empresas, users } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'

// Requisição Posto (abastecimento) — cross-empresa por design, mesmo padrão
// de financeiro.ts: quem tem a permissão `requisicao_posto` vê e lança pra
// TODAS as empresas numa tela só (Financeiro/Compras acompanha o grupo
// inteiro, sem precisar trocar de empresa ativa). Colaborador (motorista)
// não tem login — é sempre alguém do Financeiro/Compras que lança em nome
// dele, escolhendo o nome num menu. Ver schema.ts pro resto do contexto.
export const requisicaoPostoRouter = router({
  colaboradoresListar: adminProcedure.query(async () => {
    return db
      .select({
        id: requisicaoPostoColaboradores.id,
        nome: requisicaoPostoColaboradores.nome,
        empresaId: requisicaoPostoColaboradores.empresaId,
        empresaNome: empresas.nome,
      })
      .from(requisicaoPostoColaboradores)
      .innerJoin(empresas, eq(empresas.id, requisicaoPostoColaboradores.empresaId))
      .orderBy(requisicaoPostoColaboradores.nome)
  }),

  colaboradorCriar: adminProcedure
    .input(z.object({ nome: z.string().min(1), empresaId: z.number() }))
    .mutation(async ({ input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, input.empresaId) })
      if (!empresa) throw new Error('Empresa não encontrada')
      const [criado] = await db
        .insert(requisicaoPostoColaboradores)
        .values({ nome: input.nome.trim(), empresaId: input.empresaId })
        .returning()
      return criado
    }),

  veiculosListar: adminProcedure.query(async () => {
    return db.select().from(requisicaoPostoVeiculos).orderBy(requisicaoPostoVeiculos.placa)
  }),

  // Placa em caixa alta sem espaço extra — mesma placa digitada diferente
  // (minúsculo, espaço a mais) não pode virar 2 opções no menu.
  veiculoCriar: adminProcedure
    .input(z.object({ placa: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const placa = input.placa.trim().toUpperCase()
      const existente = await db.query.requisicaoPostoVeiculos.findFirst({ where: eq(requisicaoPostoVeiculos.placa, placa) })
      if (existente) return existente
      const [criado] = await db.insert(requisicaoPostoVeiculos).values({ placa }).returning()
      return criado
    }),

  // `mesReferencia` no formato "YYYY-MM" (mesmo formato de mesReferenciaAtual)
  // — sem filtro, undefined, traz tudo (útil pra listagem geral/histórico).
  listar: adminProcedure
    .input(z.object({ mesReferencia: z.string().optional() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: requisicaoPosto.id,
          data: requisicaoPosto.data,
          valor: requisicaoPosto.valor,
          canhotoEntregue: requisicaoPosto.canhotoEntregue,
          colaboradorId: requisicaoPosto.colaboradorId,
          colaboradorNome: requisicaoPostoColaboradores.nome,
          empresaId: requisicaoPostoColaboradores.empresaId,
          empresaNome: empresas.nome,
          veiculoId: requisicaoPosto.veiculoId,
          placa: requisicaoPostoVeiculos.placa,
          criadoPorNome: users.name,
        })
        .from(requisicaoPosto)
        .innerJoin(requisicaoPostoColaboradores, eq(requisicaoPostoColaboradores.id, requisicaoPosto.colaboradorId))
        .innerJoin(empresas, eq(empresas.id, requisicaoPostoColaboradores.empresaId))
        .innerJoin(requisicaoPostoVeiculos, eq(requisicaoPostoVeiculos.id, requisicaoPosto.veiculoId))
        .leftJoin(users, eq(users.id, requisicaoPosto.criadoPor))
        .where(input.mesReferencia ? like(requisicaoPosto.data, `${input.mesReferencia}%`) : undefined)
        .orderBy(desc(requisicaoPosto.data), desc(requisicaoPosto.id))
        .limit(500)
    }),

  criar: adminProcedure
    .input(
      z.object({
        colaboradorId: z.number(),
        veiculoId: z.number(),
        data: z.string(),
        valor: z.number().positive('Valor precisa ser maior que zero'),
        canhotoEntregue: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.insert(requisicaoPosto).values({
        colaboradorId: input.colaboradorId,
        veiculoId: input.veiculoId,
        data: input.data,
        valor: input.valor,
        canhotoEntregue: input.canhotoEntregue ?? false,
        criadoPor: ctx.user.id,
      })
      return { success: true }
    }),

  // Corrige um lançamento já feito (valor digitado errado, carro/data
  // trocados) sem precisar apagar e recriar — pedido do João, 2026-09-25.
  editar: adminProcedure
    .input(
      z.object({
        id: z.number(),
        colaboradorId: z.number(),
        veiculoId: z.number(),
        data: z.string(),
        valor: z.number().positive('Valor precisa ser maior que zero'),
      })
    )
    .mutation(async ({ input }) => {
      const existente = await db.query.requisicaoPosto.findFirst({ where: eq(requisicaoPosto.id, input.id) })
      if (!existente) throw new Error('Lançamento não encontrado')
      await db
        .update(requisicaoPosto)
        .set({ colaboradorId: input.colaboradorId, veiculoId: input.veiculoId, data: input.data, valor: input.valor })
        .where(eq(requisicaoPosto.id, input.id))
      return { success: true }
    }),

  atualizarCanhoto: adminProcedure
    .input(z.object({ id: z.number(), canhotoEntregue: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(requisicaoPosto).set({ canhotoEntregue: input.canhotoEntregue }).where(eq(requisicaoPosto.id, input.id))
      return { success: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await db.delete(requisicaoPosto).where(eq(requisicaoPosto.id, input.id))
    return { success: true }
  }),

  // Fechamento do mês pro Financeiro: total geral, quebra por empresa e por
  // colaborador, mais quantos canhotos ainda faltam entregar. `mesReferencia`
  // default é o mês atual (mesma regra do Painel Financeiro).
  relatorioMensal: adminProcedure
    .input(z.object({ mesReferencia: z.string().optional() }))
    .query(async ({ input }) => {
      const mes = input.mesReferencia ?? mesReferenciaAtual()
      const filtroMes = like(requisicaoPosto.data, `${mes}%`)

      const [totalGeral] = await db
        .select({ total: sql<number>`coalesce(sum(${requisicaoPosto.valor}), 0)`, qtd: sql<number>`count(*)` })
        .from(requisicaoPosto)
        .where(filtroMes)

      const canhotosPendentes = await db
        .select({ qtd: sql<number>`count(*)` })
        .from(requisicaoPosto)
        .where(and(filtroMes, eq(requisicaoPosto.canhotoEntregue, false)))

      const porEmpresa = await db
        .select({
          empresaId: requisicaoPostoColaboradores.empresaId,
          empresaNome: empresas.nome,
          total: sql<number>`coalesce(sum(${requisicaoPosto.valor}), 0)`,
          qtd: sql<number>`count(*)`,
        })
        .from(requisicaoPosto)
        .innerJoin(requisicaoPostoColaboradores, eq(requisicaoPostoColaboradores.id, requisicaoPosto.colaboradorId))
        .innerJoin(empresas, eq(empresas.id, requisicaoPostoColaboradores.empresaId))
        .where(filtroMes)
        .groupBy(requisicaoPostoColaboradores.empresaId, empresas.nome)
        .orderBy(desc(sql`sum(${requisicaoPosto.valor})`))

      const porColaborador = await db
        .select({
          colaboradorId: requisicaoPosto.colaboradorId,
          colaboradorNome: requisicaoPostoColaboradores.nome,
          empresaNome: empresas.nome,
          total: sql<number>`coalesce(sum(${requisicaoPosto.valor}), 0)`,
          qtd: sql<number>`count(*)`,
        })
        .from(requisicaoPosto)
        .innerJoin(requisicaoPostoColaboradores, eq(requisicaoPostoColaboradores.id, requisicaoPosto.colaboradorId))
        .innerJoin(empresas, eq(empresas.id, requisicaoPostoColaboradores.empresaId))
        .where(filtroMes)
        .groupBy(requisicaoPosto.colaboradorId, requisicaoPostoColaboradores.nome, empresas.nome)
        .orderBy(desc(sql`sum(${requisicaoPosto.valor})`))

      return {
        mesReferencia: mes,
        totalGeral: totalGeral?.total ?? 0,
        quantidadeGeral: totalGeral?.qtd ?? 0,
        canhotosPendentes: canhotosPendentes[0]?.qtd ?? 0,
        porEmpresa,
        porColaborador,
      }
    }),
})
