import { z } from 'zod'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, sapCotacoesHistorico, sapImportacoes, sapVendasHistorico, users } from '../db/schema.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Histórico de vendas do SAP (só consulta) — ver sapImportacoes em schema.ts.
// A importação em si é o POST /upload/historico-sap (index.ts).
export const historicoSapRouter = router({
  importacoes: superAdminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: sapImportacoes.id,
        nomeArquivo: sapImportacoes.nomeArquivo,
        ativo: sapImportacoes.ativo,
        totalLinhas: sapImportacoes.totalLinhas,
        importadas: sapImportacoes.importadas,
        naoEncontradas: sapImportacoes.naoEncontradas,
        valorTotal: sapImportacoes.valorTotal,
        dataInicio: sapImportacoes.dataInicio,
        dataFim: sapImportacoes.dataFim,
        createdAt: sapImportacoes.createdAt,
        importadoPor: users.name,
      })
      .from(sapImportacoes)
      .leftJoin(users, eq(users.id, sapImportacoes.importadoPor))
      .where(and(eq(sapImportacoes.empresaId, ctx.empresaId), eq(sapImportacoes.tipo, 'vendas')))
      .orderBy(desc(sapImportacoes.id))
  }),

  // Desligar = some de todas as consultas, mas continua guardado (dá pra
  // religar). É o "filtro" pra voltar atrás sem perder nada.
  alternarAtivo: superAdminProcedure.input(z.object({ id: z.number(), ativo: z.boolean() })).mutation(async ({ ctx, input }) => {
    const lote = await db.query.sapImportacoes.findFirst({
      where: and(eq(sapImportacoes.id, input.id), eq(sapImportacoes.empresaId, ctx.empresaId)),
    })
    if (!lote) throw new Error('Importação não encontrada')
    await db.update(sapImportacoes).set({ ativo: input.ativo }).where(eq(sapImportacoes.id, lote.id))
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: lote.id,
      acao: 'editar',
      campo: 'ativo',
      valorAnterior: String(lote.ativo),
      valorNovo: String(input.ativo),
      alteradoPor: ctx.user.id,
    })
    return { success: true }
  }),

  // Exclusão definitiva do lote e das linhas dele (apaga as linhas na mão
  // antes — não dá pra contar com o cascade do SQLite).
  excluir: superAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const lote = await db.query.sapImportacoes.findFirst({
      where: and(eq(sapImportacoes.id, input.id), eq(sapImportacoes.empresaId, ctx.empresaId)),
    })
    if (!lote) throw new Error('Importação não encontrada')
    await db.transaction(async (tx) => {
      await tx.delete(sapVendasHistorico).where(eq(sapVendasHistorico.importacaoId, lote.id))
      await tx.delete(sapImportacoes).where(eq(sapImportacoes.id, lote.id))
    })
    await registrarAuditoria({
      tabela: 'sap_importacoes',
      registroId: lote.id,
      acao: 'excluir',
      valorAnterior: `${lote.nomeArquivo} · ${lote.importadas} linhas`,
      alteradoPor: ctx.user.id,
    })
    return { success: true }
  }),

  // Ficha do cliente — mesma regra de acesso de clientes.get (admin vê
  // qualquer cliente da empresa; vendedor só os da carteira dele). Só lotes
  // ativos.
  doCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      columns: { id: true, vendedorAtualId: true },
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')

    const pedidos = await db
      .select({
        id: sapVendasHistorico.id,
        dataPedido: sapVendasHistorico.dataPedido,
        numeroPedido: sapVendasHistorico.numeroPedido,
        valor: sapVendasHistorico.valor,
      })
      .from(sapVendasHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
      .where(and(eq(sapVendasHistorico.clienteId, cliente.id), eq(sapImportacoes.ativo, true)))
      .orderBy(desc(sapVendasHistorico.dataPedido), asc(sapVendasHistorico.id))

    const porAnoMap = new Map<string, { total: number; qtd: number }>()
    for (const p of pedidos) {
      const ano = p.dataPedido.slice(0, 4)
      const atual = porAnoMap.get(ano) ?? { total: 0, qtd: 0 }
      atual.total += p.valor
      atual.qtd++
      porAnoMap.set(ano, atual)
    }
    const total = pedidos.reduce((s, p) => s + p.valor, 0)
    return {
      pedidos,
      total,
      qtdPedidos: pedidos.length,
      ticketMedio: pedidos.length ? total / pedidos.length : 0,
      ultimaCompra: pedidos[0]?.dataPedido ?? null,
      primeiraCompra: pedidos[pedidos.length - 1]?.dataPedido ?? null,
      porAno: [...porAnoMap.entries()].map(([ano, v]) => ({ ano, ...v })).sort((a, b) => b.ano.localeCompare(a.ano)),
    }
  }),

  // Cotações/orçamentos do SAP na ficha do cliente (pedido do João,
  // 2026-10-20) — mesma regra de acesso de `doCliente`, só lotes ligados.
  cotacoesDoCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      columns: { id: true, vendedorAtualId: true },
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')

    const cotacoes = await db
      .select({
        id: sapCotacoesHistorico.id,
        dataCotacao: sapCotacoesHistorico.dataCotacao,
        numeroCotacao: sapCotacoesHistorico.numeroCotacao,
        valor: sapCotacoesHistorico.valor,
        status: sapCotacoesHistorico.status,
      })
      .from(sapCotacoesHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesHistorico.importacaoId))
      .where(and(eq(sapCotacoesHistorico.clienteId, cliente.id), eq(sapImportacoes.ativo, true)))
      .orderBy(desc(sapCotacoesHistorico.dataCotacao), desc(sapCotacoesHistorico.id))

    const soma = (st?: string) => {
      const l = st ? cotacoes.filter((c) => c.status === st) : cotacoes
      return { qtd: l.length, valor: l.reduce((s, c) => s + c.valor, 0) }
    }
    const fechado = soma('fechado')
    const cancelado = soma('cancelado')
    const decididas = fechado.qtd + cancelado.qtd
    return {
      cotacoes,
      total: soma(),
      aberto: soma('aberto'),
      fechado,
      cancelado,
      // Fechadas ÷ (fechadas + canceladas) — aberta ainda não decidiu.
      taxaFechamento: decididas ? (fechado.qtd / decididas) * 100 : null,
      ultima: cotacoes[0]?.dataCotacao ?? null,
      primeira: cotacoes[cotacoes.length - 1]?.dataCotacao ?? null,
    }
  }),
})
