import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, isNotNull, or } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import {
  clientes,
  funilMensal,
  itensPedido,
  logAuditoria,
  sapCotacoesHistorico,
  sapCotacoesItens,
  sapImportacoes,
  sapItensHistorico,
  sapVendasHistorico,
  users,
  vendas,
} from '../db/schema.js'
import { toLocalDateKey, toUtcISO } from '../lib/businessHours.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Histórico de vendas do SAP (só consulta) — ver sapImportacoes em schema.ts.

type ItemVenda = { codigoItem: string | null; descricao: string; quantidade: number | null; valorUnitario: number | null; valorTotal: number | null }

async function acharCliente(ctx: { empresaId: number; user: { id: number; role: string } }, clienteId: number) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), isNull(clientes.deletedAt), eq(clientes.empresaId, ctx.empresaId)),
    columns: { id: true, vendedorAtualId: true },
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
  return cliente
}

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000)
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


  // Histórico de VENDAS completo na ficha do cliente (pedido do João,
  // 2026-10-22): pedidos do SAP (abr–jul, antes do CRM) + vendas lançadas no
  // CRM (ago em diante), numa lista só, com o PDF do pedido e os itens.
  // Itens: as notas do SAP (sap_itens_historico) não trazem o nº do pedido,
  // então cada pedido/venda é ligado à nota do MESMO cliente com data perto
  // (pedido SAP: nota de 0 a 20 dias depois; venda do CRM: 10 dias antes a
  // 20 depois, porque a venda às vezes é lançada depois de faturar) e valor
  // até 15% diferente (a nota tem frete/impostos) — conferido nas planilhas:
  // 89% dos pedidos de abr–jul acham a nota assim. Venda do CRM sem nota
  // achada usa os itens lidos do PDF (itens_pedido). Nada aqui muda total
  // nenhum: o valor é sempre o do pedido/venda.
  vendasDoCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await acharCliente(ctx, input.clienteId)

    const pedidosSap = await db
      .select({ id: sapVendasHistorico.id, data: sapVendasHistorico.dataPedido, numero: sapVendasHistorico.numeroPedido, valor: sapVendasHistorico.valor })
      .from(sapVendasHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
      .where(and(eq(sapVendasHistorico.clienteId, cliente.id), eq(sapImportacoes.ativo, true)))
    const vendasCrm = await db
      .select({
        id: vendas.id,
        dataFechamento: vendas.dataFechamento,
        valor: vendas.valorFechado,
        numeroPedido: vendas.numeroPedido,
        numeroNotaFiscal: vendas.numeroNotaFiscal,
        condicaoPagamento: vendas.condicaoPagamento,
        pdfPedidoPath: vendas.pdfPedidoPath,
        vendedorNome: users.name,
      })
      .from(vendas)
      .innerJoin(users, eq(users.id, vendas.vendedorId))
      .where(and(eq(vendas.clienteId, cliente.id), isNull(vendas.deletedAt)))
    const linhasNotas = await db
      .select({
        numeroNota: sapItensHistorico.numeroNota,
        data: sapItensHistorico.dataNota,
        codigoItem: sapItensHistorico.codigoItem,
        descricao: sapItensHistorico.descricao,
        quantidade: sapItensHistorico.quantidade,
        valorUnitario: sapItensHistorico.valorUnitario,
        valorTotal: sapItensHistorico.valorTotal,
      })
      .from(sapItensHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapItensHistorico.importacaoId))
      .where(and(eq(sapItensHistorico.clienteId, cliente.id), eq(sapImportacoes.ativo, true)))
      .orderBy(asc(sapItensHistorico.id))
    const itensPdf = vendasCrm.length
      ? await db
          .select({ vendaId: itensPedido.vendaId, descricao: itensPedido.descricao, quantidade: itensPedido.quantidade, valorUnitario: itensPedido.valorUnitario, valorTotal: itensPedido.valorTotal })
          .from(itensPedido)
          .where(and(inArray(itensPedido.vendaId, vendasCrm.map((v) => v.id)), isNull(itensPedido.deletedAt)))
          .orderBy(asc(itensPedido.id))
      : []

    const notas = new Map<string, { numero: string; data: string; soma: number; itens: ItemVenda[] }>()
    for (const l of linhasNotas) {
      const n = notas.get(l.numeroNota) ?? { numero: l.numeroNota, data: l.data, soma: 0, itens: [] }
      n.soma += l.valorTotal ?? 0
      n.itens.push({ codigoItem: l.codigoItem, descricao: l.descricao, quantidade: l.quantidade, valorUnitario: l.valorUnitario, valorTotal: l.valorTotal })
      notas.set(l.numeroNota, n)
    }
    const usadas = new Set<string>()
    const acharNota = (data: string, valor: number, janela: [number, number], numeroInformado?: string | null) => {
      const direto = numeroInformado ? notas.get(numeroInformado.replace(/\D/g, '')) ?? notas.get(numeroInformado.trim()) : undefined
      if (direto && !usadas.has(direto.numero)) {
        usadas.add(direto.numero)
        return direto
      }
      let melhor: { n: typeof direto; dif: number } | null = null
      for (const n of notas.values()) {
        if (usadas.has(n.numero)) continue
        const d = diasEntre(data, n.data)
        if (d < janela[0] || d > janela[1]) continue
        const dif = valor > 0 ? Math.abs(n.soma - valor) / valor : Infinity
        if (dif <= 0.15 && (!melhor || dif < melhor.dif)) melhor = { n, dif }
      }
      if (melhor?.n) usadas.add(melhor.n.numero)
      return melhor?.n
    }

    type Linha = {
      chave: string
      origem: 'sap' | 'crm'
      data: string
      numeroPedido: string | null
      numeroNota: string | null
      valor: number
      vendedorNome: string | null
      condicaoPagamento: string | null
      pdfPedidoPath: string | null
      itensDe: 'nota' | 'pdf' | null
      itens: ItemVenda[]
    }
    const linhas: Linha[] = []
    // Mais antigo primeiro pra nota ir pro primeiro pedido que bate.
    for (const p of [...pedidosSap].sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)) {
      const n = acharNota(p.data, p.valor, [0, 20])
      linhas.push({ chave: `sap-${p.id}`, origem: 'sap', data: p.data, numeroPedido: p.numero, numeroNota: n?.numero ?? null, valor: p.valor, vendedorNome: null, condicaoPagamento: null, pdfPedidoPath: null, itensDe: n ? 'nota' : null, itens: n?.itens ?? [] })
    }
    const pdfPorVenda = new Map<number, ItemVenda[]>()
    for (const i of itensPdf) {
      const l = pdfPorVenda.get(i.vendaId) ?? []
      l.push({ codigoItem: null, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal })
      pdfPorVenda.set(i.vendaId, l)
    }
    const crmComData = vendasCrm.map((v) => ({ ...v, data: toLocalDateKey(toUtcISO(v.dataFechamento)) }))
    for (const v of crmComData.sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)) {
      const n = acharNota(v.data, v.valor, [-10, 20], v.numeroNotaFiscal)
      const pdf = pdfPorVenda.get(v.id) ?? []
      linhas.push({
        chave: `crm-${v.id}`,
        origem: 'crm',
        data: v.data,
        numeroPedido: v.numeroPedido,
        numeroNota: n?.numero ?? v.numeroNotaFiscal,
        valor: v.valor,
        vendedorNome: v.vendedorNome,
        condicaoPagamento: v.condicaoPagamento,
        pdfPedidoPath: v.pdfPedidoPath,
        itensDe: n ? 'nota' : pdf.length ? 'pdf' : null,
        itens: n?.itens ?? pdf,
      })
    }
    linhas.sort((a, b) => b.data.localeCompare(a.data) || b.chave.localeCompare(a.chave))

    const total = linhas.reduce((s, l) => s + l.valor, 0)
    const porAno = new Map<string, { total: number; qtd: number }>()
    for (const l of linhas) {
      const a = porAno.get(l.data.slice(0, 4)) ?? { total: 0, qtd: 0 }
      a.total += l.valor
      a.qtd++
      porAno.set(l.data.slice(0, 4), a)
    }
    return {
      linhas,
      total,
      qtd: linhas.length,
      qtdSap: pedidosSap.length,
      qtdCrm: vendasCrm.length,
      ticketMedio: linhas.length ? total / linhas.length : 0,
      ultimaCompra: linhas[0]?.data ?? null,
      primeiraCompra: linhas[linhas.length - 1]?.data ?? null,
      porAno: [...porAno.entries()].map(([ano, v]) => ({ ano, ...v })).sort((a, b) => b.ano.localeCompare(a.ano)),
    }
  }),

  // Cotações/orçamentos do SAP na ficha do cliente (pedido do João,
  // 2026-10-20) — mesma regra de acesso de `doCliente`, só lotes ligados.
  // Desde 2026-10-22 cada cotação traz os itens (sap_cotacoes_itens, ligados
  // pelo nº); cotação que só existe nos itens (ago em diante, sem cabeçalho)
  // entra na lista também, com o valor total que veio nos itens.
  cotacoesDoCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    const cliente = await acharCliente(ctx, input.clienteId)

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

    // Orçamentos feitos no CRM (desde 2026-10-22, pra ficha mostrar também
    // o período depois do SAP): card do mês com valor orçado ou PDF de
    // proposta. Data = última vez que o card entrou em Negociação (sem
    // registro, a data em que entrou na etapa atual).
    const cards = await db
      .select({
        id: funilMensal.id,
        mesReferencia: funilMensal.mesReferencia,
        etapa: funilMensal.etapa,
        valorOrcado: funilMensal.valorOrcado,
        pdfPropostaPath: funilMensal.pdfPropostaPath,
        dataEntradaEtapa: funilMensal.dataEntradaEtapa,
        motivoPerda: funilMensal.motivoPerdaObservacao,
        vendedorNome: users.name,
      })
      .from(funilMensal)
      .innerJoin(users, eq(users.id, funilMensal.vendedorId))
      .where(and(eq(funilMensal.clienteId, cliente.id), isNull(funilMensal.deletedAt), or(isNotNull(funilMensal.valorOrcado), isNotNull(funilMensal.pdfPropostaPath))))
    const entradas = cards.length
      ? await db
          .select({ registroId: logAuditoria.registroId, em: logAuditoria.alteradoEm })
          .from(logAuditoria)
          .where(
            and(
              eq(logAuditoria.tabela, 'funil_mensal'),
              eq(logAuditoria.campo, 'etapa'),
              eq(logAuditoria.valorNovo, 'negociacao'),
              inArray(logAuditoria.registroId, cards.map((c) => c.id))
            )
          )
      : []
    const entrouEm = new Map<number, string>()
    for (const e of entradas) if (!entrouEm.has(e.registroId) || e.em > entrouEm.get(e.registroId)!) entrouEm.set(e.registroId, e.em)
    const situacaoCard = (etapa: string) =>
      etapa === 'negociacao' ? 'aberto' : etapa === 'fechado' || etapa === 'faturamento' ? 'fechado' : etapa === 'perdido' ? 'cancelado' : 'outro'
    const orcamentosCrm = cards
      .map((c) => {
        const quando = entrouEm.get(c.id) ?? c.dataEntradaEtapa
        return {
          id: c.id,
          data: quando ? toLocalDateKey(toUtcISO(quando)) : `${c.mesReferencia.slice(0, 7)}-01`,
          mesReferencia: c.mesReferencia,
          valor: c.valorOrcado,
          status: situacaoCard(c.etapa),
          pdfPropostaPath: c.pdfPropostaPath,
          motivoPerda: c.motivoPerda,
          vendedorNome: c.vendedorNome,
        }
      })
      .sort((a, b) => b.data.localeCompare(a.data))

    const soma = (st?: string) => {
      const l = st ? cotacoes.filter((c) => c.status === st) : cotacoes
      return { qtd: l.length, valor: l.reduce((s, c) => s + c.valor, 0) }
    }
    const fechado = soma('fechado')
    const cancelado = soma('cancelado')
    const decididas = fechado.qtd + cancelado.qtd
    return {
      cotacoes,
      orcamentosCrm,
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
