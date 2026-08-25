import { useMemo, useState } from 'react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'

type Aba = 'sla' | 'transferencias' | 'geral'

const ABAS: { value: Aba; label: string }[] = [
  { value: 'sla', label: 'SLA' },
  { value: 'transferencias', label: 'Transferências' },
  { value: 'geral', label: 'Geral' },
]

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
      <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums text-dark-50 mt-1">{value}</p>
      {sub && <p className="text-xs text-dark-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function formatarHoras(h: number): string {
  if (!h || h <= 0) return '0h'
  const horas = Math.floor(h)
  const min = Math.round((h - horas) * 60)
  return min > 0 ? `${horas}h ${min}min` : `${horas}h`
}

function SlaTab() {
  const { data, isLoading } = trpc.leadsRelatorios.slaOverview.useQuery(undefined, { refetchInterval: 30000 })

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-dark-800 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-6">
      <p className="text-xs text-dark-500">Atualiza a cada 30s.</p>

      {data.criticalAlertVendors.length > 0 && (
        <div className="space-y-2">
          {data.criticalAlertVendors.map((v) => (
            <div key={v.vendorId ?? v.name} className="bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl p-4 text-sm">
              ⚠️ {v.name} tem {v.critico} leads críticos simultâneos
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Leads Atrasados por Vendedor</p>
          {data.overdueByVendor.length === 0 ? (
            <p className="text-xs text-dark-500">Nenhum lead em risco ou crítico no momento.</p>
          ) : (
            <div className="space-y-2">
              {data.overdueByVendor.map((v) => (
                <div key={v.vendorId ?? v.name} className="flex items-center justify-between text-sm">
                  <span className="text-dark-200">{v.name}</span>
                  <div className="flex items-center gap-2">
                    {v.emRisco > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">{v.emRisco} em risco</span>
                    )}
                    {v.critico > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">{v.critico} crítico</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Tempo Médio Parado em Abordagem</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-dark-50">{formatarHoras(data.avgTimeStuckByStage.overallHours)}</p>
          <p className="text-[10px] text-dark-500 uppercase tracking-wide mb-3">horas úteis (geral)</p>
          <div className="space-y-1.5 pt-3 border-t border-dark-700">
            {data.avgTimeStuckByStage.byVendor.map((v) => (
              <div key={v.vendorId ?? v.name} className="flex items-center justify-between text-xs">
                <span className="text-dark-300">{v.name}</span>
                <span className={`font-mono tabular-nums ${v.avgHours > data.avgTimeStuckByStage.overallHours ? 'text-red-400' : 'text-dark-400'}`}>
                  {formatarHoras(v.avgHours)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <p className="text-sm font-semibold text-dark-100 mb-3">Histórico de Reatribuição por Vendedor</p>
        {data.reassignmentHistory.length === 0 ? (
          <p className="text-xs text-dark-500">Nenhuma reatribuição registrada ainda.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <p className="text-dark-500 uppercase tracking-wide font-semibold">Vendedor</p>
            <p className="text-dark-500 uppercase tracking-wide font-semibold">Recebeu</p>
            <p className="text-dark-500 uppercase tracking-wide font-semibold">Perdeu</p>
            {data.reassignmentHistory.map((v) => (
              <>
                <p key={`n-${v.vendorId}`} className="text-dark-200 py-1">{v.name}</p>
                <p key={`r-${v.vendorId}`} className="text-green-400 font-mono tabular-nums py-1">{v.received}</p>
                <p key={`l-${v.vendorId}`} className="text-red-400 font-mono tabular-nums py-1">{v.lost}</p>
              </>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const ACAO_LABEL: Record<string, string> = {
  transferido: 'Transferido',
  reatribuicao_automatica: 'Reatribuição automática',
  excluido: 'Excluído',
}
const ACAO_COR: Record<string, string> = {
  transferido: 'bg-blue-900/30 text-blue-400',
  reatribuicao_automatica: 'bg-gold-900/30 text-gold-400',
  excluido: 'bg-red-900/30 text-red-400',
}
const BOUNCE_THRESHOLD = 2

function TransferenciasTab() {
  const { data, isLoading } = trpc.leadsRelatorios.transferHistory.useQuery()
  const [filtro, setFiltro] = useState<'todos' | 'transferido' | 'reatribuicao_automatica' | 'excluido'>('todos')

  const autoCountByLead = useMemo(() => {
    const map = new Map<number, number>()
    for (const h of data ?? []) {
      if (h.action === 'reatribuicao_automatica') map.set(h.leadId, (map.get(h.leadId) ?? 0) + 1)
    }
    return map
  }, [data])

  const linhas = (data ?? []).filter((h) => filtro === 'todos' || h.action === filtro)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-dark-800 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['todos', 'reatribuicao_automatica', 'transferido', 'excluido'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              filtro === f ? 'bg-gold-600/20 text-gold-400 border-gold-600/30' : 'bg-dark-800 text-dark-400 border-dark-600 hover:border-gold-600'
            }`}
          >
            {f === 'todos' ? 'Todos' : ACAO_LABEL[f]}
          </button>
        ))}
      </div>

      {linhas.length === 0 ? (
        <p className="text-center text-dark-500 py-12">Nenhum registro para esse filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dark-500 uppercase tracking-wide text-left">
                <th className="pb-2 font-semibold">Quando</th>
                <th className="pb-2 font-semibold">Ação</th>
                <th className="pb-2 font-semibold">Lead</th>
                <th className="pb-2 font-semibold">De</th>
                <th className="pb-2 font-semibold">Para</th>
                <th className="pb-2 font-semibold">Responsável</th>
              </tr>
            </thead>
            <tbody className="text-dark-200">
              {linhas.map((h) => {
                const autoCount = autoCountByLead.get(h.leadId) ?? 0
                const suspeito = h.action === 'reatribuicao_automatica' && autoCount >= BOUNCE_THRESHOLD
                return (
                  <tr key={h.id} className={`border-t border-dark-700 ${suspeito ? 'bg-red-500/5' : ''}`}>
                    <td className="py-2 whitespace-nowrap">{new Date(h.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}</td>
                    <td className="py-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ACAO_COR[h.action] ?? 'bg-dark-700 text-dark-300'}`}>
                        {ACAO_LABEL[h.action] ?? h.action}
                      </span>
                    </td>
                    <td className="py-2">
                      {h.lead?.name ?? `Lead #${h.leadId}`} {h.lead?.phone ? `· ${h.lead.phone}` : ''}
                      {suspeito && (
                        <span
                          title={`Esse lead já foi reatribuído automaticamente ${autoCount}x — pode ser erro no rodízio/SLA`}
                          className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400"
                        >
                          ⚠️ {autoCount}x
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-dark-400">{h.fromVendor?.name ?? '—'}</td>
                    <td className="py-2 text-dark-400">{h.toVendor?.name ?? '—'}</td>
                    <td className="py-2 text-dark-400">{h.user?.name ?? 'Sistema (automático)'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function formatarDias(n: number): string {
  return n > 0 ? `${n.toFixed(1)} dias` : '—'
}

function primeiroDiaMesString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function hojeString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const FUNNEL_COLORS: Record<string, string> = {
  novo: '#3b82f6',
  abordagem: '#eab308',
  qualificado: '#a855f7',
  em_negociacao: '#f97316',
  ganho: '#22c55e',
  perdido: '#ef4444',
  desqualificado: '#71717a',
  consumidor_final: '#0d9de0',
}

function FunilConversao({ funnel, total }: { funnel: { status: string; label: string; count: number; conversionRate: number }[]; total: number }) {
  const base = total || 1
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
      <h3 className="font-heading text-gold-400 font-semibold mb-4">Funil de Conversão</h3>
      <div className="space-y-2">
        {funnel.map((stage) => {
          const pct = Math.round((stage.count / base) * 100)
          return (
            <div key={stage.status} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-right">
                <span className="text-xs font-medium" style={{ color: FUNNEL_COLORS[stage.status] }}>{stage.label}</span>
              </div>
              <div className="flex-1 relative h-8 bg-dark-700 rounded-lg overflow-hidden">
                <div
                  className="h-full rounded-lg transition-all duration-700"
                  style={{ width: `${Math.max(pct, stage.count > 0 ? 4 : 0)}%`, background: FUNNEL_COLORS[stage.status] }}
                />
                <div className="absolute inset-0 flex items-center px-3">
                  <span className="text-xs font-bold text-white drop-shadow">{stage.count}</span>
                </div>
              </div>
              <div className="w-16 shrink-0 text-right">
                <span className="text-xs text-dark-400">{stage.conversionRate.toFixed(1)}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GeralTab() {
  // Sem data escolhida, a tela ficava somando o histórico inteiro e o Funil
  // de Conversão perdia o sentido — padrão agora é o mês corrente.
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesString())
  const [dataFim, setDataFim] = useState(hojeString())
  const { data, isLoading } = trpc.leadsRelatorios.reportGeral.useQuery({
    dataInicio: dataInicio || undefined,
    dataFim: dataFim || undefined,
  })

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3">
        <Input label="Data inicial" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        <Input label="Data final" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
      </div>

      {isLoading || !data ? (
        <p className="text-dark-500">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatTile label="Total de Leads" value={String(data.totalLeads)} />
            <StatTile label="Taxa de Conversão" value={`${data.taxaConversaoPct.toFixed(1)}%`} sub={`${data.totalGanhos} ganhos`} />
            <StatTile label="Taxa de Perda" value={`${data.taxaPerda.toFixed(1)}%`} sub={`${data.totalPerdidosDesqualificados} perdidos/desqualificados`} />
            <StatTile label="Tempo Médio de Fechamento" value={formatarDias(data.tempoMedioFechamentoDias)} sub="da atribuição até o fechamento" />
            <StatTile label="Total de Vendas" value={formatarMoeda(data.totalVendas)} sub="soma dos pedidos ganhos" />
            <StatTile label="Valor em Negociação" value={formatarMoeda(data.valorEmNegociacao)} sub="soma dos pedidos em negociação" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatTile label="Tempo médio até 1º contato" value={formatarHoras(data.tempoMedioPrimeiroContatoHoras)} sub="horas úteis" />
            <StatTile label="Ticket médio" value={formatarMoeda(data.ticketMedio)} sub={`${data.totalGanhos} leads ganhos`} />
            <div className="bg-dark-800 border border-dark-600 border-dashed rounded-2xl p-5">
              <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold">Meta</p>
              <p className="text-2xl font-bold text-dark-500 mt-1">— definir</p>
              <p className="text-xs text-dark-500 mt-0.5">Configure a meta de Leads quando quiser</p>
            </div>
          </div>

          <FunilConversao funnel={data.funnel} total={data.totalLeads} />
        </>
      )}
    </div>
  )
}

// Relatórios de marketing do módulo de Leads — SLA (atraso por vendedor,
// tempo parado, alertas críticos), Histórico de Transferências (com
// detector de "quicando" entre vendedores) e um panorama Geral (timing,
// ticket médio, conversão, valor em negociação). Ver
// server/src/router/leadsRelatorios.ts.
export default function LeadsRelatorios() {
  const [aba, setAba] = useState<Aba>('sla')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Relatórios de Marketing</h1>
        <p className="text-sm text-dark-400 mt-0.5">SLA, transferências e panorama geral dos Leads.</p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-dark-700">
        {ABAS.map((a) => (
          <button
            key={a.value}
            onClick={() => setAba(a.value)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              aba === a.value ? 'border-gold-400 text-gold-400' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'sla' && <SlaTab />}
      {aba === 'transferencias' && <TransferenciasTab />}
      {aba === 'geral' && <GeralTab />}
    </div>
  )
}
