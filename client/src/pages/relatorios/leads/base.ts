import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { usePersistedState } from '../../../lib/usePersistedState'
import { datasDoPreset, periodoAnterior } from '../../../components/relatorios/filtros'
import type { Preset } from '../../../components/relatorios/filtros'

// Base do Relatório de Leads novo (pedido do João, 2026-10-20). O servidor
// manda uma linha por lead (leadsRelatorios.painel) e TODA conta é feita
// aqui, pra os filtros (canal, campanha, vendedor, estado, segmento, etapa)
// valerem na hora em todas as abas.

export type LinhaLead = inferRouterOutputs<AppRouter>['leadsRelatorios']['painel'][number]
export type Canal = LinhaLead['canal']

export const CANAIS: Record<Canal, { rotulo: string; cor: string; ajuda: string }> = {
  meta_ads: { rotulo: 'Meta Ads', cor: '#3b82f6', ajuda: 'Formulário de anúncio do Facebook/Instagram, ou visita ao site vinda de anúncio pago da Meta.' },
  google_ads: { rotulo: 'Google Ads', cor: '#22a861', ajuda: 'Formulário do site preenchido por quem chegou de um anúncio do Google.' },
  site: { rotulo: 'Site (orgânico)', cor: '#0ea5a4', ajuda: 'Formulário, e-book ou blog do site, sem anúncio pago na visita.' },
  instagram: { rotulo: 'Instagram', cor: '#ec4899', ajuda: 'Comentário/direct no Instagram ou link do perfil (sem anúncio pago).' },
  whatsapp: { rotulo: 'WhatsApp', cor: '#84cc16', ajuda: 'Lead que chamou no WhatsApp (origem digitada como WhatsApp).' },
  email: { rotulo: 'E-mail marketing', cor: '#f2a516', ajuda: 'Clique ou resposta em campanha de e-mail (Brevo).' },
  loja_online: { rotulo: 'Loja online', cor: '#8b5cf6', ajuda: 'Carrinho abandonado ou cadastro na loja online.' },
  indicacao: { rotulo: 'Indicação', cor: '#f97316', ajuda: 'Origem digitada como indicação.' },
  grupo: { rotulo: 'Outra empresa do grupo', cor: '#64748b', ajuda: 'Lead repassado de outra empresa do Grupo.' },
  outros: { rotulo: 'Outros', cor: '#94a3b8', ajuda: 'Origem digitada com um texto que não se encaixa nos outros canais.' },
  manual: { rotulo: 'Sem origem', cor: '#cbd5e1', ajuda: 'Lead cadastrado à mão sem preencher a origem — não dá pra saber de onde veio.' },
}

export const ETAPAS: Record<string, { rotulo: string; cor: string }> = {
  novo: { rotulo: 'Novo', cor: '#3b82f6' },
  novo_consumidor_final: { rotulo: 'Novo (Consumidor Final)', cor: '#60a5fa' },
  abordagem: { rotulo: 'Abordagem', cor: '#eab308' },
  qualificado: { rotulo: 'Qualificado', cor: '#a855f7' },
  em_negociacao: { rotulo: 'Em Negociação', cor: '#f97316' },
  ganho: { rotulo: 'Ganho', cor: '#22a861' },
  perdido: { rotulo: 'Perdido', cor: '#e5534b' },
  desqualificado: { rotulo: 'Desqualificado', cor: '#71717a' },
  consumidor_final: { rotulo: 'Consumidor Final / Repassado', cor: '#0d9de0' },
}

export const SEGMENTOS: Record<string, string> = {
  assistente_tecnico: 'Assistente técnico',
  instalador: 'Instalador',
  revendedor_lojista: 'Revendedor / Lojista',
  outros: 'Outros / não informado',
}

export const REGIOES_BR: Record<string, string> = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  centro_oeste: 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
}

export const ABERTOS = new Set(['novo', 'novo_consumidor_final', 'abordagem', 'qualificado', 'em_negociacao'])

// ── Filtros ─────────────────────────────────────────────────────────────
export type FiltrosLeads = ReturnType<typeof useFiltrosLeads>

export function useFiltrosLeads() {
  const [preset, setPresetState] = usePersistedState<Preset>('relLeads:preset', 'mes')
  const padrao = datasDoPreset('mes')!
  const [inicioCustom, setInicio] = usePersistedState('relLeads:inicio', padrao.inicio)
  const [fimCustom, setFim] = usePersistedState('relLeads:fim', padrao.fim)
  const [canal, setCanal] = usePersistedState<string>('relLeads:canal', '')
  const [campanha, setCampanha] = usePersistedState<string>('relLeads:campanha', '')
  const [vendedor, setVendedor] = usePersistedState<string>('relLeads:vendedor', '')
  const [regiao, setRegiao] = usePersistedState<string>('relLeads:regiao', '')
  const [uf, setUf] = usePersistedState<string>('relLeads:uf', '')
  const [segmento, setSegmento] = usePersistedState<string>('relLeads:segmento', '')
  const [etapa, setEtapa] = usePersistedState<string>('relLeads:etapa', '')

  const datas = datasDoPreset(preset) ?? { inicio: inicioCustom, fim: fimCustom }
  const anterior = periodoAnterior(datas.inicio, datas.fim)

  const ativos = [canal, campanha, vendedor, regiao, uf, segmento, etapa].filter(Boolean).length

  return {
    preset,
    setPreset(p: Preset) {
      if (p === 'custom') {
        setInicio(datas.inicio)
        setFim(datas.fim)
      }
      setPresetState(p)
    },
    inicio: datas.inicio,
    fim: datas.fim,
    setInicio(v: string) {
      setPresetState('custom')
      setInicio(v)
    },
    setFim(v: string) {
      setPresetState('custom')
      setFim(v)
    },
    anterior,
    canal,
    setCanal,
    campanha,
    setCampanha,
    vendedor,
    setVendedor,
    regiao,
    setRegiao,
    uf,
    setUf,
    segmento,
    setSegmento,
    etapa,
    setEtapa,
    ativos,
    limpar() {
      setCanal('')
      setCampanha('')
      setVendedor('')
      setRegiao('')
      setUf('')
      setSegmento('')
      setEtapa('')
    },
  }
}

// Filtros que não são de data — valem igual pro período e pro anterior.
export function passaFiltros(l: LinhaLead, f: FiltrosLeads) {
  if (f.canal && l.canal !== f.canal) return false
  if (f.campanha && (l.campanha ?? '(sem campanha)') !== f.campanha) return false
  if (f.vendedor && String(l.vendedorId ?? 0) !== f.vendedor) return false
  if (f.regiao && l.regiaoBr !== f.regiao) return false
  if (f.uf && l.uf !== f.uf) return false
  if (f.segmento && l.segmento !== f.segmento) return false
  if (f.etapa && l.status !== f.etapa) return false
  return true
}

const entre = (d: string | null, ini: string, fim: string) => !!d && d >= ini && d <= fim

// ── Métricas ────────────────────────────────────────────────────────────
// "Safra" = leads que ENTRARAM no período. Conversão, atendimento e funil
// olham a safra (o que aconteceu com quem chegou). Vendas fechadas olham a
// data do fechamento (um lead de setembro ganho em outubro conta em outubro),
// igual ao resto do CRM.
export function calcular(linhas: LinhaLead[], ini: string, fim: string) {
  const safra = linhas.filter((l) => entre(l.dataEntrada, ini, fim))
  const vendas = linhas.filter((l) => l.status === 'ganho' && entre(l.dataFechamento, ini, fim))
  const perdasPeriodo = linhas.filter((l) => (l.status === 'perdido' || l.status === 'desqualificado' || l.status === 'consumidor_final') && entre(l.dataFechamento, ini, fim))

  const atendidos = safra.filter((l) => l.contatado)
  const tempos = safra.map((l) => l.primeiroContatoHoras).filter((h): h is number => h !== null)
  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
  const ganhosSafra = safra.filter((l) => l.status === 'ganho')
  const valorVendas = vendas.reduce((s, l) => s + (l.valorFinal ?? 0), 0)
  const comValor = vendas.filter((l) => (l.valorFinal ?? 0) > 0)
  const negociando = safra.filter((l) => l.status === 'em_negociacao')
  const perdidosSafra = safra.filter((l) => l.status === 'perdido' || l.status === 'desqualificado')

  return {
    safra,
    vendas,
    perdasPeriodo,
    recebidos: safra.length,
    atendidos: atendidos.length,
    pctAtendidos: safra.length ? (atendidos.length / safra.length) * 100 : 0,
    semContato: safra.filter((l) => !l.contatado && ABERTOS.has(l.status)).length,
    primeiroContatoHoras: media(tempos),
    atendidosAte1h: tempos.filter((h) => h <= 1).length,
    amostraTempo: tempos.length,
    ganhosSafra: ganhosSafra.length,
    conversao: safra.length ? (ganhosSafra.length / safra.length) * 100 : 0,
    qtdVendas: vendas.length,
    valorVendas,
    ticket: comValor.length ? comValor.reduce((s, l) => s + (l.valorFinal ?? 0), 0) / comValor.length : 0,
    diasAteFechar: media(vendas.map((l) => l.diasAteFechar ?? 0)),
    negociando: negociando.length,
    valorNegociando: negociando.reduce((s, l) => s + (l.valorOrcado ?? 0), 0),
    perdidos: perdidosSafra.length,
    pctPerdidos: safra.length ? (perdidosSafra.length / safra.length) * 100 : 0,
    emAberto: safra.filter((l) => ABERTOS.has(l.status)).length,
    atrasados: safra.filter((l) => l.atrasado).length,
  }
}

export type Metricas = ReturnType<typeof calcular>

// Agrupa a safra + as vendas do período por uma chave (canal, vendedor,
// campanha, estado...) — base das tabelas "por X".
export function agrupar(m: Metricas, chave: (l: LinhaLead) => string) {
  type G = { chave: string; recebidos: number; atendidos: number; tempos: number[]; ganhosSafra: number; perdidos: number; negociando: number; valorNegociando: number; vendas: number; valorVendas: number; atrasados: number }
  const mapa = new Map<string, G>()
  const pegar = (k: string) => {
    let g = mapa.get(k)
    if (!g) {
      g = { chave: k, recebidos: 0, atendidos: 0, tempos: [], ganhosSafra: 0, perdidos: 0, negociando: 0, valorNegociando: 0, vendas: 0, valorVendas: 0, atrasados: 0 }
      mapa.set(k, g)
    }
    return g
  }
  for (const l of m.safra) {
    const g = pegar(chave(l))
    g.recebidos++
    if (l.contatado) g.atendidos++
    if (l.primeiroContatoHoras !== null) g.tempos.push(l.primeiroContatoHoras)
    if (l.status === 'ganho') g.ganhosSafra++
    if (l.status === 'perdido' || l.status === 'desqualificado') g.perdidos++
    if (l.status === 'em_negociacao') {
      g.negociando++
      g.valorNegociando += l.valorOrcado ?? 0
    }
    if (l.atrasado) g.atrasados++
  }
  for (const l of m.vendas) {
    const g = pegar(chave(l))
    g.vendas++
    g.valorVendas += l.valorFinal ?? 0
  }
  return [...mapa.values()].map((g) => ({
    ...g,
    pctAtendidos: g.recebidos ? (g.atendidos / g.recebidos) * 100 : 0,
    primeiroContato: g.tempos.length ? g.tempos.reduce((a, b) => a + b, 0) / g.tempos.length : null,
    conversao: g.recebidos ? (g.ganhosSafra / g.recebidos) * 100 : 0,
    ticket: g.vendas ? g.valorVendas / g.vendas : 0,
    share: m.recebidos ? (g.recebidos / m.recebidos) * 100 : 0,
  }))
}

export type Grupo = ReturnType<typeof agrupar>[number]

export function horasUteis(h: number | null | undefined) {
  if (h === null || h === undefined) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  const horas = Math.floor(h)
  const min = Math.round((h - horas) * 60)
  // 9h de expediente = 1 dia útil.
  if (horas >= 9) {
    const dias = h / 9
    return `${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${dias < 2 ? 'dia útil' : 'dias úteis'}`
  }
  return min ? `${horas}h ${min}min` : `${horas}h`
}

// Junta motivos digitados de jeitos diferentes ("Não responde.", "nao
// responde e nao atende", "Várias tentativas sem retorno"...) num grupo só.
export function grupoMotivo(texto: string | null): string {
  const t = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (!t.trim()) return 'Sem motivo escrito'
  if (/(nao|nunca|sem) (responde|respondeu|atende|retorno|resposta|sucesso)|tentativas|bloqueou|nao completa|nao funciona|nao existe|sem whats|sem fone|nao tem fone/.test(t)) return 'Não responde / contato não funciona'
  if (/concorrente|outro fornecedor|comprou (de|com|em) outr|pegou (do|de|com)/.test(t)) return 'Comprou do concorrente'
  if (/preco|caro|valor alto|orcamento alto/.test(t)) return 'Preço'
  if (/prazo|entrega|demora/.test(t)) return 'Prazo de entrega'
  if (/consumidor final|cliente final|pessoa fisica|uso proprio/.test(t)) return 'Consumidor final'
  if (/ja e cliente|ja cliente|carteira/.test(t)) return 'Já é cliente'
  if (/duplicad|repetid/.test(t)) return 'Lead duplicado'
  if (/sem interesse|nao tem interesse|desist|nao quer/.test(t)) return 'Sem interesse'
  if (/regiao/.test(t)) return 'Fora da região / outro vendedor'
  if (/nao tinha|nao temos|nao trabalhamos|falta|sem estoque|nao tem o produto|poco artesiano|isento/.test(t)) return 'Não temos o produto'
  if (/teste/.test(t)) return 'Teste'
  return 'Outros motivos'
}
