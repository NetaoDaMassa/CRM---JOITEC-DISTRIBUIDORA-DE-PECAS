import { and, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { expedicaoPausas, expedicaoPedidos } from '../db/schema.js'

// Relatório da expedição: vendedores que mais voltam picking ou têm pedido
// travado por falta de item ou troca (pedido do João, 2026-11-05).
//   - Voltou picking: o SAP gerou picking novo pro mesmo pedido e o antigo foi
//     descartado ou fechado sem nota nem coleta. Não conta: recriar o card do
//     MESMO picking (descarte no CRM) nem segundo picking de entrega parcial
//     (o anterior segue aberto, ou já tem nota/coleta).
//   - Travado: pausa com tipo falta_item/troca_item. O mesmo pedido pausado
//     duas vezes pelo mesmo tipo conta uma vez.

export const TIPOS_PAUSA = ['falta_item', 'troca_item', 'outro'] as const
export type TipoPausa = (typeof TIPOS_PAUSA)[number]
export const ROTULO_PAUSA: Record<TipoPausa, string> = { falta_item: 'Falta de item', troca_item: 'Troca de item', outro: 'Outro motivo' }

export function resumoMudancaPicking(json: string | null): string {
  if (!json) return 'itens não comparados'
  try {
    const m = JSON.parse(json) as { novos?: number; alterados?: number; removidos?: unknown[] }
    const novos = m.novos ?? 0
    const alterados = m.alterados ?? 0
    const removidos = m.removidos?.length ?? 0
    const partes = [novos && `${novos} item(ns) novo(s)`, removidos && `${removidos} retirado(s)`, alterados && `${alterados} com quantidade alterada`].filter(Boolean)
    if (!partes.length) return 'sem mudança nos itens'
    return `${novos && removidos ? 'itens trocados: ' : ''}${partes.join(', ')}`
  } catch {
    return 'itens não comparados'
  }
}

export interface Ocorrencia {
  tipo: 'picking' | 'falta_item' | 'troca_item'
  expedicaoId: number
  pedido: string
  cliente: string | null
  data: string
  detalhe: string
}

export async function vendedoresComProblemas(empresaId: number, de: string, ate: string) {
  const deUtc = new Date(`${de}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
  const ateUtc = new Date(`${ate}T23:59:59-03:00`).toISOString().replace('T', ' ').slice(0, 19)

  const cards = await db
    .select({
      id: expedicaoPedidos.id,
      pedidosSap: expedicaoPedidos.pedidosSap,
      clienteNome: expedicaoPedidos.clienteNome,
      vendedorSap: expedicaoPedidos.vendedorSap,
      pickListSap: expedicaoPedidos.pickListSap,
      substituiId: expedicaoPedidos.substituiId,
      mudancasSap: expedicaoPedidos.mudancasSap,
      createdAt: expedicaoPedidos.createdAt,
      dataPicking: expedicaoPedidos.dataPicking,
      etapa: expedicaoPedidos.etapa,
    })
    .from(expedicaoPedidos)
    .where(
      and(
        eq(expedicaoPedidos.empresaId, empresaId),
        eq(expedicaoPedidos.historico, false),
        or(and(gte(expedicaoPedidos.dataPicking, de), lte(expedicaoPedidos.dataPicking, ate)), and(gte(expedicaoPedidos.createdAt, deUtc), lte(expedicaoPedidos.createdAt, ateUtc)))
      )
    )

  const idsAnteriores = [...new Set(cards.map((c) => c.substituiId).filter((x): x is number => x != null))]
  const anteriores = idsAnteriores.length
    ? await db
        .select({ id: expedicaoPedidos.id, pickListSap: expedicaoPedidos.pickListSap, etapa: expedicaoPedidos.etapa, statusPickingSap: expedicaoPedidos.statusPickingSap, nfNumero: expedicaoPedidos.nfNumero })
        .from(expedicaoPedidos)
        .where(inArray(expedicaoPedidos.id, idsAnteriores))
    : []
  const cardAnterior = new Map(anteriores.map((a) => [a.id, a]))

  const pausas = await db
    .select({
      tipo: expedicaoPausas.tipo,
      motivo: expedicaoPausas.motivo,
      pausadoEm: expedicaoPausas.pausadoEm,
      expedicaoId: expedicaoPausas.expedicaoId,
      pedidosSap: expedicaoPedidos.pedidosSap,
      clienteNome: expedicaoPedidos.clienteNome,
      vendedorSap: expedicaoPedidos.vendedorSap,
    })
    .from(expedicaoPausas)
    .innerJoin(expedicaoPedidos, eq(expedicaoPedidos.id, expedicaoPausas.expedicaoId))
    .where(
      and(
        eq(expedicaoPedidos.empresaId, empresaId),
        inArray(expedicaoPausas.tipo, ['falta_item', 'troca_item']),
        gte(expedicaoPausas.pausadoEm, deUtc),
        lte(expedicaoPausas.pausadoEm, ateUtc)
      )
    )

  const porVendedor = new Map<string, { pedidos: Set<string>; afetados: Set<string>; ocorrencias: Ocorrencia[]; jaContadas: Set<string> }>()
  const doVendedor = (nome: string | null) => {
    const chave = nome?.trim() || 'Sem vendedor'
    let v = porVendedor.get(chave)
    if (!v) porVendedor.set(chave, (v = { pedidos: new Set(), afetados: new Set(), ocorrencias: [], jaContadas: new Set() }))
    return v
  }

  for (const c of cards) {
    const v = doVendedor(c.vendedorSap)
    if (c.etapa !== 'cancelado' && c.dataPicking >= de && c.dataPicking <= ate) v.pedidos.add(c.pedidosSap)
    if (c.substituiId == null || c.createdAt < deUtc || c.createdAt > ateUtc) continue
    const anterior = cardAnterior.get(c.substituiId)
    if (!anterior || anterior.pickListSap === c.pickListSap) continue
    if (anterior.etapa === 'coletado' || anterior.nfNumero || (anterior.etapa !== 'descartado' && anterior.statusPickingSap !== 'ps_Closed')) continue
    v.pedidos.add(c.pedidosSap)
    v.afetados.add(c.pedidosSap)
    v.ocorrencias.push({
      tipo: 'picking',
      expedicaoId: c.id,
      pedido: c.pedidosSap,
      cliente: c.clienteNome,
      data: c.createdAt,
      detalhe: `picking ${anterior.pickListSap} → ${c.pickListSap} · ${resumoMudancaPicking(c.mudancasSap)}`,
    })
  }
  for (const p of pausas) {
    const v = doVendedor(p.vendedorSap)
    const chave = `${p.pedidosSap}|${p.tipo}`
    if (v.jaContadas.has(chave)) continue
    v.jaContadas.add(chave)
    v.pedidos.add(p.pedidosSap)
    v.afetados.add(p.pedidosSap)
    v.ocorrencias.push({ tipo: p.tipo as 'falta_item' | 'troca_item', expedicaoId: p.expedicaoId, pedido: p.pedidosSap, cliente: p.clienteNome, data: p.pausadoEm, detalhe: p.motivo ?? ROTULO_PAUSA[p.tipo as TipoPausa] })
  }

  const conta = (o: Ocorrencia[], t: Ocorrencia['tipo']) => o.filter((x) => x.tipo === t).length
  const linhas = [...porVendedor.entries()]
    .map(([vendedor, v]) => ({
      vendedor,
      pedidos: v.pedidos.size,
      voltouPicking: conta(v.ocorrencias, 'picking'),
      faltaItem: conta(v.ocorrencias, 'falta_item'),
      trocaItem: conta(v.ocorrencias, 'troca_item'),
      total: v.ocorrencias.length,
      pedidosAfetados: v.afetados.size,
      ocorrencias: v.ocorrencias.sort((a, b) => b.data.localeCompare(a.data)),
    }))
    .sort((a, b) => b.total - a.total || b.pedidos - a.pedidos || a.vendedor.localeCompare(b.vendedor, 'pt-BR'))

  return {
    linhas,
    voltouPicking: linhas.reduce((s, l) => s + l.voltouPicking, 0),
    faltaItem: linhas.reduce((s, l) => s + l.faltaItem, 0),
    trocaItem: linhas.reduce((s, l) => s + l.trocaItem, 0),
  }
}
