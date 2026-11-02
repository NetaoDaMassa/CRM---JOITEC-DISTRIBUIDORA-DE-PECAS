import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'

// Telas da Expedição pros painéis de TV (pedido do João, 2026-11-02): o
// painel do estoque (/painel-tv-logistica) gira entre elas e o Painel
// Financeiro usa a de empresas pra ver o que está acontecendo e quantas
// notas esperam o Financeiro. Desenhadas pro palco fixo de 1920×1080.

export type ResumoExpedicao = inferRouterOutputs<AppRouter>['expedicao']['painelResumo']

const ETAPAS = [
  { chave: 'separacao', titulo: 'Separação', cor: '#f59e0b' },
  { chave: 'conferencia', titulo: 'Conferência', cor: '#3b82f6' },
  { chave: 'embalagem', titulo: 'Embalagem', cor: '#8b5cf6' },
  { chave: 'liberados', titulo: 'NF ok · agendar', cor: '#22c55e' },
  { chave: 'coleta', titulo: 'Aguard. coleta', cor: '#14b8a6' },
] as const

function tempoDesde(utc: string | null): string {
  if (!utc) return ''
  const min = Math.max(0, Math.round((Date.now() - Date.parse(`${utc.replace(' ', 'T')}Z`)) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`
}

// Uma coluna por empresa: notas esperando o Financeiro em destaque, etapas,
// atrasados e coletados hoje. `foco='financeiro'` aumenta a lista de notas.
export function TelaEmpresasExpedicao({ data, foco = 'estoque' }: { data: ResumoExpedicao; foco?: 'estoque' | 'financeiro' }) {
  const maxNotas = foco === 'financeiro' ? 7 : 4
  return (
    <div className="grid grid-cols-3 gap-[22px] min-h-0 h-full">
      {data.empresas.map((e) => (
        <div key={e.slug} className="rounded-3xl bg-dark-900 border-2 border-dark-700 p-6 flex flex-col gap-4 min-h-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[34px] font-bold">{e.nome}</p>
            <p className="text-[20px] text-dark-400">{e.emAndamento} em andamento</p>
          </div>

          <div className={`rounded-2xl px-5 py-4 ${e.aguardandoNf ? 'bg-amber-900/35 border-2 border-amber-500/60' : 'bg-dark-800 border-2 border-dark-700'}`}>
            <div className="flex items-end gap-4">
              <p className={`text-[84px] font-bold leading-none tabular-nums ${e.aguardandoNf ? 'text-amber-200' : 'text-dark-400'}`}>{e.aguardandoNf}</p>
              <p className={`text-[22px] font-semibold leading-tight pb-2 ${e.aguardandoNf ? 'text-amber-100' : 'text-dark-400'}`}>
                nota(s) aguardando
                <br />o Financeiro emitir
              </p>
            </div>
            {e.notasAguardando.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {e.notasAguardando.slice(0, maxNotas).map((n) => (
                  <div key={n.pedido} className="flex items-baseline gap-3 text-[19px]">
                    <span className="font-bold tabular-nums">{n.pedido}</span>
                    <span className="flex-1 truncate text-dark-200">{n.cliente}</span>
                    <span className={`tabular-nums whitespace-nowrap ${n.atrasado ? 'text-red-300 font-semibold' : 'text-amber-200'}`}>há {tempoDesde(n.desde)}</span>
                  </div>
                ))}
                {e.notasAguardando.length > maxNotas && <p className="text-[17px] text-amber-200/80">+ {e.notasAguardando.length - maxNotas} pedido(s)</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {ETAPAS.map((x) => (
              <div key={x.chave} className="rounded-xl bg-dark-800 px-2 py-3 text-center">
                <p className="text-[46px] font-bold leading-none tabular-nums" style={{ color: e[x.chave] ? x.cor : undefined }}>
                  {e[x.chave]}
                </p>
                <p className="text-[15px] text-dark-400 mt-1 leading-tight">{x.titulo}</p>
              </div>
            ))}
          </div>

          <div className="mt-auto grid grid-cols-2 gap-3">
            <div className={`rounded-2xl px-4 py-3 ${e.atrasados ? 'bg-red-900/40 border-2 border-red-500/60' : 'bg-dark-800'}`}>
              <p className={`text-[52px] font-bold leading-none tabular-nums ${e.atrasados ? 'text-red-300' : 'text-dark-400'}`}>{e.atrasados}</p>
              <p className="text-[18px] text-dark-300 mt-1">atrasado(s) 48h{e.pausados ? ` · ${e.pausados} pausado(s)` : ''}</p>
            </div>
            <div className="rounded-2xl px-4 py-3 bg-dark-800">
              <p className="text-[52px] font-bold leading-none tabular-nums text-green-300">{e.coletadosHoje}</p>
              <p className="text-[18px] text-dark-300 mt-1">
                coletado(s) hoje{e.coletadosHoje ? ` · ${Math.round((e.noPrazoHoje / e.coletadosHoje) * 100)}% no prazo` : ''}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Quem fez o quê hoje (etapas terminadas) e quem está trabalhando agora.
export function TelaEquipeEstoque({ data }: { data: ResumoExpedicao }) {
  const lista = data.equipe.slice(0, 12)
  if (!lista.length) return <p className="text-[30px] text-dark-500 text-center pt-24">Ninguém terminou etapa hoje ainda.</p>
  const maior = Math.max(1, ...lista.map((p) => p.separados + p.conferidos + p.embalados))
  return (
    <div className="rounded-3xl bg-dark-900 border-2 border-dark-700 px-8 py-6 min-h-0 h-full flex flex-col">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2.4fr)_110px_110px_110px_110px] gap-x-4 text-[19px] font-semibold uppercase tracking-wide text-dark-400 pb-3 border-b-2 border-dark-800">
        <span>Pessoa</span>
        <span>Pedidos hoje</span>
        <span className="text-center text-amber-300">Separou</span>
        <span className="text-center text-blue-300">Conferiu</span>
        <span className="text-center text-violet-300">Embalou</span>
        <span className="text-center text-red-300">Erros</span>
      </div>
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateRows: `repeat(${Math.max(lista.length, 6)}, minmax(0, 1fr))` }}>
        {lista.map((p) => {
          const total = p.separados + p.conferidos + p.embalados
          return (
            <div key={p.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2.4fr)_110px_110px_110px_110px] gap-x-4 items-center border-b border-dark-800/70">
              <div className="min-w-0">
                <p className="text-[27px] font-bold truncate">{p.nome}</p>
                <p className="text-[16px] text-dark-400 truncate">
                  {p.empresa}
                  {p.agora && <span className="text-cyan-300"> · agora {p.agora}</span>}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-[22px] rounded-full bg-dark-800 overflow-hidden flex">
                  <div className="h-full bg-amber-500" style={{ width: `${(p.separados / maior) * 100}%` }} />
                  <div className="h-full bg-blue-500" style={{ width: `${(p.conferidos / maior) * 100}%` }} />
                  <div className="h-full bg-violet-500" style={{ width: `${(p.embalados / maior) * 100}%` }} />
                </div>
                <span className="text-[26px] font-bold tabular-nums w-12 text-right">{total}</span>
              </div>
              <span className="text-center text-[30px] font-bold tabular-nums">{p.separados || '—'}</span>
              <span className="text-center text-[30px] font-bold tabular-nums">{p.conferidos || '—'}</span>
              <span className="text-center text-[30px] font-bold tabular-nums">{p.embalados || '—'}</span>
              <span className={`text-center text-[30px] font-bold tabular-nums ${p.erros ? 'text-red-300' : 'text-dark-500'}`}>{p.erros || '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Coletas de hoje por transportadora + coletados e % no prazo nos últimos 7 dias.
export function TelaColetas({ data }: { data: ResumoExpedicao }) {
  const maior = Math.max(1, ...data.semana.map((d) => d.coletados))
  const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: 'UTC' })
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-[22px] min-h-0 h-full">
      <div className="rounded-3xl bg-dark-900 border-2 border-dark-700 px-7 py-6 min-h-0 flex flex-col gap-3">
        <p className="text-[26px] font-bold">Coletas de hoje</p>
        {data.transportadoras.length === 0 ? (
          <p className="text-[24px] text-dark-500 pt-8">Nenhuma coleta agendada para hoje.</p>
        ) : (
          data.transportadoras.slice(0, 8).map((t) => (
            <div key={t.transportadora} className="rounded-2xl bg-dark-800 px-5 py-3 flex items-center gap-4">
              <p className="flex-1 text-[25px] font-semibold truncate">🚚 {t.transportadora}</p>
              <p className="text-[20px] text-dark-300 whitespace-nowrap">
                <b className="text-teal-300 text-[30px] tabular-nums">{t.agendadas}</b> a coletar ·{' '}
                <b className="text-green-300 text-[30px] tabular-nums">{t.coletadas}</b> coletado(s)
                {t.volumes ? ` · ${t.volumes} vol.` : ''}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="rounded-3xl bg-dark-900 border-2 border-dark-700 px-7 py-6 min-h-0 flex flex-col">
        <p className="text-[26px] font-bold">Coletados nos últimos 7 dias</p>
        <div className="flex-1 min-h-0 flex items-end gap-4 pt-6">
          {data.semana.map((d) => {
            const pct = d.coletados ? Math.round((d.noPrazo / d.coletados) * 100) : null
            return (
              <div key={d.dia} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <p className="text-[30px] font-bold tabular-nums">{d.coletados}</p>
                <div className="w-full rounded-t-xl bg-dark-800 relative overflow-hidden" style={{ height: `${Math.max(6, (d.coletados / maior) * 70)}%` }}>
                  <div className="absolute bottom-0 inset-x-0 bg-green-500/80" style={{ height: `${pct ?? 0}%` }} />
                </div>
                <p className={`text-[19px] font-semibold ${pct == null ? 'text-dark-500' : pct >= 90 ? 'text-green-300' : pct >= 70 ? 'text-amber-300' : 'text-red-300'}`}>{pct == null ? '—' : `${pct}% prazo`}</p>
                <p className="text-[18px] text-dark-400 capitalize">{diaSemana(d.dia)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
