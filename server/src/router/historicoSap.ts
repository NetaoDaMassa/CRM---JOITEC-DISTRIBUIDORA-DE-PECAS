import { z } from 'zod'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, sapCotacoesHistorico, sapCotacoesItens, sapImportacoes, sapVendasHistorico, users } from '../db/schema.js'
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
  // Desde 2026-10-22 cada cotação traz os itens (sap_cotacoes_itens, ligados
  // pelo nº); cotação que só existe nos itens (ago em diante, sem cabeçalho)
  // entra na lista também, com o valor total que veio nos itens.
  cotacoesDoCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await db.query.clientes.findFirst({
      where: and(eq(clientes.id, input.clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
      columns: { id: true, vendedorAtualId: true },
    })
    if (!cliente) throw new Error('Cliente não encontrado')
    if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')

    const cabecalhos = await db
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
    const linhasItens = await db
      .select({
        id: sapCotacoesItens.id,
        numeroCotacao: sapCotacoesItens.numeroCotacao,
        dataCotacao: sapCotacoesItens.dataCotacao,
        status: sapCotacoesItens.status,
        valorCotacao: sapCotacoesItens.valorCotacao,
        linha: sapCotacoesItens.linha,
        codigoItem: sapCotacoesItens.codigoItem,
        descricao: sapCotacoesItens.descricao,
        quantidade: sapCotacoesItens.quantidade,
        valorUnitario: sapCotacoesItens.valorUnitario,
        valorTotal: sapCotacoesItens.valorTotal,
      })
      .from(sapCotacoesItens)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapCotacoesItens.importacaoId))
      .where(and(eq(sapCotacoesItens.clienteId, cliente.id), eq(sapImportacoes.ativo, true)))
      .orderBy(asc(sapCotacoesItens.linha), asc(sapCotacoesItens.id))

    type Item = { codigoItem: string | null; descricao: string; quantidade: number | null; valorUnitario: number | null; valorTotal: number | null }
    const itensPorNumero = new Map<string, Item[]>()
    for (const l of linhasItens) {
      const lista = itensPorNumero.get(l.numeroCotacao) ?? []
      lista.push({ codigoItem: l.codigoItem, descricao: l.descricao, quantidade: l.quantidade, valorUnitario: l.valorUnitario, valorTotal: l.valorTotal })
      itensPorNumero.set(l.numeroCotacao, lista)
    }
    const cotacoes = cabecalhos.map((c) => ({ ...c, chave: `c${c.id}`, itens: itensPorNumero.get(c.numeroCotacao) ?? [] }))
    const comCabecalho = new Set(cabecalhos.map((c) => c.numeroCotacao))
    const soNosItens = new Set<string>()
    for (const l of linhasItens) {
      if (comCabecalho.has(l.numeroCotacao) || soNosItens.has(l.numeroCotacao)) continue
      soNosItens.add(l.numeroCotacao)
      cotacoes.push({
        id: -l.id,
        chave: `i${l.id}`,
        dataCotacao: l.dataCotacao,
        numeroCotacao: l.numeroCotacao,
        valor: l.valorCotacao ?? 0,
        status: l.status,
        itens: itensPorNumero.get(l.numeroCotacao) ?? [],
      })
    }
    cotacoes.sort((a, b) => b.dataCotacao.localeCompare(a.dataCotacao) || Number(b.numeroCotacao) - Number(a.numeroCotacao))

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
