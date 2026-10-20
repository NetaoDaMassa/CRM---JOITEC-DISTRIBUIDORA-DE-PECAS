import { CalendarDays, Filter, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { trpc } from '../../../lib/trpc'
import { PRESETS } from '../../../components/relatorios/filtros'
import { CANAIS, ETAPAS, REGIOES_BR, SEGMENTOS } from './base'
import type { Canal, FiltrosLeads, LinhaLead } from './base'

const classeCampo =
  'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500 transition-colors max-w-56'

// Barra de filtros do Relatório de Leads: período (mesmos atalhos dos
// outros relatórios) + 7 filtros que cruzam com tudo. As opções saem dos
// próprios leads do período — só aparece canal/campanha/estado que existe.
export default function FiltrosLeadsBarra({ f, linhas }: { f: FiltrosLeads; linhas: LinhaLead[] | undefined }) {
  const utils = trpc.useUtils()
  const [girando, setGirando] = useState(false)
  const base = linhas ?? []

  const canais = [...new Set(base.map((l) => l.canal))].sort((a, b) => CANAIS[a].rotulo.localeCompare(CANAIS[b].rotulo, 'pt-BR'))
  const campanhas = [...new Set(base.map((l) => l.campanha ?? '(sem campanha)'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const vendedores = [...new Map(base.map((l) => [String(l.vendedorId ?? 0), l.vendedor])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  const ufs = [...new Set(base.map((l) => l.uf).filter(Boolean) as string[])].sort()
  const etapas = [...new Set(base.map((l) => l.status))]

  const select = (valor: string, set: (v: string) => void, rotulo: string, opcoes: [string, string][]) => (
    <select value={valor} onChange={(e) => set(e.target.value)} className={`${classeCampo} ${valor ? 'border-gold-500 text-gold-400' : ''}`} aria-label={rotulo}>
      <option value="">{rotulo}</option>
      {opcoes.map(([v, r]) => (
        <option key={v} value={v}>
          {r}
        </option>
      ))}
    </select>
  )

  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          onClick={async () => {
            setGirando(true)
            try {
              await utils.leadsRelatorios.invalidate()
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
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={15} className="text-dark-400" />
        {select(f.canal, f.setCanal, 'Todos os canais', canais.map((c: Canal) => [c, CANAIS[c].rotulo]))}
        {select(f.campanha, f.setCampanha, 'Todas as campanhas', campanhas.map((c) => [c, c]))}
        {select(f.vendedor, f.setVendedor, 'Todos os vendedores', vendedores)}
        {select(f.regiao, f.setRegiao, 'Todas as regiões', Object.entries(REGIOES_BR))}
        {select(f.uf, f.setUf, 'Todos os estados', ufs.map((u) => [u, u]))}
        {select(f.segmento, f.setSegmento, 'Todos os segmentos', Object.entries(SEGMENTOS))}
        {select(
          f.etapa,
          f.setEtapa,
          'Todas as etapas',
          etapas.map((e) => [e, ETAPAS[e]?.rotulo ?? e])
        )}
        {f.ativos > 0 && (
          <button type="button" onClick={f.limpar} className="h-9 px-3 rounded-lg text-sm text-gold-500 hover:text-gold-400 flex items-center gap-1">
            <X size={14} /> Limpar {f.ativos} filtro{f.ativos > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  )
}
