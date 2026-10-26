import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { formatarMoeda as formatarMoedaBr } from '../lib/moeda'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import PainelConfigModal from '../components/PainelConfigModal'

// Painel Financeiro de TV (75") — refeito 2026-10-23 a pedido do João: só %
// e quantidades na tela (nada de R$, a TV fica à vista), com exceção da
// inadimplência, que continua em reais. Mesmo conteúdo do painel antigo
// (meta, ideal do dia, vendas, a faturar/em negociação, devoluções,
// inadimplência, demandas) + comparação com o mês passado e a grade "mês a
// mês". Tudo desenhado num palco fixo de 1920×1080 que escala pra caber na
// TV — os tamanhos abaixo são px de TV, não de tela comum.

function formatarMoeda(v: number): string {
  return formatarMoedaBr(v, { casas: 0 })
}

// Empresas sem arte própria ainda (Compretec) caem no fallback de iniciais
// — nunca deixar o card sem identidade visual nenhuma.
const LOGO_POR_SLUG: Record<string, string> = {
  joitec: '/logos/joitec.png',
  'joitec-automacao': '/logos/joitec.png',
  'odin-tubos': '/logos/odin-tubos.png',
  'odin-compressores': '/logos/odin-compressores.png',
}

function iniciais(nome: string): string {
  const partes = nome.replace(/\/.*/, '').trim().split(/\s+/)
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : nome.slice(0, 2).toUpperCase()
}

const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const nomeMes = (mesRef: string) => NOME_MES[Number(mesRef.slice(5, 7)) - 1]
const pct = (v: number) => `${Math.round(v)}%`

type Card = {
  cardKey: string
  nome: string
  slugLogo: string
  origemExterna: 'aton' | null
  tokenConfigurado: boolean | null
  descontoPct: number | null
  vendasHoje: { quantidade: number; valor: number }
  vendasMes: { quantidade: number; valor: number }
  ticketMedioMes: number
  metaFaturamento: number
  percentualMeta: number
  bateuMeta: boolean
  valorAFaturar: number | null
  qtdAFaturar: number | null
  valorEmNegociacao: number | null
  devolucoesMes: { quantidade: number; comRecurso: number; semRecurso: number; valorVendas: number } | null
  inadimplencia: { valorTotal: number; quantidadeClientes: number; atualizadoEm: string | null }
}

type ResumoData = {
  cards: Card[]
  consolidado: {
    valorMes: number
    vendasMesQtd: number
    vendasHojeQtd: number
    metaFaturamento: number
    percentualMeta: number
    percentualIdealHoje: number
    inadimplenciaTotal: number
    diasUteisMes: number
    diasUteisAteHoje: number
  }
}

type MesHist = { mes: string; percentualMeta: number | null }
type Historico = {
  meses: string[]
  cards: { cardKey: string; meses: MesHist[]; percentualMesmoDiaMesPassado: number | null }[]
  grupo: { meses: MesHist[]; percentualMesmoDiaMesPassado: number | null }
}

type DemandaPainel = {
  id: number
  titulo: string
  dataLimite: string | null
  empresa: { id: number; nome: string }
  atribuidoPara: { id: number; name: string } | null
  estagio: { id: number; nome: string }
}

// Palco de no mínimo 1920×1080 escalado pra caber no espaço disponível (TV
// de qualquer resolução ou janela de notebook). Quando a tela não é 16:9 o
// palco estica no lado que sobra, em vez de deixar faixas pretas.
function usePalco() {
  const ref = useRef<HTMLDivElement>(null)
  const [palco, setPalco] = useState({ escala: 0.5, largura: 1920, altura: 1080 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const atualizar = () => {
      const r = el.getBoundingClientRect()
      const escala = Math.min(r.width / 1920, r.height / 1080) || 0.5
      setPalco({ escala, largura: Math.round(r.width / escala) || 1920, altura: Math.round(r.height / escala) || 1080 })
    }
    atualizar()
    const obs = new ResizeObserver(atualizar)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, ...palco }
}

function Logo({ card, tamanho = 54 }: { card: { nome: string; slugLogo: string }; tamanho?: number }) {
  const logo = LOGO_POR_SLUG[card.slugLogo]
  if (logo) {
    return (
      <div className="bg-white rounded-xl px-2.5 flex items-center shrink-0" style={{ height: tamanho }}>
        <img src={logo} alt={card.nome} className="h-[78%] w-auto max-w-[130px] object-contain" />
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-dark-700 flex items-center justify-center text-dark-200 font-bold shrink-0" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.4 }}>
      {iniciais(card.nome)}
    </div>
  )
}

function Selo({ tipo, children, className = '' }: { tipo: 'bom' | 'aviso' | 'ruim' | 'neutro'; children: React.ReactNode; className?: string }) {
  const cor = { bom: 'text-green-400 bg-green-500/15', aviso: 'text-amber-400 bg-amber-500/15', ruim: 'text-red-400 bg-red-500/15', neutro: 'text-gold-400 bg-gold-500/15' }[tipo]
  return <span className={`inline-flex items-center gap-1.5 font-bold rounded-full whitespace-nowrap text-[20px] px-3.5 py-1 ${cor} ${className}`}>{children}</span>
}

function Rotulo({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[19px] font-semibold uppercase tracking-[0.06em] text-dark-400 ${className}`}>{children}</p>
}

function Barra({ percentual, ideal, altura }: { percentual: number; ideal: number; altura: number }) {
  const noRitmo = percentual >= ideal
  return (
    <div className="relative rounded-full bg-dark-700" style={{ height: altura }}>
      <div className={`absolute inset-y-0 left-0 rounded-full ${noRitmo ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, percentual)}%` }} />
      <div className="absolute w-1 rounded bg-dark-50" style={{ left: `${Math.min(100, ideal)}%`, top: -altura * 0.5, bottom: -altura * 0.5 }} title={`Ideal pra hoje: ${pct(ideal)}`} />
    </div>
  )
}

// Diferença em pontos percentuais contra o mesmo dia do mês passado.
function VsMesPassado({ atual, passado, tamanho = 30 }: { atual: number; passado: number | null; tamanho?: number }) {
  if (passado == null) return <span className="text-dark-500" style={{ fontSize: tamanho * 0.7 }}>sem dado</span>
  const dif = Math.round(atual - passado)
  const cor = dif >= 0 ? 'text-green-400' : 'text-red-400'
  return (
    <span className={`font-bold tabular-nums ${cor}`} style={{ fontSize: tamanho }}>
      {dif >= 0 ? '▲' : '▼'} {Math.abs(dif)} pts
    </span>
  )
}

function Cabecalho({ titulo, sub, relogio, onConfig }: { titulo: string; sub: string; relogio: Date; onConfig: () => void }) {
  return (
    <div className="flex items-center gap-6">
      <div>
        <p className="text-[20px] text-dark-400 uppercase tracking-[0.06em] font-semibold">Grupo Odin · Painel Financeiro</p>
        <h1 className="font-heading text-[46px] font-bold text-dark-50 leading-tight">{titulo}</h1>
        <p className="text-[22px] text-dark-400">{sub}</p>
      </div>
      <div className="ml-auto text-right">
        <p className="text-[52px] font-semibold tabular-nums leading-none">{relogio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
        <p className="text-[20px] text-dark-400 first-letter:uppercase mt-1">{relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
      </div>
      <button onClick={onConfig} className="text-dark-600 hover:text-dark-300 transition-colors p-2 rounded-lg hover:bg-dark-800 self-start" title="Configurar carrossel">
        <Settings size={26} />
      </button>
    </div>
  )
}

// ── Tela 1: grupo ──────────────────────────────────────────────────────
function GraficoMeses({ meses, atual }: { meses: MesHist[]; atual: { mes: string; percentualMeta: number } }) {
  const dados = [...meses, atual]
  const W = 600, H = 470, base = 420, topo = 44, max = Math.max(100, ...dados.map((d) => d.percentualMeta ?? 0)) * 1.08
  const bw = 66, g = (W - bw * dados.length) / dados.length
  const y = (v: number) => base - (v / max) * (base - topo)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMax meet" role="img" aria-label="% da meta batida pelo grupo mês a mês">
      <line x1={0} x2={W} y1={base} y2={base} stroke="var(--color-dark-700)" strokeWidth={2} />
      <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="var(--color-dark-300)" strokeWidth={2} strokeDasharray="10 8" />
      <text x={W} y={y(100) - 10} textAnchor="end" fontSize={20} fill="var(--color-dark-400)">meta 100%</text>
      {dados.map((d, i) => {
        const x = g / 2 + i * (bw + g)
        const parcial = i === dados.length - 1
        const v = d.percentualMeta
        const t = v == null ? base : y(v)
        return (
          <g key={d.mes}>
            {v != null && <path d={`M${x},${base} V${t + 4} Q${x},${t} ${x + 4},${t} H${x + bw - 4} Q${x + bw},${t} ${x + bw},${t + 4} V${base} Z`} fill={parcial ? 'var(--color-gold-700, #1d5c52)' : 'var(--color-gold-500)'} />}
            <text x={x + bw / 2} y={v == null ? base - 14 : base - t < 56 ? t - 12 : t + 36} textAnchor="middle" fontSize={28} fontWeight={700} fill={v == null ? 'var(--color-dark-500)' : base - t < 56 ? 'var(--color-dark-100)' : 'white'}>
              {v == null ? '—' : pct(v)}
            </text>
            <text x={x + bw / 2} y={base + 36} textAnchor="middle" fontSize={24} fill="var(--color-dark-400)">
              {nomeMes(d.mes)}{parcial ? '*' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function TelaGrupo({ data, hist }: { data: ResumoData; hist: Historico | undefined }) {
  const c = data.consolidado
  const noRitmo = c.percentualMeta >= c.percentualIdealHoje
  const dif = Math.round(c.percentualMeta - c.percentualIdealHoje)
  const previsao = c.diasUteisAteHoje > 0 ? (c.percentualMeta / c.diasUteisAteHoje) * c.diasUteisMes : 0
  const clientesAtraso = data.cards.reduce((s, k) => s + k.inadimplencia.quantidadeClientes, 0)
  return (
    <div className="grid grid-cols-[1.15fr_1fr] grid-rows-[auto_minmax(0,1fr)] gap-[26px] min-h-0">
      <div className="row-span-2 bg-dark-800 rounded-[20px] px-7 py-6 grid content-between gap-[18px]">
        <Rotulo>% da meta batida · grupo</Rotulo>
        <div className="flex items-end gap-10">
          <p className={`font-bold tabular-nums leading-none text-[220px] ${noRitmo ? 'text-green-400' : 'text-red-400'}`}>{pct(c.percentualMeta)}</p>
          <div className="pb-[22px]">
            <p className="font-bold tabular-nums leading-none text-[76px] text-dark-300">{pct(c.percentualIdealHoje)}</p>
            <p className="text-[20px] text-dark-400">ideal p/ hoje</p>
          </div>
          <div className="ml-auto pb-[30px]">
            {noRitmo ? <Selo tipo="bom">🎯 No ritmo{dif > 0 ? ` · ${dif} pontos acima` : ''}</Selo> : <Selo tipo="ruim">⏳ {Math.abs(dif)} pontos abaixo do ritmo</Selo>}
          </div>
        </div>
        <div>
          <Barra percentual={c.percentualMeta} ideal={c.percentualIdealHoje} altura={40} />
          <div className="relative h-[34px] mt-[26px] text-[22px] text-dark-400 whitespace-nowrap">
            <span className="absolute left-0">0%</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${Math.min(84, Math.max(12, c.percentualIdealHoje))}%` }}>
              ideal <b className="text-dark-50">{pct(c.percentualIdealHoje)}</b>
            </span>
            <span className="absolute right-0">meta <b className="text-dark-50">100%</b></span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[18px]">
          <div className="bg-dark-700/60 rounded-2xl px-5 py-[18px]">
            <Rotulo>Vendas no mês</Rotulo>
            <p className="text-[60px] font-bold tabular-nums leading-none mt-2">{c.vendasMesQtd}</p>
            <p className="text-[20px] text-dark-400 mt-1.5">fechadas no grupo</p>
          </div>
          <div className="bg-dark-700/60 rounded-2xl px-5 py-[18px]">
            <Rotulo>Vendas hoje</Rotulo>
            <p className="text-[60px] font-bold tabular-nums leading-none mt-2">{c.vendasHojeQtd}</p>
            <p className="text-[20px] text-dark-400 mt-1.5">até agora</p>
          </div>
          <div className="bg-dark-700/60 rounded-2xl px-5 py-[18px]">
            <Rotulo>Previsão do mês</Rotulo>
            <p className={`text-[60px] font-bold tabular-nums leading-none mt-2 ${previsao >= 100 ? 'text-green-400' : ''}`}>{pct(previsao)}</p>
            <p className="text-[20px] text-dark-400 mt-1.5">se manter o ritmo</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[26px]">
        <div className="bg-dark-800 rounded-[20px] px-7 py-6">
          <Rotulo className="whitespace-nowrap">Mês passado</Rotulo>
          <p className="text-[72px] font-bold tabular-nums leading-none mt-2.5">{hist?.grupo.percentualMesmoDiaMesPassado != null ? pct(hist.grupo.percentualMesmoDiaMesPassado) : '—'}</p>
          <p className="text-[20px] text-dark-400 mt-2.5 whitespace-nowrap">no mesmo dia</p>
          <div className="mt-1">
            <VsMesPassado atual={c.percentualMeta} passado={hist?.grupo.percentualMesmoDiaMesPassado ?? null} tamanho={24} />
            <span className="text-[20px] text-dark-400"> agora</span>
          </div>
        </div>
        <div className="bg-dark-800 rounded-[20px] px-7 py-6">
          <Rotulo>Inadimplência total</Rotulo>
          <p className="font-bold tabular-nums leading-none mt-2.5 text-red-400 whitespace-nowrap" style={{ fontSize: tamanhoValor(formatarMoeda(c.inadimplenciaTotal)) }}>{formatarMoeda(c.inadimplenciaTotal)}</p>
          <p className="text-[20px] text-dark-400 mt-2.5">
            <b className="text-dark-50">{clientesAtraso}</b> clientes em atraso
          </p>
        </div>
      </div>

      <div className="bg-dark-800 rounded-[20px] px-7 py-6 grid grid-rows-[auto_minmax(0,1fr)] gap-2.5 min-h-0">
        <div className="flex justify-between items-baseline">
          <Rotulo>% da meta por mês · grupo</Rotulo>
          <span className="text-[19px] text-dark-400 whitespace-nowrap">* até hoje</span>
        </div>
        {hist ? <GraficoMeses meses={hist.grupo.meses} atual={{ mes: hist.meses.length ? mesSeguinte(hist.meses[hist.meses.length - 1]) : '', percentualMeta: c.percentualMeta }} /> : <p className="text-[20px] text-dark-500">Carregando meses anteriores...</p>}
      </div>
    </div>
  )
}

// Encolhe a fonte de valores em R$ compridos pra não vazar da caixa.
function tamanhoValor(texto: string): number {
  return texto.length <= 10 ? 52 : texto.length <= 12 ? 44 : 38
}

function mesSeguinte(mesRef: string): string {
  const [ano, mes] = mesRef.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// ── Tela 2: empresas ───────────────────────────────────────────────────
function InadimplenciaEditor({ card, onClose }: { card: Card; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [valor, setValor] = useState(String(card.inadimplencia.valorTotal || ''))
  const [qtd, setQtd] = useState(String(card.inadimplencia.quantidadeClientes || ''))

  const mut = trpc.financeiro.atualizarInadimplencia.useMutation({
    onSuccess() {
      toast.success('Inadimplência mensal atualizada')
      utils.financeiro.painelResumo.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <Input label="Valor em atraso (R$)" type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-40" />
      <Input label="Clientes" type="number" min="0" step="1" value={qtd} onChange={(e) => setQtd(e.target.value)} className="w-24" />
      <Button size="sm" loading={mut.isPending} onClick={() => mut.mutate({ cardKey: card.cardKey, valorTotal: Number(valor) || 0, quantidadeClientes: Number(qtd) || 0 })}>
        Salvar
      </Button>
      <Button size="sm" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </div>
  )
}

function CardEmpresa({ card, ideal, hist, editando, onEditar, onFecharEdicao }: { card: Card; ideal: number; hist: Historico['cards'][number] | undefined; editando: boolean; onEditar: () => void; onFecharEdicao: () => void }) {
  const meta = card.percentualMeta
  const noRitmo = meta >= ideal
  const extra =
    card.devolucoesMes !== null
      ? { valor: String(card.devolucoesMes.quantidade), detalhe: `${card.devolucoesMes.comRecurso} c/ recurso`, rotulo: 'devoluções' }
      : card.valorAFaturar !== null
        ? { valor: card.metaFaturamento ? pct((card.valorAFaturar / card.metaFaturamento) * 100) : '—', detalhe: 'da meta', rotulo: 'a faturar' }
        : card.valorEmNegociacao !== null
          ? { valor: card.metaFaturamento ? pct((card.valorEmNegociacao / card.metaFaturamento) * 100) : '—', detalhe: 'da meta', rotulo: 'em negociação' }
          : null
  const inad = card.inadimplencia
  const semToken = card.origemExterna === 'aton' && !card.tokenConfigurado

  return (
    <div className="bg-dark-800 rounded-[20px] px-6 py-5 grid grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] gap-3 min-w-0 min-h-0">
      <div className="flex items-center gap-3.5 min-w-0 h-[60px]">
        <Logo card={card} />
        <div className="flex-1 min-w-0">
          <p className={`text-[23px] font-semibold leading-tight ${semToken ? 'truncate' : 'line-clamp-2'}`}>{card.nome}</p>
          {semToken && <p className="text-[15px] text-red-400 font-semibold truncate">⚠️ Token Aton não configurado — vendas zeradas</p>}
        </div>
        {noRitmo ? <Selo tipo="bom">🎯 No ritmo</Selo> : <Selo tipo="ruim">⏳ Abaixo</Selo>}
      </div>
      <div className="flex items-end gap-5">
        <p className={`text-[84px] font-bold tabular-nums leading-none ${noRitmo ? 'text-green-400' : 'text-red-400'}`}>{pct(meta)}</p>
        <div className="pb-2 text-[20px] text-dark-400 whitespace-nowrap">
          ideal hoje
          <b className="block text-[34px] text-dark-300 leading-tight">{pct(ideal)}</b>
        </div>
        <div className="ml-auto text-right pb-1.5">
          <p className="text-[20px] text-dark-400 whitespace-nowrap">vs mês passado</p>
          <VsMesPassado atual={meta} passado={hist?.percentualMesmoDiaMesPassado ?? null} />
        </div>
      </div>
      <Barra percentual={meta} ideal={ideal} altura={14} />
      <div className="grid grid-cols-3 gap-2.5 border-t border-dark-700 pt-3">
        <div>
          <p className="text-[36px] font-bold tabular-nums leading-none">{card.vendasHoje.quantidade}</p>
          <p className="text-[17px] text-dark-400 uppercase tracking-wide whitespace-nowrap mt-1.5">vendas hoje</p>
        </div>
        <div>
          <p className="text-[36px] font-bold tabular-nums leading-none">{card.vendasMes.quantidade}</p>
          <p className="text-[17px] text-dark-400 uppercase tracking-wide whitespace-nowrap mt-1.5">vendas no mês</p>
        </div>
        {extra && (
          <div>
            <p className="text-[36px] font-bold tabular-nums leading-none whitespace-nowrap">
              {extra.valor} <span className="text-[18px] font-semibold text-dark-400">{extra.detalhe}</span>
            </p>
            <p className="text-[17px] text-dark-400 uppercase tracking-wide whitespace-nowrap mt-1.5">{extra.rotulo}</p>
          </div>
        )}
      </div>
      <div className="border-t border-dark-700 pt-3 self-end">
        {editando ? (
          <InadimplenciaEditor card={card} onClose={onFecharEdicao} />
        ) : (
          <div className="flex items-center gap-3 min-h-[62px]">
            <div className="min-w-0 flex-1">
              {inad.valorTotal > 0 || inad.quantidadeClientes > 0 ? (
                <>
                  <p className="text-[15px] font-semibold uppercase tracking-[0.06em] text-red-400">Inadimplência</p>
                  <p className="text-[18px] text-dark-400 whitespace-nowrap">
                    <b className="text-[32px] text-red-400 tabular-nums">{formatarMoeda(inad.valorTotal)}</b> · <b className="text-dark-50">{inad.quantidadeClientes}</b> clientes
                  </p>
                </>
              ) : (
                <p className="text-[19px] text-green-400">✓ nenhum cliente em atraso</p>
              )}
            </div>
            <button onClick={onEditar} className="text-dark-500 hover:text-gold-400 text-[18px] px-2 py-1 rounded-lg hover:bg-dark-700 transition-colors" title="Editar inadimplência">
              ✏️
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TelaEmpresas({ data, hist }: { data: ResumoData; hist: Historico | undefined }) {
  // Edição de inadimplência fica aqui (e não dentro do card) pra continuar
  // aberta mesmo com o relógio re-renderizando a tela a cada segundo.
  const [editando, setEditando] = useState<string | null>(null)
  return (
    <div className="grid grid-cols-3 grid-rows-2 gap-[22px] min-h-0">
      {data.cards.map((card) => (
        <CardEmpresa
          key={card.cardKey}
          card={card}
          ideal={data.consolidado.percentualIdealHoje}
          hist={hist?.cards.find((h) => h.cardKey === card.cardKey)}
          editando={editando === card.cardKey}
          onEditar={() => setEditando(card.cardKey)}
          onFecharEdicao={() => setEditando(null)}
        />
      ))}
    </div>
  )
}

// ── Tela 3: demandas ───────────────────────────────────────────────────
function prazoDemanda(dataLimite: string | null, hoje: string): { tipo: 'bom' | 'aviso' | 'ruim'; texto: string; ordem: number } {
  if (!dataLimite) return { tipo: 'bom', texto: '✓ sem prazo', ordem: 99999 }
  const d = dataLimite.slice(0, 10)
  const dias = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86400000)
  if (dias < 0) return { tipo: 'ruim', texto: `⚠ atrasada ${-dias} dia${dias === -1 ? '' : 's'}`, ordem: dias }
  if (dias === 0) return { tipo: 'aviso', texto: '● vence hoje', ordem: 0 }
  if (dias <= 5) return { tipo: 'aviso', texto: `● em ${dias} dia${dias === 1 ? '' : 's'}`, ordem: dias }
  return { tipo: 'bom', texto: `✓ em ${dias} dias`, ordem: dias }
}

function TelaDemandas({ demandas, hoje }: { demandas: DemandaPainel[] | undefined; hoje: string }) {
  if (!demandas) return <p className="text-[24px] text-dark-500">Carregando...</p>
  if (!demandas.length)
    return (
      <div className="bg-dark-800 rounded-[20px] grid place-items-center content-center gap-4 text-center">
        <p className="text-[120px] leading-none text-green-400">✓</p>
        <p className="text-[44px] font-bold text-dark-50">Nenhuma demanda financeira pendente</p>
        <p className="text-[24px] text-dark-400">Quando alguém marcar uma demanda para aparecer no painel, ela aparece aqui.</p>
      </div>
    )
  const lista = demandas.map((d) => ({ d, prazo: prazoDemanda(d.dataLimite, hoje) })).sort((a, b) => a.prazo.ordem - b.prazo.ordem)
  const MAX = 9
  return (
    <div className="grid grid-cols-3 auto-rows-min gap-[22px] content-start min-h-0">
      {lista.slice(0, MAX).map(({ d, prazo }) => (
        <div key={d.id} className="bg-dark-800 rounded-[20px] px-7 py-6 grid gap-3.5">
          <div className="flex justify-between items-center gap-3">
            <p className="text-[22px] font-semibold text-dark-300 truncate">{d.empresa.nome}</p>
            <Selo tipo="neutro" className="!text-[17px] !py-0.5">{d.estagio.nome}</Selo>
          </div>
          <p className="text-[30px] font-bold leading-tight text-dark-50">{d.titulo}</p>
          <div className="flex justify-between items-center gap-3 border-t border-dark-700 pt-3.5 text-[20px] text-dark-400">
            <span className="truncate">{d.atribuidoPara ? d.atribuidoPara.name : 'Sem pessoa atribuída'}</span>
            <span className="flex items-center gap-3 shrink-0">
              <b className="text-[24px] text-dark-50 tabular-nums">{d.dataLimite ? d.dataLimite.slice(0, 10).split('-').reverse().join('/') : 'Sem prazo'}</b>
              <Selo tipo={prazo.tipo} className="!text-[18px]">{prazo.texto}</Selo>
            </span>
          </div>
        </div>
      ))}
      {lista.length > MAX && <p className="col-span-3 text-center text-[22px] text-dark-400">+ {lista.length - MAX} demanda(s) — veja todas em Demandas</p>}
    </div>
  )
}

// ── Tela 4: mês a mês ──────────────────────────────────────────────────
function corCelula(v: number): string {
  // Escala de uma cor só (cor da marca), mais forte = mais perto da meta.
  const opacidade = v >= 100 ? 1 : v >= 90 ? 0.7 : v >= 80 ? 0.5 : v >= 65 ? 0.32 : 0.18
  return `color-mix(in srgb, var(--color-gold-500) ${Math.round(opacidade * 100)}%, var(--color-dark-800))`
}

function TelaMeses({ data, hist }: { data: ResumoData; hist: Historico | undefined }) {
  if (!hist) return <p className="text-[24px] text-dark-500">Carregando meses anteriores...</p>
  const mesAtual = hist.meses.length ? mesSeguinte(hist.meses[hist.meses.length - 1]) : ''
  const linhas = [
    ...data.cards.map((c) => ({ chave: c.cardKey, nome: c.nome, card: c as Card | null, meses: hist.cards.find((h) => h.cardKey === c.cardKey)?.meses ?? [], atual: c.percentualMeta })),
    { chave: 'grupo', nome: 'Grupo todo', card: null, meses: hist.grupo.meses, atual: data.consolidado.percentualMeta },
  ]
  const Celula = ({ v, parcial }: { v: number | null; parcial?: boolean }) =>
    v == null ? (
      <div className="rounded-xl h-full max-h-[110px] self-center grid place-items-center bg-dark-800/60 text-dark-500 text-[22px]">—</div>
    ) : (
      <div className={`relative rounded-xl h-full max-h-[110px] self-center grid place-items-center font-bold tabular-nums text-[34px] ${v >= 100 ? 'text-dark-950' : 'text-dark-50'} ${parcial ? 'outline-2 outline-dashed outline-dark-400 -outline-offset-2' : ''}`} style={{ background: corCelula(v) }}>
        {pct(v)}
        {v >= 100 && !parcial && <span className="absolute bottom-1.5 text-[14px] font-semibold">✓ meta</span>}
      </div>
    )
  return (
    <div className="grid grid-rows-[minmax(0,1fr)_auto] gap-[22px] min-h-0">
      <div className="bg-dark-800 rounded-[20px] px-7 py-5 min-h-0">
        <div className="grid grid-cols-[430px_repeat(6,1fr)_140px] gap-x-2 gap-y-2 h-full" style={{ gridTemplateRows: `auto repeat(${linhas.length}, minmax(0, 1fr))` }}>
          <p className="text-[19px] font-semibold uppercase tracking-[0.06em] text-dark-400 pb-1.5">Empresa</p>
          {[...hist.meses, mesAtual].map((m, i) => (
            <p key={m} className="text-[19px] font-semibold uppercase tracking-[0.06em] text-dark-400 text-center pb-1.5">
              {nomeMes(m)}
              {i === hist.meses.length ? ' (até hoje)' : ''}
            </p>
          ))}
          <p className="text-[19px] font-semibold uppercase tracking-[0.06em] text-dark-400 text-center pb-1.5">Média</p>
          {linhas.map((l) => {
            const comDado = l.meses.map((m) => m.percentualMeta).filter((v): v is number => v != null)
            const media = comDado.length ? comDado.reduce((s, v) => s + v, 0) / comDado.length : null
            return [
              <div key={`${l.chave}-n`} className={`flex items-center gap-3 min-w-0 text-[23px] font-semibold ${l.card ? '' : 'text-gold-400'}`}>
                {l.card && <Logo card={l.card} tamanho={44} />}
                <span className="line-clamp-2 leading-tight">{l.nome}</span>
              </div>,
              ...l.meses.map((m) => <Celula key={`${l.chave}-${m.mes}`} v={m.percentualMeta} />),
              <Celula key={`${l.chave}-atual`} v={l.atual} parcial />,
              <p key={`${l.chave}-m`} className={`grid place-items-center font-bold tabular-nums text-[34px] ${l.card ? '' : 'text-gold-400'}`}>{media == null ? '—' : pct(media)}</p>,
            ]
          })}
        </div>
      </div>
      <div className="flex gap-6 items-center flex-wrap text-[20px] text-dark-400">
        <span className="flex gap-1">
          {[50, 70, 85, 95, 100].map((v) => (
            <i key={v} className="block w-[46px] h-[22px] rounded" style={{ background: corCelula(v) }} />
          ))}
        </span>
        <span>fraco → meta batida ✓ · tracejado = mês atual · — sem faturamento no CRM · % sobre a meta atual</span>
      </div>
    </div>
  )
}

// Painel de TV financeiro — restrito à feature 'painel_financeiro' (ver
// CARDS_PAINEL em server/src/router/financeiro.ts pra lista + regra de
// quais empresas juntam num card só). "Importações" saiu do carrossel —
// pedido do João, 2026-10-14.
export default function PainelFinanceiro() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data } = trpc.financeiro.painelResumo.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true })
  const { data: hist } = trpc.financeiro.painelHistorico.useQuery(undefined, { refetchInterval: 10 * 60 * 1000, refetchIntervalInBackground: true })
  const { data: demandasFinanceiras } = trpc.demandas.painelFinanceiro.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true })

  const hoje = relogio.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const c = data?.consolidado
  const subMes = c ? `${relogio.toLocaleDateString('pt-BR', { month: 'long' })} · ${c.diasUteisAteHoje} de ${c.diasUteisMes} dias úteis` : ''

  // `render` é chamado como função (`slides[i].render()`), nunca como
  // `<slides[i].render />` — isso recriaria o componente a cada tick do
  // relógio e desmontaria o slide inteiro (o formulário de inadimplência
  // fechava sozinho).
  const slides = [
    { titulo: 'Grupo', cabecalho: 'Visão consolidada do grupo', sub: subMes, render: () => (data ? <TelaGrupo data={data} hist={hist} /> : null) },
    { titulo: 'Empresas', cabecalho: 'Empresas', sub: '% da meta de cada uma, vendas, comparação e inadimplência', render: () => (data ? <TelaEmpresas data={data} hist={hist} /> : null) },
    { titulo: 'Demandas', cabecalho: 'Demandas financeiras pendentes', sub: 'Marcadas para aparecer no painel · as atrasadas vêm primeiro', render: () => <TelaDemandas demandas={demandasFinanceiras} hoje={hoje} /> },
    { titulo: 'Mês a mês', cabecalho: 'Mês a mês', sub: '% da meta batida em cada mês · quanto mais forte a cor, mais perto da meta', render: () => (data ? <TelaMeses data={data} hist={hist} /> : null) },
  ]
  const [slideAtual, setSlideAtual] = useState(0)
  const [configAberta, setConfigAberta] = useState(false)
  const utils = trpc.useUtils()
  const { data: config } = trpc.configuracoes.painelFinanceiroConfig.useQuery()
  const segundos = config?.segundos ?? 20
  const autoplay = config?.autoplay ?? true
  const duracaoSlideMs = segundos * 1000
  const salvarConfigMut = trpc.configuracoes.set.useMutation({
    onSuccess() {
      utils.configuracoes.painelFinanceiroConfig.invalidate()
      setConfigAberta(false)
    },
  })

  useEffect(() => {
    if (!autoplay) return
    const id = setInterval(() => setSlideAtual((s) => (s + 1) % slides.length), duracaoSlideMs)
    return () => clearInterval(id)
  }, [slides.length, duracaoSlideMs, autoplay, slideAtual])

  const { ref, escala, largura, altura } = usePalco()
  const slide = slides[slideAtual]

  return (
    <div ref={ref} className="fixed inset-0 bg-dark-950 text-dark-50 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 origin-center" style={{ width: largura, height: altura, transform: `translate(-50%, -50%) scale(${escala})` }}>
        <div className="absolute inset-0 px-14 pt-10 pb-[60px] grid grid-rows-[auto_minmax(0,1fr)] gap-[26px]">
          <Cabecalho titulo={slide.cabecalho} sub={slide.sub} relogio={relogio} onConfig={() => setConfigAberta(true)} />
          {data ? slide.render() : <p className="text-[24px] text-dark-500">Carregando...</p>}
        </div>
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-3">
          {slides.map((s, i) => (
            <button
              key={s.titulo}
              onClick={() => setSlideAtual(i)}
              className={`px-4 py-1.5 rounded-full text-[17px] transition-colors ${i === slideAtual ? 'bg-gold-400 text-dark-950 font-semibold' : 'bg-dark-800 text-dark-400'}`}
            >
              {s.titulo}
            </button>
          ))}
        </div>
        {autoplay && (
          <div className="absolute bottom-0 inset-x-0 h-2 bg-dark-800">
            <div key={slideAtual} className="h-full bg-gold-400 painel-progresso" style={{ animationDuration: `${duracaoSlideMs}ms` }} />
          </div>
        )}
      </div>

      <PainelConfigModal
        open={configAberta}
        onClose={() => setConfigAberta(false)}
        segundosAtual={segundos}
        autoplayAtual={autoplay}
        salvando={salvarConfigMut.isPending}
        onSalvar={({ segundos: s, autoplay: a }) => salvarConfigMut.mutate({ painel_financeiro_segundos: s, painel_financeiro_autoplay: a ? 1 : 0 })}
      />
    </div>
  )
}
