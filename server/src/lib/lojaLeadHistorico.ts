import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leadTrackingVisitors, lojaEventos } from '../db/schema.js'
import { itensDe, lerMetadata, pedidoDe, rotuloEventoLoja, type ItemLoja, type PedidoLoja } from './lojaResumo.js'

// Tudo o que um lead fez na loja virtual, pra ficha do lead (pedido do
// João, 2026-11-10): de onde veio, quanto tempo ficou, o que viu, o que
// buscou, o carrinho (com o link que devolve o carrinho pronto) e os
// pedidos com produtos, frete, pagamento e cidade. Junta todos os
// visitantes (navegadores) ligados ao lead, inclusive o que ele fez antes
// de se identificar.

const MAX_EVENTOS = 1500
const ms = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`)

function dominio(ref: string | null): string | null {
  if (!ref) return null
  try {
    return new URL(ref).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function origem(e: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrer: string | null }, dominioLoja: string | null): string {
  if (e.utmSource) return [e.utmSource, e.utmMedium, e.utmCampaign].filter(Boolean).join(' / ')
  const d = dominio(e.referrer)
  if (!d || d === dominioLoja) return 'Direto (digitou o endereço ou favorito)'
  if (/google\./.test(d)) return 'Google (busca orgânica)'
  if (/facebook|instagram|fb\./.test(d)) return 'Facebook / Instagram'
  if (/mercadolivre|mercadolibre/.test(d)) return 'Mercado Livre'
  return d
}

export interface EventoLojaLead {
  quando: string
  tipo: string
  rotulo: string
  pagina: string | null
  titulo: string | null
  produto: string | null
  sku: string | null
  valor: number | null
  tempoMs: number | null
  detalhe: string | null
}

export async function historicoLojaDoLead(empresaId: number, leadId: number) {
  const visitantes = await db.query.leadTrackingVisitors.findMany({
    where: and(eq(leadTrackingVisitors.empresaId, empresaId), eq(leadTrackingVisitors.leadId, leadId)),
    columns: { id: true },
  })
  if (!visitantes.length) return null
  const eventos = (
    await db
      .select()
      .from(lojaEventos)
      .where(and(eq(lojaEventos.empresaId, empresaId), inArray(lojaEventos.visitorId, visitantes.map((v) => v.id))))
      .orderBy(desc(lojaEventos.ocorreuEm))
      .limit(MAX_EVENTOS)
  ).reverse()
  if (!eventos.length) return null

  const dominioLoja = dominio(eventos.find((e) => e.pageUrl)?.pageUrl ?? null)
  const metas = new Map(eventos.map((e) => [e.id, lerMetadata(e.metadata)]))

  // Sessões (sem session_id: visitante + dia)
  const porSessao = new Map<string, typeof eventos>()
  for (const e of eventos) {
    const k = e.sessionId ?? `${e.visitorUid}:${e.ocorreuEm.slice(0, 10)}`
    porSessao.set(k, [...(porSessao.get(k) ?? []), e])
  }
  const sessoes = [...porSessao.values()].map((lista) => {
    const inicio = lista[0].ocorreuEm
    const fim = lista[lista.length - 1].ocorreuEm
    return {
      inicio,
      fim,
      duracaoMs: Math.max(0, ms(fim) - ms(inicio)),
      origem: origem(lista[0], dominioLoja),
      paginas: lista.filter((e) => e.eventType === 'page_view').length,
      eventos: lista
        // "Saiu da página" vira o tempo da página; não precisa de linha própria.
        .filter((e) => e.eventType !== 'page_leave')
        .map<EventoLojaLead>((e) => {
          const meta = metas.get(e.id) ?? {}
          const saida = e.eventType === 'page_view' ? lista.find((x) => x.eventType === 'page_leave' && x.pagePath === e.pagePath && x.ocorreuEm >= e.ocorreuEm) : null
          let detalhe: string | null = null
          if (e.eventType === 'search') detalhe = typeof meta.search_term === 'string' ? `"${meta.search_term}"` : null
          if (e.eventType === 'click') detalhe = e.elemento
          if (e.eventType === 'cart_abandoned' && typeof meta.reason === 'string') detalhe = `Motivo: ${meta.reason}`
          const pedido = pedidoDe(meta)
          if (pedido?.numero) detalhe = `Pedido ${pedido.numero}${pedido.pagamento ? ` · ${pedido.pagamento}` : ''}${detalhe ? ` · ${detalhe}` : ''}`
          const itens = itensDe(meta)
          if (!pedido && itens.length && ['add_to_cart', 'remove_from_cart', 'cart_abandoned'].includes(e.eventType))
            detalhe = [detalhe, itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ')].filter(Boolean).join(' · ')
          return {
            quando: e.ocorreuEm,
            tipo: (meta.store_event as string) || e.eventType,
            rotulo: rotuloEventoLoja(e.eventType, meta),
            pagina: e.pagePath,
            titulo: e.pageTitle,
            produto: e.produtoNome ?? (itens.length === 1 ? itens[0].nome : null),
            sku: e.produtoSku,
            valor: pedido?.total ?? e.valor,
            tempoMs: saida ? (saida.engajadoMs ?? saida.duracaoMs) : null,
            detalhe,
          }
        }),
    }
  })

  // Produtos vistos / colocados no carrinho
  const produtos = new Map<string, { sku: string | null; nome: string; vistas: number; noCarrinho: boolean; comprou: boolean; tempoMs: number; ultimaVez: string }>()
  const marcar = (sku: string | null, nome: string, quando: string, f: (p: NonNullable<ReturnType<typeof produtos.get>>) => void) => {
    // Carrinho/pedido usam o SKU da variação ("C5055-DEFAULT"); a página, o do produto ("C5055").
    const base = sku?.replace(/-DEFAULT$/i, '') ?? null
    const k = base ?? nome.toLowerCase()
    const p = produtos.get(k) ?? { sku: base, nome, vistas: 0, noCarrinho: false, comprou: false, tempoMs: 0, ultimaVez: quando }
    p.ultimaVez = quando > p.ultimaVez ? quando : p.ultimaVez
    f(p)
    produtos.set(k, p)
  }
  for (const e of eventos) {
    const meta = metas.get(e.id) ?? {}
    if (e.eventType === 'product_view' && (e.produtoSku || e.produtoNome)) marcar(e.produtoSku, e.produtoNome ?? e.produtoSku!, e.ocorreuEm, (p) => p.vistas++)
    if (e.eventType === 'page_leave' && e.produtoSku) marcar(e.produtoSku, e.produtoNome ?? e.produtoSku, e.ocorreuEm, (p) => (p.tempoMs += e.engajadoMs ?? 0))
    if (e.eventType === 'add_to_cart') for (const i of itensDe(meta).length ? itensDe(meta) : e.produtoSku ? [{ sku: e.produtoSku, nome: e.produtoNome ?? e.produtoSku, quantidade: 1, preco: null }] : []) marcar(i.sku, i.nome, e.ocorreuEm, (p) => (p.noCarrinho = true))
    if (e.eventType === 'purchase') for (const i of itensDe(meta)) marcar(i.sku, i.nome, e.ocorreuEm, (p) => (p.comprou = true))
  }

  // Pedidos: o mesmo número passa por checkout → compra (ou pagamento não concluído).
  const pedidos = new Map<string, PedidoLoja & { situacao: string; quando: string }>()
  for (const e of eventos) {
    const meta = metas.get(e.id) ?? {}
    const p = pedidoDe(meta)
    if (!p?.numero) continue
    const situacao = e.eventType === 'purchase' ? 'Pago' : meta.store_event === 'payment_failed' ? 'Pagamento não concluído' : 'Aguardando pagamento'
    const atual = pedidos.get(p.numero)
    if (!atual || situacao === 'Pago' || atual.situacao === 'Aguardando pagamento') pedidos.set(p.numero, { ...p, situacao, quando: atual?.quando ?? e.ocorreuEm })
  }

  // Último carrinho abandonado (com o link mágico) — se não comprou depois.
  const ultimoAbandono = [...eventos].reverse().find((e) => e.eventType === 'cart_abandoned' && (metas.get(e.id) ?? {}).store_event !== 'payment_failed')
  const comprouDepois = ultimoAbandono ? eventos.some((e) => e.eventType === 'purchase' && e.ocorreuEm > ultimoAbandono.ocorreuEm) : false
  const metaAbandono = ultimoAbandono ? (metas.get(ultimoAbandono.id) ?? {}) : {}
  const carrinho: { quando: string; itens: ItemLoja[]; valor: number | null; link: string | null; comprouDepois: boolean } | null = ultimoAbandono
    ? {
        quando: ultimoAbandono.ocorreuEm,
        itens: itensDe(metaAbandono),
        valor: ultimoAbandono.valor,
        link: typeof metaAbandono.recovery_url === 'string' ? metaAbandono.recovery_url : null,
        comprouDepois,
      }
    : null

  const buscas = [...new Set(eventos.filter((e) => e.eventType === 'search').map((e) => (metas.get(e.id) ?? {}).search_term).filter((t): t is string => typeof t === 'string' && t.trim().length > 1))]
  // Busca é enviada enquanto digita ("comp", "compre", "compressor"): fica só a mais completa.
  const buscasLimpas = buscas.filter((t) => !buscas.some((o) => o !== t && o.toLowerCase().startsWith(t.toLowerCase())))
  const listaPedidos = [...pedidos.values()].sort((a, b) => b.quando.localeCompare(a.quando))

  return {
    resumo: {
      primeiraVisita: eventos[0].ocorreuEm,
      ultimaVisita: eventos[eventos.length - 1].ocorreuEm,
      sessoes: sessoes.length,
      paginas: eventos.filter((e) => e.eventType === 'page_view').length,
      tempoTotalMs: eventos.filter((e) => e.eventType === 'page_leave').reduce((s, e) => s + (e.engajadoMs ?? 0), 0),
      origemPrimeira: sessoes[0].origem,
      campanhas: [...new Set(eventos.map((e) => e.utmCampaign).filter((x): x is string => !!x))],
      cliquesWhatsapp: eventos.filter((e) => (metas.get(e.id) ?? {}).store_event === 'whatsapp_click').length,
      totalComprado: listaPedidos.filter((p) => p.situacao === 'Pago').reduce((s, p) => s + (p.total ?? 0), 0),
    },
    carrinho,
    pedidos: listaPedidos,
    produtos: [...produtos.values()].sort((a, b) => Number(b.comprou) - Number(a.comprou) || Number(b.noCarrinho) - Number(a.noCarrinho) || b.vistas - a.vistas).slice(0, 30),
    buscas: buscasLimpas.slice(0, 20),
    sessoes: sessoes.reverse().slice(0, 30),
  }
}

export type HistoricoLojaLead = NonNullable<Awaited<ReturnType<typeof historicoLojaDoLead>>>
