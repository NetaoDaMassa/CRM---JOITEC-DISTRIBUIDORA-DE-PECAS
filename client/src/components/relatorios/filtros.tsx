import { useState } from 'react'
import { RefreshCw, CalendarDays, User, MapPin } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { usePersistedState } from '../../lib/usePersistedState'
import { hojeBrString } from '../../lib/utils'

// Filtros compartilhados por TODOS os relatórios novos (resumo + detalhados)
// — guardados na sessão, então trocar de relatório mantém período/vendedor/
// região escolhidos (pedido do João, 2026-10-20: "não tem filtros
// suficientes e não é dinâmico").

export type Regiao = 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul'
export type Preset = 'hoje' | '7d' | 'mes' | 'mes_passado' | '90d' | 'ano' | 'custom'

export const PRESETS: { valor: Preset; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mes_passado', rotulo: 'Mês passado' },
  { valor: '90d', rotulo: '90 dias' },
  { valor: 'ano', rotulo: 'Este ano' },
  { valor: 'custom', rotulo: 'Personalizado' },
]

export const REGIOES: { valor: Regiao; rotulo: string }[] = [
  { valor: 'norte', rotulo: 'Norte' },
  { valor: 'nordeste', rotulo: 'Nordeste' },
  { valor: 'centro_oeste', rotulo: 'Centro-Oeste' },
  { valor: 'sudeste', rotulo: 'Sudeste' },
  { valor: 'sul', rotulo: 'Sul' },
]

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function ultimoDiaDoMes(ano: number, mes: number) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

function diasEntre(a: string, b: string) {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000)
}

export function datasDoPreset(preset: Preset): { inicio: string; fim: string } | null {
  const hoje = hojeBrString()
  const [ano, mes] = hoje.split('-').map(Number)
  switch (preset) {
    case 'hoje':
      return { inicio: hoje, fim: hoje }
    case '7d':
      return { inicio: somarDias(hoje, -6), fim: hoje }
    case 'mes':
      return { inicio: hoje.slice(0, 8) + '01', fim: hoje }
    case 'mes_passado': {
      const a = mes === 1 ? ano - 1 : ano
      const m = mes === 1 ? 12 : mes - 1
      const mm = String(m).padStart(2, '0')
      return { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-${String(ultimoDiaDoMes(a, m)).padStart(2, '0')}` }
    }
    case '90d':
      return { inicio: somarDias(hoje, -89), fim: hoje }
    case 'ano':
      return { inicio: `${ano}-01-01`, fim: hoje }
    default:
      return null
  }
}

// Período de comparação ("vs período anterior"): o mesmo tamanho logo
// antes. Quando o período é um pedaço de mês começando no dia 1 (ex.: "Este
// mês" até dia 20), compara com o mesmo pedaço do mês anterior (1 a 20).
export function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const [a, m, d] = inicio.split('-').map(Number)
  if (d === 1 && fim.slice(0, 7) === inicio.slice(0, 7)) {
    const pa = m === 1 ? a - 1 : a
    const pm = m === 1 ? 12 : m - 1
    const diaFim = Math.min(Number(fim.slice(8, 10)), ultimoDiaDoMes(pa, pm))
    const mm = String(pm).padStart(2, '0')
    return { inicio: `${pa}-${mm}-01`, fim: `${pa}-${mm}-${String(diaFim).padStart(2, '0')}` }
  }
  const tamanho = diasEntre(inicio, fim) + 1
  return { inicio: somarDias(inicio, -tamanho), fim: somarDias(inicio, -1) }
}

export function formatarDataCurta(data: string | null | undefined) {
  if (!data) return '—'
  const [a, m, d] = data.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function useFiltrosRelatorio() {
  const { user } = useAuth()
  const [preset, setPresetState] = usePersistedState<Preset>('rel:preset', 'mes')
  const padrao = datasDoPreset('mes')!
  const [inicioCustom, setInicio] = usePersistedState('rel:inicio', padrao.inicio)
  const [fimCustom, setFim] = usePersistedState('rel:fim', padrao.fim)
  const [vendedorId, setVendedorId] = usePersistedState<string>('rel:vendedor', '')
  const [regiao, setRegiao] = usePersistedState<string>('rel:regiao', '')

  // Preset recalcula sempre (ex.: "Este mês" amanhã já inclui amanhã).
  const datas = datasDoPreset(preset) ?? { inicio: inicioCustom, fim: fimCustom }
  const ehAdmin = user?.role === 'admin'
  const periodo = {
    dataInicio: datas.inicio,
    dataFim: datas.fim,
    vendedorId: ehAdmin && vendedorId ? Number(vendedorId) : undefined,
    regiao: (regiao || undefined) as Regiao | undefined,
  }
  const ant = periodoAnterior(datas.inicio, datas.fim)
  const anterior = { ...periodo, dataInicio: ant.inicio, dataFim: ant.fim }
  const filtroAtual = { vendedorId: periodo.vendedorId, regiao: periodo.regiao }

  function setPreset(p: Preset) {
    if (p === 'custom') {
      setInicio(datas.inicio)
      setFim(datas.fim)
    }
    setPresetState(p)
  }

  return {
    preset,
    setPreset,
    inicio: datas.inicio,
    fim: datas.fim,
    setInicio: (v: string) => {
      setPresetState('custom')
      setInicio(v)
    },
    setFim: (v: string) => {
      setPresetState('custom')
      setFim(v)
    },
    vendedorId,
    setVendedorId,
    regiao,
    setRegiao,
    periodo,
    anterior,
    filtroAtual,
    ehAdmin,
  }
}

export type Filtros = ReturnType<typeof useFiltrosRelatorio>

const classeCampo =
  'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500 transition-colors'

export function BarraFiltros({ f, semPeriodo, semVendedor }: { f: Filtros; semPeriodo?: boolean; semVendedor?: boolean }) {
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: f.ehAdmin && !semVendedor })
  const lista = (vendedores ?? []).filter((v) => (v as { canalVenda?: string }).canalVenda !== 'nenhum')
  const utils = trpc.useUtils()
  const [girando, setGirando] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!semPeriodo && (
        <>
          <div className="flex items-center rounded-lg border border-dark-600 bg-dark-800 p-0.5 overflow-x-auto max-w-full">
            {PRESETS.map((p) => (
              <button
                key={p.valor}
                type="button"
                onClick={() => f.setPreset(p.valor)}
                className={`px-2.5 h-8 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  f.preset === p.valor ? 'bg-gold-500 text-white shadow-sm' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-700'
                }`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarDays size={15} className="text-dark-400" />
            <input type="date" value={f.inicio} onChange={(e) => e.target.value && f.setInicio(e.target.value)} className={classeCampo} aria-label="De" />
            <span className="text-dark-500 text-xs">até</span>
            <input type="date" value={f.fim} onChange={(e) => e.target.value && f.setFim(e.target.value)} className={classeCampo} aria-label="Até" />
          </div>
        </>
      )}
      {f.ehAdmin && !semVendedor && (
        <label className="flex items-center gap-1.5">
          <User size={15} className="text-dark-400" />
          <select value={f.vendedorId} onChange={(e) => f.setVendedorId(e.target.value)} className={`${classeCampo} max-w-52`}>
            <option value="">Todos os vendedores</option>
            {lista.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5">
        <MapPin size={15} className="text-dark-400" />
        <select value={f.regiao} onChange={(e) => f.setRegiao(e.target.value)} className={classeCampo}>
          <option value="">Todas as regiões</option>
          {REGIOES.map((r) => (
            <option key={r.valor} value={r.valor}>
              {r.rotulo}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={async () => {
          setGirando(true)
          try {
            await utils.reports.invalidate()
          } finally {
            setGirando(false)
          }
        }}
        className="h-9 px-3 rounded-lg border border-dark-600 bg-dark-800 text-sm text-dark-200 hover:text-gold-400 hover:border-gold-500 flex items-center gap-1.5 transition-colors"
        title="Buscar os números de novo"
      >
        <RefreshCw size={14} className={girando ? 'animate-spin' : ''} />
        Atualizar
      </button>
    </div>
  )
}
