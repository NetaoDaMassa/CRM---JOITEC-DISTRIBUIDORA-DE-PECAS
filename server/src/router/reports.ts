import { z } from 'zod'
import { and, between, count, desc, eq, isNull, sql, sum } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, funilMensal, registroContato, itensPedido, users, vendas as vendasTable } from '../db/schema.js'
import { diasDesde, mesReferenciaAtual } from '../lib/dataBr.js'

const periodoInput = z.object({
  dataInicio: z.string(),
  dataFim: z.string(),
  vendedorId: z.number().optional(),
})

function filtroVendedor(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined, coluna: any) {
  if (ctxRole === 'admin') return vendedorId ? eq(coluna, vendedorId) : undefined
  return eq(coluna, ctxUserId)
}

// input.dataFim vem como "YYYY-MM-DD" puro (input type="date"). Comparando
// como texto direto contra colunas datetime ("YYYY-MM-DD HH:MM:SS"), a data
// de hoje ficaria de fora do período (string mais curta "perde" de qualquer
// timestamp do mesmo dia na ordenação lexicográfica) — por isso sempre
// expandimos pros limites do dia antes de usar em between().
function limitesDia(input: { dataInicio: string; dataFim: string }) {
  return { inicio: `${input.dataInicio} 00:00:00`, fim: `${input.dataFim} 23:59:59` }
}

export const reportsRouter = router({
  curvaAbc: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, vendasTable.vendedorId)
    if (filtroVend) filtros.push(filtroVend)

    const linhas = await db
      .select({
        clienteId: vendasTable.clienteId,
        razaoSocial: clientes.razaoSocial,
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .where(and(...filtros))
      .groupBy(vendasTable.clienteId)
      .orderBy(desc(sql`sum(${vendasTable.valorFechado})`))

    const totalGeral = linhas.reduce((acc, l) => acc + (l.valorTotal ?? 0), 0)
    let acumulado = 0
    return linhas.map((l) => {
      acumulado += l.valorTotal ?? 0
      const pctAcumulado = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0
      const classe = pctAcumulado <= 80 ? 'A' : pctAcumulado <= 95 ? 'B' : 'C'
      return { ...l, classe }
    })
  }),

  positivacaoCarteira: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtrosCarteira = [isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
    if (filtroVend) filtrosCarteira.push(filtroVend)

    const [{ totalCarteira }] = await db.select({ totalCarteira: count() }).from(clientes).where(and(...filtrosCarteira))

    const [{ ativados }] = await db
      .select({ ativados: count() })
      .from(clientes)
      .where(and(...filtrosCarteira, between(clientes.dataUltimaCompra, inicio, fim)))

    return {
      totalCarteira,
      ativados,
      percentual: totalCarteira > 0 ? (ativados / totalCarteira) * 100 : 0,
    }
  }),

  contatosPorCliente: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        totalContatos: count(registroContato.id).mapWith(Number),
        totalLigacoes: sql<number>`sum(case when ${registroContato.tipo} = 'ligacao' then 1 else 0 end)`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.clienteId)
      .orderBy(desc(count(registroContato.id)))

    return linhas
  }),

  vendas: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, vendasTable.vendedorId)
    if (filtroVend) filtros.push(filtroVend)

    const [{ quantidade, valorTotal }] = await db
      .select({
        quantidade: count(),
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(users, eq(users.id, vendasTable.vendedorId))
      .where(and(...filtros))

    return {
      quantidade,
      valorTotal: valorTotal ?? 0,
      ticketMedio: quantidade > 0 ? (valorTotal ?? 0) / quantidade : 0,
    }
  }),

  diasSemContato: protectedProcedure
    .input(z.object({ vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const filtros = [isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
      if (filtroVend) filtros.push(filtroVend)

      const lista = await db.query.clientes.findMany({
        where: and(...filtros),
        columns: { id: true, razaoSocial: true },
        with: {
          funis: {
            where: isNull(funilMensal.deletedAt),
            orderBy: (f, { desc }) => [desc(f.mesReferencia)],
            limit: 1,
            columns: { dataUltimoContato: true, dataEntradaEtapa: true },
          },
        },
      })

      return lista
        .map((c) => {
          const ultimoFunil = c.funis[0]
          const dias = ultimoFunil ? diasDesde(ultimoFunil.dataUltimoContato ?? ultimoFunil.dataEntradaEtapa) : null
          return { clienteId: c.id, razaoSocial: c.razaoSocial, dias }
        })
        .filter((c) => c.dias !== null)
        .sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0))
    }),

  itensMaisComprados: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      between(itensPedido.createdAt, inicio, fim),
      isNull(itensPedido.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
    if (filtroVend) filtros.push(filtroVend)

    return db
      .select({
        descricao: itensPedido.descricao,
        quantidadeTotal: sum(itensPedido.quantidade).mapWith(Number),
        valorTotal: sum(itensPedido.valorTotal).mapWith(Number),
      })
      .from(itensPedido)
      .innerJoin(clientes, eq(clientes.id, itensPedido.clienteId))
      .where(and(...filtros))
      .groupBy(itensPedido.descricao)
      .orderBy(desc(sql`sum(${itensPedido.quantidade})`))
      .limit(50)
  }),

  // Orçamentos/propostas em aberto — negócios em "negociação" no mês
  // corrente, com o valor orçado que o vendedor lançou no Kanban. Não é um
  // relatório de período (é uma foto do que está em aberto agora), por isso
  // o input é só o filtro de vendedor, igual `diasSemContato`.
  orcamentosAbertos: protectedProcedure.input(z.object({ vendedorId: z.number().optional() })).query(async ({ ctx, input }) => {
    const filtros = [
      eq(funilMensal.etapa, 'negociacao'),
      eq(funilMensal.mesReferencia, mesReferenciaAtual()),
      isNull(funilMensal.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        vendedorNome: users.name,
        valorOrcado: funilMensal.valorOrcado,
        dataEntradaEtapa: funilMensal.dataEntradaEtapa,
      })
      .from(funilMensal)
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros))
      .orderBy(desc(funilMensal.valorOrcado))

    const valorTotal = linhas.reduce((acc, l) => acc + (l.valorOrcado ?? 0), 0)
    return { linhas, quantidade: linhas.length, valorTotal }
  }),

  motivosPerdas: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(funilMensal.etapa, 'perdido'),
      between(funilMensal.dataEntradaEtapa, inicio, fim),
      isNull(funilMensal.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)

    const porCategoria = await db
      .select({ categoria: funilMensal.motivoPerdaCategoria, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros))
      .groupBy(funilMensal.motivoPerdaCategoria)
      .orderBy(desc(count()))

    const porItem = await db
      .select({ item: funilMensal.motivoPerdaItem, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(...filtros, sql`${funilMensal.motivoPerdaItem} is not null`))
      .groupBy(funilMensal.motivoPerdaItem)
      .orderBy(desc(count()))

    return { porCategoria, porItem }
  }),
})
