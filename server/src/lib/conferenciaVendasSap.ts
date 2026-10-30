import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { caixaMovimentacoes, clientes, empresas, funilMensal, logAuditoria, sapConferenciaIgnorados, users, vendas } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'
import { getConfigTexto } from './configuracoes.js'
import { registrarAuditoria } from './auditoria.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'
import { vendedoresAutomacaoSap } from './sapSyncItens.js'
import { limparCodigo, semZerosEsquerda } from './importSapHistorico.js'
import { slugDoPedidoSap, vendedoresOdinTubosSap } from './sapVendasAuto.js'

// Conferência SAP × CRM (pedido do João, 2026-10-30). Depois da venda
// automática, o comparativo de outubro mostrou que a parte ligada ao SAP batia
// no centavo e a diferença era: venda digitada no CRM sem pedido no SAP
// (lançada em outro cliente, em outra empresa, pedido de setembro, pedido
// cancelado e refeito, duplicada) e pedido do SAP sem venda no CRM (cliente
// não cadastrado). Esta conferência mostra as duas listas com a pista do
// pedido provável, pra corrigir caso a caso.

export const SLUGS_CONFERENCIA = ['joitec', 'odin-tubos', 'joitec-automacao']
const GRUPO_PADRAO = 'C003770,C002707,C001284,C001270'
const FILIAL_NOME: Record<number, string> = { 1: 'Odin Compressores', 3: 'Joitec', 4: 'Odin Tubos', 5: 'Compretec' }

interface PedidoSap {
  DocEntry: number
  DocNum: number
  DocDate: string
  CardCode: string
  CardName: string
  DocTotal: number
  SalesPersonCode: number
  BPL_IDAssignedToInvoice: number
  Cancelled: string
}

// Os pedidos do SAP do mês (e do anterior, pra achar pedido de um mês lançado
// no outro) ficam 5 min em memória — a tela abre várias vezes seguidas.
const cache = new Map<string, { em: number; pedidos: PedidoSap[]; vendedores: Map<number, string> }>()

async function pedidosDoSap(mes: string, atualizar: boolean) {
  const c = cache.get(mes)
  if (c && !atualizar && Date.now() - c.em < 5 * 60_000) return c
  const de = new Date(`${mes}-01T12:00:00Z`)
  de.setUTCMonth(de.getUTCMonth() - 1)
  const fim = new Date(`${mes}-01T12:00:00Z`)
  fim.setUTCMonth(fim.getUTCMonth() + 1)
  fim.setUTCDate(0)
  const r = await comSessaoSap(async (sap) => ({
    pedidos: await sap.getTodos<PedidoSap>(
      `/Orders?$filter=DocDate ge '${de.toISOString().slice(0, 10)}' and DocDate le '${fim.toISOString().slice(0, 10)}'` +
        '&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,Cancelled',
      200
    ),
    vendedores: new Map(
      (await sap.getTodos<{ SalesEmployeeCode: number; SalesEmployeeName: string }>('/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName')).map((v) => [
        v.SalesEmployeeCode,
        v.SalesEmployeeName.trim(),
      ])
    ),
  }))
  const novo = { em: Date.now(), ...r }
  cache.set(mes, novo)
  return novo
}

// Código do SAP ("C002472") e código antigo do sistema anterior ("2472") são
// numerações diferentes — não tira o "C" pra comparar.
const chaves = (cod: string | null | undefined): string[] => {
  if (!cod) return []
  const k = limparCodigo(cod)
  return [k, semZerosEsquerda(k)]
}

export async function conferenciaVendasSap(empresaId: number, mes: string, opts: { vendedorId?: number; atualizar?: boolean } = {}) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (!empresa || !SLUGS_CONFERENCIA.includes(empresa.slug)) throw new Error('Conferência com o SAP só existe pra Joitec, Odin Tubos e Odin Automação.')
  const { pedidos, vendedores, em } = await pedidosDoSap(mes, !!opts.atualizar)
  const grupo = new Set(((await getConfigTexto('sap_receber_ignorar_clientes')) ?? GRUPO_PADRAO).split(',').map((s) => s.trim().toUpperCase()))
  const automacao = await vendedoresAutomacaoSap()
  const odinTubos = await vendedoresOdinTubosSap()

  const doMes = pedidos.filter(
    (p) =>
      dataSap(p.DocDate).startsWith(mes) &&
      !grupo.has(p.CardCode.toUpperCase()) &&
      slugDoPedidoSap(p.BPL_IDAssignedToInvoice, p.SalesPersonCode, automacao, odinTubos) === empresa.slug
  )

  // Vendas (de qualquer empresa) ligadas a algum desses pedidos.
  const entries = pedidos.map((p) => p.DocEntry)
  const ligadas = entries.length
    ? await db
        .select({ id: vendas.id, entry: vendas.pedidoSapEntry, mes: vendas.mesReferencia, empresa: empresas.nome, vendedor: users.name })
        .from(vendas)
        .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .leftJoin(users, eq(users.id, vendas.vendedorId))
        .where(and(inArray(vendas.pedidoSapEntry, entries), isNull(vendas.deletedAt)))
    : []
  const ligadaPorEntry = new Map(ligadas.map((l) => [l.entry!, l]))

  const vendasMes = await db
    .select({
      id: vendas.id,
      valor: vendas.valorFechado,
      data: vendas.dataFechamento,
      numeroPedido: vendas.numeroPedido,
      entry: vendas.pedidoSapEntry,
      vendedorId: vendas.vendedorId,
      vendedor: users.name,
      clienteId: clientes.id,
      cliente: clientes.razaoSocial,
      codigo: clientes.codigo,
      codigoAntigo: clientes.codigoAntigo,
    })
    .from(vendas)
    .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
    .leftJoin(users, eq(users.id, vendas.vendedorId))
    .where(and(eq(clientes.empresaId, empresaId), eq(vendas.mesReferencia, `${mes}-01`), isNull(vendas.deletedAt)))

  const ignorados = await db.select().from(sapConferenciaIgnorados).where(eq(sapConferenciaIgnorados.empresaId, empresaId))
  const ignVenda = new Map(ignorados.filter((i) => i.tipo === 'venda').map((i) => [i.referencia, i]))
  const ignPedido = new Map(ignorados.filter((i) => i.tipo === 'pedido').map((i) => [i.referencia, i]))

  const resumoPedido = (p: PedidoSap) => {
    const l = ligadaPorEntry.get(p.DocEntry)
    return {
      docEntry: p.DocEntry,
      docNum: p.DocNum,
      data: dataSap(p.DocDate),
      valor: p.DocTotal,
      clienteSap: `${p.CardCode} ${p.CardName}`.trim(),
      filial: FILIAL_NOME[p.BPL_IDAssignedToInvoice] ?? String(p.BPL_IDAssignedToInvoice),
      vendedorSap: vendedores.get(p.SalesPersonCode) ?? null,
      cancelado: p.Cancelled === 'tYES',
      ligadoA: l ? { vendaId: l.id, empresa: l.empresa, vendedor: l.vendedor } : null,
    }
  }

  // Venda do CRM sem pedido: pista = mesmo nº de pedido, mesmo valor (até R$ 1)
  // ou mesmo cliente — em qualquer filial, neste mês ou no anterior.
  const semPedido = vendasMes
    .filter((v) => v.entry == null && (!opts.vendedorId || v.vendedorId === opts.vendedorId))
    .map((v) => {
      const cods = new Set([...chaves(v.codigo), ...chaves(v.codigoAntigo)])
      const num = v.numeroPedido?.replace(/\D/g, '') ?? ''
      const pistas = pedidos
        .map((p) => {
          const motivos: string[] = []
          if (num && String(p.DocNum) === num) motivos.push('mesmo nº')
          if (Math.abs(p.DocTotal - v.valor) <= 1) motivos.push('mesmo valor')
          if (chaves(p.CardCode).some((k) => cods.has(k))) motivos.push('mesmo cliente')
          return { p, motivos }
        })
        .filter((x) => x.motivos.length && (x.motivos.length > 1 || x.motivos[0] !== 'mesmo cliente' || Math.abs(x.p.DocTotal - v.valor) <= v.valor * 0.5))
        .sort((a, b) => {
          const livreA = ligadaPorEntry.has(a.p.DocEntry) ? 1 : 0
          const livreB = ligadaPorEntry.has(b.p.DocEntry) ? 1 : 0
          return b.motivos.length - a.motivos.length || livreA - livreB || Math.abs(a.p.DocTotal - v.valor) - Math.abs(b.p.DocTotal - v.valor)
        })
        .slice(0, 4)
        .map((x) => ({ ...resumoPedido(x.p), motivos: x.motivos }))
      const ign = ignVenda.get(v.id)
      return {
        vendaId: v.id,
        valor: v.valor,
        data: v.data.slice(0, 10),
        numeroPedido: v.numeroPedido,
        vendedorId: v.vendedorId,
        vendedor: v.vendedor,
        clienteId: v.clienteId,
        cliente: v.cliente,
        codigo: v.codigo,
        pistas,
        ignorado: ign ? { motivo: ign.motivo, em: ign.createdAt } : null,
      }
    })

  // Pedido do SAP sem venda: por que não virou venda sozinho?
  const cadastros = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresaId), isNull(clientes.deletedAt)),
    columns: { id: true, codigo: true, codigoAntigo: true, razaoSocial: true, vendedorAtualId: true },
  })
  const porCodigo = new Map<string, (typeof cadastros)[number]>()
  for (const c of cadastros) for (const k of [...chaves(c.codigo), ...chaves(c.codigoAntigo)]) if (!porCodigo.has(k)) porCodigo.set(k, c)
  const semVenda = doMes
    .filter((p) => p.Cancelled !== 'tYES' && !ligadaPorEntry.has(p.DocEntry))
    .map((p) => {
      const cli = chaves(p.CardCode).map((k) => porCodigo.get(k)).find(Boolean) ?? null
      const ign = ignPedido.get(p.DocEntry)
      return {
        ...resumoPedido(p),
        cliente: cli ? { id: cli.id, nome: cli.razaoSocial, vendedorAtualId: cli.vendedorAtualId } : null,
        motivo: !cli ? 'Cliente não está cadastrado nesta empresa no CRM' : !cli.vendedorAtualId ? 'Cliente sem vendedor na carteira' : null,
        ignorado: ign ? { motivo: ign.motivo, em: ign.createdAt } : null,
      }
    })
    .filter((p) => !opts.vendedorId || p.cliente?.vendedorAtualId === opts.vendedorId)

  const outroMes = doMes
    .filter((p) => p.Cancelled !== 'tYES')
    .flatMap((p) => {
      const l = ligadaPorEntry.get(p.DocEntry)
      return l && l.mes !== `${mes}-01` ? [{ ...resumoPedido(p), mesVenda: l.mes.slice(0, 7) }] : []
    })

  const soma = (l: number[]) => Math.round(l.reduce((a, b) => a + b, 0) * 100) / 100
  const sapTotal = soma(doMes.filter((p) => p.Cancelled !== 'tYES').map((p) => p.DocTotal))
  const crmTotal = soma(vendasMes.map((v) => v.valor))
  return {
    empresa: empresa.nome,
    atualizadoEm: new Date(em).toISOString(),
    totais: {
      sap: sapTotal,
      sapPedidos: doMes.filter((p) => p.Cancelled !== 'tYES').length,
      crm: crmTotal,
      crmVendas: vendasMes.length,
      ligado: soma(vendasMes.filter((v) => v.entry != null).map((v) => v.valor)),
      diferenca: Math.round((crmTotal - sapTotal) * 100) / 100,
    },
    semPedido,
    semVenda,
    outroMes,
  }
}

// Pedido do SAP (um só, direto) — pra validar antes de ligar.
export async function pedidoSap(docEntry: number): Promise<PedidoSap> {
  return comSessaoSap((sap) =>
    sap.get<PedidoSap>(`/Orders(${docEntry})?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,SalesPersonCode,BPL_IDAssignedToInvoice,Cancelled`)
  )
}

export async function ligarVendaAoPedido(vendaId: number, docEntry: number, usuarioId: number) {
  const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, vendaId) })
  if (!venda || venda.deletedAt) throw new Error('Venda não encontrada')
  if (venda.pedidoSapEntry) throw new Error('Essa venda já está ligada a um pedido do SAP.')
  const p = await pedidoSap(docEntry)
  if (p.Cancelled === 'tYES') throw new Error(`O pedido ${p.DocNum} está cancelado no SAP.`)
  const outra = await db.query.vendas.findFirst({ where: and(eq(vendas.pedidoSapEntry, docEntry), isNull(vendas.deletedAt)) })
  if (outra) throw new Error(`O pedido ${p.DocNum} já está ligado à venda ${outra.id}.`)
  await db
    .update(vendas)
    .set({ pedidoSapEntry: p.DocEntry, numeroPedido: venda.numeroPedido ?? String(p.DocNum), valorFechado: p.DocTotal })
    .where(eq(vendas.id, vendaId))
  await registrarAuditoria({
    tabela: 'vendas',
    registroId: vendaId,
    acao: 'editar',
    campo: 'pedido_sap_entry',
    valorAnterior: String(venda.valorFechado),
    valorNovo: `ligada ao pedido ${p.DocNum} do SAP (${p.DocTotal})`,
    alteradoPor: usuarioId,
  })
  cache.clear()
  return { docNum: p.DocNum, valor: p.DocTotal }
}

// Exclui a venda (duplicada, de outro mês, pedido cancelado...) e, se o card
// ficou sem nenhuma venda, volta ele pra etapa de antes do "Fechado".
export async function excluirVendaConferencia(vendaId: number, motivo: string, usuarioId: number) {
  const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, vendaId) })
  if (!venda || venda.deletedAt) throw new Error('Venda não encontrada')
  if (venda.pedidoSapEntry) throw new Error('Essa venda está ligada a um pedido do SAP — não sai por aqui.')
  const agora = agoraSqlite()
  await db.update(vendas).set({ deletedAt: agora }).where(eq(vendas.id, vendaId))
  await db
    .update(caixaMovimentacoes)
    .set({ deletedAt: agora })
    .where(and(eq(caixaMovimentacoes.origemVendaId, vendaId), isNull(caixaMovimentacoes.deletedAt)))
  await registrarAuditoria({ tabela: 'vendas', registroId: vendaId, acao: 'excluir', campo: 'deletedAt', valorNovo: `${agora} — conferência SAP: ${motivo}`, alteradoPor: usuarioId })

  const resta = await db.select({ id: vendas.id }).from(vendas).where(and(eq(vendas.funilMensalId, venda.funilMensalId), isNull(vendas.deletedAt))).limit(1)
  let cardVoltouPara: string | null = null
  if (!resta.length) {
    const card = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, venda.funilMensalId) })
    if (card?.etapa === 'fechado') {
      const [mud] = await db
        .select({ anterior: logAuditoria.valorAnterior })
        .from(logAuditoria)
        .where(
          and(
            eq(logAuditoria.tabela, 'funil_mensal'),
            eq(logAuditoria.registroId, card.id),
            eq(logAuditoria.acao, 'mudar_etapa'),
            sql`${logAuditoria.valorNovo} like 'fechado%'`
          )
        )
        .orderBy(sql`${logAuditoria.id} desc`)
        .limit(1)
      if (mud?.anterior) {
        await db
          .update(funilMensal)
          .set({ etapa: mud.anterior as typeof card.etapa, dataEntradaEtapa: agora, updatedAt: agora, versao: sql`${funilMensal.versao} + 1` })
          .where(eq(funilMensal.id, card.id))
        await registrarAuditoria({
          tabela: 'funil_mensal',
          registroId: card.id,
          acao: 'mudar_etapa',
          campo: 'etapa',
          valorAnterior: 'fechado',
          valorNovo: `${mud.anterior} (conferência SAP: venda excluída)`,
          alteradoPor: usuarioId,
        })
        cardVoltouPara = mud.anterior
      }
    }
  }
  cache.clear()
  return { cardVoltouPara }
}
