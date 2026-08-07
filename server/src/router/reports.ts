import { z } from 'zod'
import { and, between, count, desc, eq, inArray, isNull, sql, sum } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, funilMensal, registroContato, itensPedido, users, vendas as vendasTable, logAuditoria } from '../db/schema.js'
import { diasDesde, mesReferenciaAtual } from '../lib/dataBr.js'

// Vendedores que o usuário logado tem permissão de ver neste relatório —
// admin vê todos (ou só um, se filtrar) e vendedor só vê a si mesmo.
// Vários relatórios novos precisam da lista de vendedores pra fazer a conta
// "de quantos clientes" por vendedor, não só filtrar registros já existentes
// (ex: positivação/cobertura de contato precisam do denominador mesmo pro
// vendedor que não tem nenhum registro no período).
async function vendedoresPermitidos(ctx: { user: { role: 'admin' | 'vendor'; id: number }; empresaId: number }, vendedorId: number | undefined) {
  const vendedores = await db.query.users.findMany({
    where: and(eq(users.empresaId, ctx.empresaId), eq(users.isActive, true), eq(users.superAdmin, false)),
    columns: { id: true, name: true },
  })
  if (ctx.user.role !== 'admin') return vendedores.filter((v) => v.id === ctx.user.id)
  return vendedorId ? vendedores.filter((v) => v.id === vendedorId) : vendedores
}

const regiaoEnum = z.enum(['norte', 'nordeste', 'centro_oeste', 'sudeste', 'sul']).optional()

const periodoInput = z.object({
  dataInicio: z.string(),
  dataFim: z.string(),
  vendedorId: z.number().optional(),
  regiao: regiaoEnum,
})

const filtroAtualInput = z.object({
  vendedorId: z.number().optional(),
  regiao: regiaoEnum,
})

function filtroVendedor(ctxRole: 'admin' | 'vendor', ctxUserId: number, vendedorId: number | undefined, coluna: any) {
  if (ctxRole === 'admin') return vendedorId ? eq(coluna, vendedorId) : undefined
  return eq(coluna, ctxUserId)
}

// Filtro opcional por região do cliente (norte/nordeste/centro_oeste/sudeste/
// sul) — mesma ideia de `filtroVendedor`: undefined quando não filtrado, pra
// não poluir o array de condições do `and(...)`.
function filtroRegiao(regiao: string | undefined, coluna: any) {
  return regiao ? eq(coluna, regiao) : undefined
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
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: vendasTable.clienteId,
        razaoSocial: clientes.razaoSocial,
        // Vendedor atual da carteira do cliente (não quem fechou a venda —
        // pode ter mudado de mãos desde então), pra bater com "de quem é
        // esse cliente hoje" que é o que o João pediu pra ver na curva ABC.
        vendedorNome: users.name,
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .leftJoin(users, eq(users.id, clientes.vendedorAtualId))
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
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtrosCarteira.push(filtroReg)

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

  // Mesma métrica de `positivacaoCarteira`, mas quebrada por vendedor — "de
  // 100 clientes, pra quantos ele vendeu no mês" por pessoa, não só o
  // agregado da empresa inteira quando nenhum vendedor está filtrado.
  positivacaoPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)

    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)

    const linhas = await Promise.all(
      vendedores.map(async (v) => {
        const filtrosCarteira = [eq(clientes.vendedorAtualId, v.id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
        if (filtroReg) filtrosCarteira.push(filtroReg)
        const [{ totalCarteira }] = await db.select({ totalCarteira: count() }).from(clientes).where(and(...filtrosCarteira))

        const filtrosAtivados = [...filtrosCarteira, between(clientes.dataUltimaCompra, inicio, fim)]
        const [{ ativados }] = await db.select({ ativados: count() }).from(clientes).where(and(...filtrosAtivados))

        // Total de contatos feitos pelo vendedor no período, quebrado por
        // canal (ligação x WhatsApp) — pedido do João pra ver ao lado da
        // positivação, não só a cobertura combinada dos dois canais.
        const filtrosContatos = [
          eq(registroContato.vendedorId, v.id),
          between(registroContato.dataHora, inicio, fim),
          isNull(registroContato.deletedAt),
        ]
        if (filtroReg) filtrosContatos.push(filtroReg)
        const [{ contatosLigacao, contatosWhatsapp }] = await db
          .select({
            contatosLigacao: sql<number>`sum(case when ${registroContato.tipo} = 'ligacao' then 1 else 0 end)`.mapWith(Number),
            contatosWhatsapp: sql<number>`sum(case when ${registroContato.tipo} = 'whatsapp' then 1 else 0 end)`.mapWith(Number),
          })
          .from(registroContato)
          .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
          .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
          .where(and(...filtrosContatos))

        return {
          vendedorId: v.id,
          nome: v.name,
          totalCarteira,
          ativados,
          contatosLigacao: contatosLigacao ?? 0,
          contatosWhatsapp: contatosWhatsapp ?? 0,
          percentual: totalCarteira > 0 ? Math.round((ativados / totalCarteira) * 1000) / 10 : 0,
        }
      })
    )
    return linhas.sort((a, b) => b.percentual - a.percentual)
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
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

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

  // "Vendedor tem 100 clientes, pra quantos ele ligou ou mandou WhatsApp no
  // mês" — cobertura de contato por telefone, por vendedor (não conta
  // e-mail/visita, só os dois canais que o João pediu: "whats e fones").
  // Mesmo formato de `positivacaoPorVendedor`, trocando "comprou" por
  // "recebeu contato".
  contatosCoberturaPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)

    const linhas = await Promise.all(
      vendedores.map(async (v) => {
        const filtrosCarteira = [eq(clientes.vendedorAtualId, v.id), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
        if (filtroReg) filtrosCarteira.push(filtroReg)
        const [{ totalCarteira }] = await db.select({ totalCarteira: count() }).from(clientes).where(and(...filtrosCarteira))

        const filtrosContatados = [
          eq(funilMensal.vendedorId, v.id),
          sql`${registroContato.tipo} in ('whatsapp', 'ligacao')`,
          between(registroContato.dataHora, inicio, fim),
          isNull(registroContato.deletedAt),
        ]
        if (filtroReg) filtrosContatados.push(filtroReg)
        const [{ contatados }] = await db
          .select({ contatados: sql<number>`count(distinct ${funilMensal.clienteId})`.mapWith(Number) })
          .from(registroContato)
          .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
          .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
          .where(and(...filtrosContatados))

        return {
          vendedorId: v.id,
          nome: v.name,
          totalCarteira,
          contatados,
          semContato: totalCarteira - contatados,
          percentual: totalCarteira > 0 ? Math.round((contatados / totalCarteira) * 1000) / 10 : 0,
        }
      })
    )
    return linhas.sort((a, b) => b.percentual - a.percentual)
  }),

  // Tentativa = toda ligação registrada no período (manual ou automática via
  // GoTo). Efetiva = subconjunto que durou pelo menos o mínimo configurado
  // (GoTo) ou foi marcada como respondida manualmente — ver `efetiva` em
  // registro_contato. Agrupado por vendedor pra comparar quem liga muito mas
  // fala pouco (tentativas altas, % efetiva baixo) de quem liga menos mas
  // conversa de verdade.
  ligacoesEfetividade: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(registroContato.tipo, 'ligacao' as const),
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        vendedorId: registroContato.vendedorId,
        nome: users.name,
        tentativas: count(registroContato.id).mapWith(Number),
        efetivas: sql<number>`sum(case when ${registroContato.efetiva} = 1 then 1 else 0 end)`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(users, eq(users.id, registroContato.vendedorId))
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(registroContato.vendedorId)
      .orderBy(desc(count(registroContato.id)))

    return linhas.map((l) => ({
      ...l,
      percentualEfetividade: l.tentativas > 0 ? Math.round((l.efetivas / l.tentativas) * 1000) / 10 : 0,
    }))
  }),

  // Mesma métrica de `ligacoesEfetividade`, mas agrupada por CLIENTE em vez
  // de vendedor — pra analisar quantas ligações cada cliente recebeu de
  // verdade no período, não só quem na equipe liga mais. "Pendentes" conta
  // ligações sem `resultado` confirmado ainda (a GoTo nunca sabe sozinha se
  // foi atendida ou caiu na caixa postal — só o vendedor confirmando decide
  // isso, ver `registrarLigacaoAutomatica` em goto.ts) — um número alto aqui
  // também é sinal de que ninguém está voltando pra confirmar as ligações.
  ligacoesPorCliente: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [
      eq(registroContato.tipo, 'ligacao' as const),
      between(registroContato.dataHora, inicio, fim),
      isNull(registroContato.deletedAt),
      eq(clientes.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, registroContato.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        clienteId: funilMensal.clienteId,
        razaoSocial: clientes.razaoSocial,
        tentativas: count(registroContato.id).mapWith(Number),
        efetivas: sql<number>`sum(case when ${registroContato.efetiva} = 1 then 1 else 0 end)`.mapWith(Number),
        pendentes: sql<number>`sum(case when ${registroContato.resultado} is null then 1 else 0 end)`.mapWith(Number),
        duracaoMediaSegundos: sql<number>`avg(${registroContato.duracaoSegundos})`.mapWith(Number),
      })
      .from(registroContato)
      .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.clienteId)
      .orderBy(desc(count(registroContato.id)))

    return linhas.map((l) => ({
      ...l,
      percentualEfetividade: l.tentativas > 0 ? Math.round((l.efetivas / l.tentativas) * 1000) / 10 : 0,
    }))
  }),

  vendas: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, vendasTable.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const [{ quantidade, valorTotal }] = await db
      .select({
        quantidade: count(),
        valorTotal: sum(vendasTable.valorFechado).mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(users, eq(users.id, vendasTable.vendedorId))
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .where(and(...filtros))

    return {
      quantidade,
      valorTotal: valorTotal ?? 0,
      ticketMedio: quantidade > 0 ? (valorTotal ?? 0) / quantidade : 0,
    }
  }),

  diasSemContato: protectedProcedure
    .input(filtroAtualInput)
    .query(async ({ ctx, input }) => {
      const filtros = [isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, clientes.vendedorAtualId)
      if (filtroVend) filtros.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtros.push(filtroReg)

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
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

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

  // "Vendedor com 100 clientes, qual a quantidade média de itens que ele
  // vende por cliente" — mix de produtos por vendedor. Denominador é o
  // cliente que efetivamente COMPROU no período (não a carteira inteira de
  // 100 — dividir pela carteira toda afundaria o número pra quase zero e
  // não diria nada sobre o tamanho real da cesta de compra).
  mixProdutosPorVendedor: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
    const { inicio, fim } = limitesDia(input)
    const filtros = [between(vendasTable.dataFechamento, inicio, fim), isNull(vendasTable.deletedAt), eq(users.empresaId, ctx.empresaId)]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, vendasTable.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const linhas = await db
      .select({
        vendedorId: vendasTable.vendedorId,
        nome: users.name,
        clientesComVenda: sql<number>`count(distinct ${vendasTable.clienteId})`.mapWith(Number),
        totalLinhasItem: sql<number>`count(${itensPedido.id})`.mapWith(Number),
        totalQuantidade: sql<number>`coalesce(sum(${itensPedido.quantidade}), 0)`.mapWith(Number),
      })
      .from(vendasTable)
      .innerJoin(users, eq(users.id, vendasTable.vendedorId))
      .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
      .leftJoin(itensPedido, and(eq(itensPedido.vendaId, vendasTable.id), isNull(itensPedido.deletedAt)))
      .where(and(...filtros))
      .groupBy(vendasTable.vendedorId)

    return linhas.map((l) => ({
      ...l,
      mediaItensPorCliente: l.clientesComVenda > 0 ? Math.round((l.totalLinhasItem / l.clientesComVenda) * 10) / 10 : 0,
      mediaQuantidadePorCliente: l.clientesComVenda > 0 ? Math.round((l.totalQuantidade / l.clientesComVenda) * 10) / 10 : 0,
    }))
  }),

  // Orçamentos/propostas em aberto — negócios em "negociação" no mês
  // corrente, com o valor orçado que o vendedor lançou no Kanban. Não é um
  // relatório de período (é uma foto do que está em aberto agora), por isso
  // o input é só o filtro de vendedor, igual `diasSemContato`.
  orcamentosAbertos: protectedProcedure.input(filtroAtualInput).query(async ({ ctx, input }) => {
    const filtros = [
      eq(funilMensal.etapa, 'negociacao'),
      eq(funilMensal.mesReferencia, mesReferenciaAtual()),
      isNull(funilMensal.deletedAt),
      eq(users.empresaId, ctx.empresaId),
    ]
    const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
    if (filtroVend) filtros.push(filtroVend)
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

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
    const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
    if (filtroReg) filtros.push(filtroReg)

    const porCategoria = await db
      .select({ categoria: funilMensal.motivoPerdaCategoria, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros))
      .groupBy(funilMensal.motivoPerdaCategoria)
      .orderBy(desc(count()))

    const porItem = await db
      .select({ item: funilMensal.motivoPerdaItem, quantidade: count() })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
      .where(and(...filtros, sql`${funilMensal.motivoPerdaItem} is not null`))
      .groupBy(funilMensal.motivoPerdaItem)
      .orderBy(desc(count()))

    return { porCategoria, porItem }
  }),

  // Clientes completamente esquecidos no mês corrente: zero contato
  // registrado (qtdTentativasContato do funil do mês, já mantido por
  // contatos.ts/goto.ts) E sem nenhum orçamento lançado (valorOrcado nulo).
  // Não é relatório de período (foto do mês corrente, igual
  // `orcamentosAbertos`) — o vendedor pode ter tentado ontem, mas se não
  // tem nem contato nem orçamento neste mês, ainda está "intocado".
  clientesSemOrcamentoEContato: protectedProcedure
    .input(filtroAtualInput)
    .query(async ({ ctx, input }) => {
      const filtros = [eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt), eq(clientes.empresaId, ctx.empresaId)]
      const filtroVend = filtroVendedor(ctx.user.role, ctx.user.id, input.vendedorId, funilMensal.vendedorId)
      if (filtroVend) filtros.push(filtroVend)
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtros.push(filtroReg)

      const funis = await db
        .select({
          clienteId: funilMensal.clienteId,
          razaoSocial: clientes.razaoSocial,
          vendedorNome: users.name,
          valorOrcado: funilMensal.valorOrcado,
          qtdTentativasContato: funilMensal.qtdTentativasContato,
          etapa: funilMensal.etapa,
        })
        .from(funilMensal)
        .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
        .innerJoin(users, eq(users.id, funilMensal.vendedorId))
        .where(and(...filtros))

      return funis
        .filter((f) => f.valorOrcado === null && f.qtdTentativasContato === 0)
        .map((f) => ({ clienteId: f.clienteId, razaoSocial: f.razaoSocial, vendedorNome: f.vendedorNome, etapa: f.etapa }))
    }),

  // "Quantos orçamentos cada vendedor faz, por dia/semana/mês" — usa
  // log_auditoria (não funilMensal.dataEntradaEtapa, que é sobrescrita toda
  // vez que a etapa do card é resalva, mesmo sem mudar) porque só o log de
  // auditoria registra um EVENTO por vez que um card entrou de fato em
  // "negociação" (registrarAuditoria só grava quando etapa muda de verdade,
  // ver funil.ts). Bucket de dia/mês/semana calculado aqui (não em SQL) pra
  // não depender de função de data específica do SQLite pra "segunda-feira
  // da semana", que não existe pronta.
  orcamentosPorVendedor: protectedProcedure
    .input(periodoInput.extend({ granularidade: z.enum(['dia', 'semana', 'mes']).default('dia') }))
    .query(async ({ ctx, input }) => {
      const { inicio, fim } = limitesDia(input)
      const vendedores = await vendedoresPermitidos(ctx, input.vendedorId)
      const idsPermitidos = vendedores.map((v) => v.id)
      if (!idsPermitidos.length) return []

      const filtrosEventos = [
        eq(logAuditoria.tabela, 'funil_mensal'),
        eq(logAuditoria.acao, 'mudar_etapa'),
        eq(logAuditoria.campo, 'etapa'),
        eq(logAuditoria.valorNovo, 'negociacao'),
        between(logAuditoria.alteradoEm, inicio, fim),
        inArray(logAuditoria.alteradoPor, idsPermitidos),
      ]
      const filtroReg = filtroRegiao(input.regiao, clientes.regiao)
      if (filtroReg) filtrosEventos.push(filtroReg)

      // Join com funilMensal/clientes só serve pro filtro de região opcional
      // (logAuditoria.registroId aponta pro funilMensal.id quando tabela =
      // 'funil_mensal', filtrado acima).
      const eventos = await db
        .select({ vendedorId: logAuditoria.alteradoPor, alteradoEm: logAuditoria.alteradoEm })
        .from(logAuditoria)
        .innerJoin(funilMensal, eq(funilMensal.id, logAuditoria.registroId))
        .innerJoin(clientes, eq(clientes.id, funilMensal.clienteId))
        .where(and(...filtrosEventos))

      const nomePorVendedor = new Map(vendedores.map((v) => [v.id, v.name]))

      function bucketDe(dataHora: string): string {
        if (input.granularidade === 'mes') return dataHora.slice(0, 7)
        if (input.granularidade === 'dia') return dataHora.slice(0, 10)
        const d = new Date(dataHora.replace(' ', 'T') + 'Z')
        const diaSemana = (d.getUTCDay() + 6) % 7 // 0 = segunda
        const segunda = new Date(d)
        segunda.setUTCDate(d.getUTCDate() - diaSemana)
        return segunda.toISOString().slice(0, 10)
      }

      const contagem = new Map<string, number>()
      for (const ev of eventos) {
        if (!ev.vendedorId) continue
        const chave = `${ev.vendedorId}|${bucketDe(ev.alteradoEm)}`
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
      }

      return [...contagem.entries()]
        .map(([chave, quantidade]) => {
          const [vendedorIdStr, periodo] = chave.split('|')
          const vendedorId = Number(vendedorIdStr)
          return { vendedorId, nome: nomePorVendedor.get(vendedorId) ?? '—', periodo, quantidade }
        })
        .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : a.nome.localeCompare(b.nome, 'pt-BR')))
    }),
})
