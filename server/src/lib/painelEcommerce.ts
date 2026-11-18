// Painel E-commerce (João, 2026-11-13/18): metas das vendedoras do
// e-commerce (Amanda, Camila, Letícia) + meta geral, tudo puxado sozinho da
// Aton pela conta de marketplace de cada pedido (`origem_nome`). Nada é
// lançado à mão — a gestora só diz de quem é cada conta e as metas do mês.
//
// Valor = total_pedido (bruto, igual à NF). O "Vlr. Recebido" (líquido, tela
// Conciliação de Pedidos do Aton) não existe na API — pedido ao Guilherme da
// Aton em 2026-11-16; quando liberarem, trocar aqui.
import { getConfigTexto, setConfig } from './configuracoes.js'
import { buscarPedidosDaPosicao, paraFormatoBr, POSICOES_VENDA_VALIDA, STATUS_VENDA_VALIDA, type AtonPedido } from './atonErp.js'

export const CHAVE_CONFIG = 'painel_ecommerce_config'
const CHAVE_TOKEN = 'aton_token_compretec-ecommerce'

export type VendedoraEcommerce = { id: string; nome: string; metas: [number, number, number]; fotoPath: string | null }
// dona de cada conta: id da vendedora · '' = só soma no total geral · 'fora' = não entra
// descontos: % por conta pra estimar o "Vlr. Recebido" (comissão/frete/taxa
// do marketplace) enquanto a Aton não manda o valor real; base decide o que
// conta nas metas — 'bruto' (total_pedido) ou 'liquido' (bruto − desconto).
export type ConfigEcommerce = {
  metaGeral: number
  vendedoras: VendedoraEcommerce[]
  contas: Record<string, string>
  descontos: Record<string, number>
  base: 'bruto' | 'liquido'
}

// Começa com o que o João passou em 2026-11-13.
const PADRAO: ConfigEcommerce = {
  metaGeral: 700000,
  vendedoras: [
    { id: 'amanda', nome: 'Amanda', metas: [250000, 300000, 350000], fotoPath: null },
    { id: 'camila', nome: 'Camila', metas: [40000, 45000, 50000], fotoPath: null },
    { id: 'leticia', nome: 'Letícia', metas: [150000, 200000, 230000], fotoPath: null },
  ],
  contas: {
    'ML COMPREFER': 'amanda',
    'SHOPEE COMPREFER': 'amanda',
    'SHOPEE JT': 'amanda',
    'ML COMPRETEC': 'camila',
    'SHOPEE COMPRETEC': 'camila',
    'MAGALU HIDROPLAC': 'camila',
    'ML HIDROPLAC': 'leticia',
    'SHOPEE HIDROPLAC': 'leticia',
    'TIK TOK COMPRETEC': 'leticia',
    'ML JT': '',
    'VENDA MANUAL': 'fora',
    'SITE COMPRETEC': 'fora',
  },
  descontos: {},
  base: 'bruto',
}

export async function lerConfigEcommerce(): Promise<ConfigEcommerce> {
  const txt = await getConfigTexto(CHAVE_CONFIG)
  if (!txt) return structuredClone(PADRAO)
  try {
    const c = JSON.parse(txt) as Partial<ConfigEcommerce>
    return {
      metaGeral: c.metaGeral ?? PADRAO.metaGeral,
      vendedoras: c.vendedoras ?? PADRAO.vendedoras,
      contas: c.contas ?? PADRAO.contas,
      descontos: c.descontos ?? {},
      base: c.base === 'liquido' ? 'liquido' : 'bruto',
    }
  } catch {
    return structuredClone(PADRAO)
  }
}
export async function salvarConfigEcommerce(c: ConfigEcommerce) {
  await setConfig(CHAVE_CONFIG, JSON.stringify(c))
}

// ---------- pedidos do mês (Aton) ----------
export type PedidoEcommerce = { pedido: number; conta: string; valor: number; situacao: 'venda' | 'cancelado' | 'aguardando'; dia: string; hora: number | null }

function situacao(p: AtonPedido): PedidoEcommerce['situacao'] | null {
  if (p.status === STATUS_VENDA_VALIDA) return 'venda'
  if (/CANCELAD/i.test(p.status)) return 'cancelado'
  if (/AGUARDANDO/i.test(p.status)) return 'aguardando'
  return null
}

async function buscarMes(token: string, deIso: string, ateIso: string): Promise<PedidoEcommerce[]> {
  const de = paraFormatoBr(deIso)
  const ate = paraFormatoBr(ateIso)
  const listas = await Promise.all(POSICOES_VENDA_VALIDA.map((pos) => buscarPedidosDaPosicao(token, de, ate, pos)))
  const vistos = new Set<number>()
  const out: PedidoEcommerce[] = []
  for (const lista of listas)
    for (const p of lista) {
      if (vistos.has(p.pedido)) continue
      vistos.add(p.pedido)
      const s = situacao(p)
      if (!s) continue
      // data_pedido = "dd/mm/aaaa hh:mm:ss" (marketplace) ou "dd/mm/aaaa"
      const [d, h] = String(p.data_pedido ?? '').split(' ')
      const [dd, mm, aa] = d.split('/')
      out.push({
        pedido: p.pedido,
        conta: (p.origem_nome ?? '').trim().toUpperCase() || 'SEM CONTA',
        valor: Number(p.total_pedido) || 0,
        situacao: s,
        dia: aa && mm && dd ? `${aa}-${mm}-${dd}` : deIso,
        hora: h ? Number(h.slice(0, 2)) : null,
      })
    }
  return out
}

// Cache: a Aton leva ~30-50s pra devolver o mês todo (3.000+ pedidos, 70 páginas).
// TV pergunta a cada 60s — serve a última leitura e atualiza por trás quando
// passou de 3 min (nunca deixa a TV esperando nem zera se a Aton cair).
const TTL_MS = 3 * 60 * 1000
const cache = new Map<string, { em: number; dados: PedidoEcommerce[] }>()
const emAndamento = new Map<string, Promise<PedidoEcommerce[]>>()

function atualizar(token: string, deIso: string, ateIso: string, chave: string) {
  let p = emAndamento.get(chave)
  if (!p) {
    p = buscarMes(token, deIso, ateIso)
      .then((dados) => (cache.set(chave, { em: Date.now(), dados }), dados))
      .finally(() => emAndamento.delete(chave))
    emAndamento.set(chave, p)
  }
  return p
}

export async function pedidosDoMes(deIso: string, ateIso: string): Promise<{ pedidos: PedidoEcommerce[]; lidoEm: number } | null> {
  const token = await getConfigTexto(CHAVE_TOKEN)
  if (!token) return null
  const chave = `${deIso}:${ateIso}`
  for (const k of cache.keys()) if (!k.startsWith(deIso)) cache.delete(k) // virou o mês
  // Virou o dia: a leitura de ontem (mesmo mês) serve até a nova chegar.
  const c = cache.get(chave) ?? [...cache.entries()].filter(([k]) => k.startsWith(deIso)).sort((x, y) => y[1].em - x[1].em)[0]?.[1]
  if (c) {
    if (!cache.has(chave) || Date.now() - c.em > TTL_MS) atualizar(token, deIso, ateIso, chave).catch((e) => console.error('[painelEcommerce] Aton:', e))
    return { pedidos: c.dados, lidoEm: c.em }
  }
  // Sem leitura nenhuma ainda (servidor acabou de subir).
  const dados = await atualizar(token, deIso, ateIso, chave)
  return { pedidos: dados, lidoEm: cache.get(chave)?.em ?? Date.now() }
}
