import { and, inArray, isNull, notInArray, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { expedicaoPedidos, sapGarantias, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from './dataBr.js'
import { comSessaoSap, dataSap } from './sapServiceLayer.js'

// NF rápida (pedido do João, 2026-11-16: "quero puxar a NF mais rápida do SAP
// para o CRM"). O número da NF-e é o que faz aparecer os botões DANFE/XML no
// card do cliente, na ficha e na Expedição (o arquivo em si o CRM busca no
// SAP na hora do clique — lib/sapDanfe.ts). Antes o número só chegava pelas
// rodadas grandes (vendas de 10 em 10 min lendo 7 dias de notas com itens,
// ~45 s; expedição de 5 em 5 min). Aqui: de minuto em minuto, só as notas de
// ontem e hoje (~1 s), e só preenche quem ainda está sem NF — as rodadas
// grandes continuam como rede de segurança (nota de dias atrás etc.).

function brParaUtc(data: string, hora: string | null): string {
  const d = new Date(`${data}T${(hora ?? '08:00:00').slice(0, 8)}-03:00`)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

function ontemBr(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export interface NfRapidaResultado {
  notas: number
  vendas: number
  expedicao: number
  garantias: number
}

// `desde` (YYYY-MM-DD): só pra teste/carga avulsa — o normal é ontem.
export async function sincronizarNfRapida(desde?: string): Promise<NfRapidaResultado> {
  const r: NfRapidaResultado = { notas: 0, vendas: 0, expedicao: 0, garantias: 0 }
  const hoje = hojeBrString()
  const notas = await comSessaoSap((sap) =>
    sap.getTodos<{
      SequenceSerial: number | null
      DocNum: number
      DocDate: string
      DocTime: string | null
      CancelStatus: string
      DocumentLines: { BaseType: number; BaseEntry: number | null }[]
    }>(`/Invoices?$filter=DocDate ge '${desde ?? ontemBr(hoje)}' and Cancelled eq 'tNO'&$select=SequenceSerial,DocNum,DocDate,DocTime,CancelStatus,DocumentLines`, 100)
  )
  r.notas = notas.length
  // Mesmo critério das rodadas grandes: nota de venda baseada no pedido
  // (BaseType 17 = pedido de venda), número = SequenceSerial (nº da NF-e).
  const nfPorPedido = new Map<number, { numero: string; emissao: string }>()
  for (const n of notas) {
    if (n.CancelStatus === 'csCancellation') continue
    for (const l of n.DocumentLines) {
      if (l.BaseType === 17 && l.BaseEntry != null && !nfPorPedido.has(l.BaseEntry)) {
        nfPorPedido.set(l.BaseEntry, { numero: String(n.SequenceSerial || n.DocNum), emissao: brParaUtc(dataSap(n.DocDate), n.DocTime) })
      }
    }
  }
  if (!nfPorPedido.size) return r
  const entries = [...nfPorPedido.keys()]

  // Venda do card do cliente (vem do pedido do SAP — lib/sapVendasAuto.ts).
  const vendasSemNf = await db
    .select({ id: vendas.id, entry: vendas.pedidoSapEntry })
    .from(vendas)
    .where(and(inArray(vendas.pedidoSapEntry, entries), isNull(vendas.numeroNotaFiscal), isNull(vendas.deletedAt)))
  for (const v of vendasSemNf) {
    await db
      .update(vendas)
      .set({ numeroNotaFiscal: nfPorPedido.get(v.entry!)!.numero, tipoComprovante: 'nota_fiscal', faturado: true })
      .where(and(eq(vendas.id, v.id), isNull(vendas.numeroNotaFiscal)))
    r.vendas++
  }

  // Garantia (pedido de garantia do SAP).
  const garantias = await db
    .select({ id: sapGarantias.id, entry: sapGarantias.pedidoSapEntry })
    .from(sapGarantias)
    .where(and(inArray(sapGarantias.pedidoSapEntry, entries), isNull(sapGarantias.nfNumero)))
  for (const g of garantias) {
    await db.update(sapGarantias).set({ nfNumero: nfPorPedido.get(g.entry)!.numero }).where(and(eq(sapGarantias.id, g.id), isNull(sapGarantias.nfNumero)))
    r.garantias++
  }

  // Card da Expedição (pode juntar mais de um pedido: order_entries_sap "a,b").
  const expSemNf = await db
    .select({ id: expedicaoPedidos.id, orderEntriesSap: expedicaoPedidos.orderEntriesSap })
    .from(expedicaoPedidos)
    .where(and(isNull(expedicaoPedidos.nfNumero), eq(expedicaoPedidos.historico, false), notInArray(expedicaoPedidos.etapa, ['cancelado', 'descartado'])))
  for (const p of expSemNf) {
    const nf = p.orderEntriesSap
      .split(',')
      .map((e) => nfPorPedido.get(Number(e)))
      .find(Boolean)
    if (!nf) continue
    await db
      .update(expedicaoPedidos)
      .set({ nfNumero: nf.numero, nfEmissao: nf.emissao, updatedAt: agoraSqlite() })
      .where(and(eq(expedicaoPedidos.id, p.id), isNull(expedicaoPedidos.nfNumero)))
    r.expedicao++
  }
  return r
}
