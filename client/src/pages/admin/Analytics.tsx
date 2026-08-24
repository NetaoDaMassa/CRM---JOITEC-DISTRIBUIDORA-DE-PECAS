import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import { hojeBrString } from '../../lib/utils'

const COR_GRID = '#2a3644'
const COR_TICK = '#898781'
const COR_VISITANTES = '#3987e5'
const COR_PAGE_VIEWS = '#199e70'
const COR_LEADS = '#d95926'

function trintaDiasAtrasString(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function formatarSegundos(s: number | null): string {
  if (s === null || s === undefined) return '—'
  const min = Math.floor(s / 60)
  const seg = Math.round(s % 60)
  return min > 0 ? `${min}min ${seg}s` : `${seg}s`
}

function TooltipPadrao({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg max-w-[240px]">
      {label && <p className="text-dark-100 font-medium mb-1 truncate">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
      <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums text-dark-50 mt-1">{value}</p>
      {sub && <p className="text-xs text-dark-500 mt-0.5">{sub}</p>}
    </div>
  )
}

type Resumo = {
  companyName: string
  totalVisitors: number
  totalPageViews: number
  topPages: { url: string; title: string | null; views: number }[]
  clicksByType: { trackId: string; count: number }[]
  whatsappClicks: number
  avgTimeOnPageSeconds: number | null
  bounceRate: number
  leads: number
  leadsBySource: { campaign: string; source: string | null; visitors: number; leads: number }[]
}

function ResumoView({ resumo }: { resumo: Resumo }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Visitantes" value={resumo.totalVisitors.toLocaleString('pt-BR')} />
        <StatCard label="Páginas vistas" value={resumo.totalPageViews.toLocaleString('pt-BR')} />
        <StatCard label="Leads" value={resumo.leads.toLocaleString('pt-BR')} />
        <StatCard label="Cliques WhatsApp" value={resumo.whatsappClicks.toLocaleString('pt-BR')} />
        <StatCard label="Tempo médio na página" value={formatarSegundos(resumo.avgTimeOnPageSeconds)} />
        <StatCard label="Taxa de rejeição" value={`${resumo.bounceRate.toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Páginas mais visitadas</p>
          {resumo.topPages.length === 0 ? (
            <p className="text-xs text-dark-500">Sem dados no período.</p>
          ) : (
            <div className="space-y-2">
              {resumo.topPages.map((p) => (
                <div key={p.url} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-dark-200 truncate">{p.title || p.url}</p>
                    <p className="text-dark-500 truncate">{p.url}</p>
                  </div>
                  <span className="font-mono tabular-nums text-dark-100 shrink-0">{p.views.toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Cliques por botão</p>
          {resumo.clicksByType.length === 0 ? (
            <p className="text-xs text-dark-500">Sem dados no período.</p>
          ) : (
            <div className="space-y-2">
              {resumo.clicksByType.map((c) => (
                <div key={c.trackId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-dark-200 truncate">{c.trackId}</span>
                  <span className="font-mono tabular-nums text-dark-100 shrink-0">{c.count.toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <p className="text-sm font-semibold text-dark-100 mb-3">Leads por origem</p>
        {resumo.leadsBySource.length === 0 ? (
          <p className="text-xs text-dark-500">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-dark-500 uppercase tracking-wide text-left">
                  <th className="pb-2 font-semibold">Campanha</th>
                  <th className="pb-2 font-semibold">Origem</th>
                  <th className="pb-2 font-semibold text-right">Visitantes</th>
                  <th className="pb-2 font-semibold text-right">Leads</th>
                </tr>
              </thead>
              <tbody className="text-dark-200">
                {resumo.leadsBySource.map((l) => (
                  <tr key={`${l.campaign}-${l.source}`} className="border-t border-dark-700">
                    <td className="py-1.5">{l.campaign}</td>
                    <td className="py-1.5 text-dark-400">{l.source || '—'}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{l.visitors.toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{l.leads.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function SerieChart({ serie }: { serie: { date: string; pageViews: number; visitors: number; leads: number }[] }) {
  if (serie.length === 0) return null
  const dados = serie.map((d) => ({ ...d, dataLabel: new Date(`${d.date}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }))

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 mb-6">
      <p className="text-sm font-semibold text-dark-100 mb-3">Visitas e leads ao longo do período</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={dados} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
          <XAxis dataKey="dataLabel" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipPadrao
                  active={active}
                  label={String(label)}
                  payload={[
                    { name: 'Visitantes', value: payload.find((p) => p.dataKey === 'visitors')?.value as number, color: COR_VISITANTES },
                    { name: 'Páginas vistas', value: payload.find((p) => p.dataKey === 'pageViews')?.value as number, color: COR_PAGE_VIEWS },
                    { name: 'Leads', value: payload.find((p) => p.dataKey === 'leads')?.value as number, color: COR_LEADS },
                  ]}
                />
              ) : null
            }
          />
          <Line type="monotone" dataKey="visitors" name="Visitantes" stroke={COR_VISITANTES} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="pageViews" name="Páginas vistas" stroke={COR_PAGE_VIEWS} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="leads" name="Leads" stroke={COR_LEADS} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Comparativo entre as empresas com tracker de marketing instalado — só
// superAdmin, mesma ideia do Painel Financeiro (ver SLUGS_COM_ANALYTICS_MARKETING
// em server/src/lib/marketingCrm.ts e o comentário em integracoes.ts).
function ComparativoEmpresas({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { data, isLoading } = trpc.integracoes.analyticsResumoTodasEmpresas.useQuery({ dateFrom, dateTo })

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  if (!data?.length) return <p className="text-dark-500 text-sm">Nenhuma empresa com analytics configurado.</p>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {data.map(({ empresaId, empresaNome, resumo }) => (
        <div key={empresaId} className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">{empresaNome}</p>
          {!resumo ? (
            <p className="text-xs text-dark-500">Sem dados (integração não configurada nesse período).</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold font-mono tabular-nums text-dark-50">{resumo.totalVisitors.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide">Visitantes</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono tabular-nums text-dark-50">{resumo.leads.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide">Leads</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono tabular-nums text-dark-50">{resumo.whatsappClicks.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide">Cliques WhatsApp</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono tabular-nums text-dark-50">{resumo.bounceRate.toFixed(1)}%</p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wide">Rejeição</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Tela de Analytics de Marketing — mostra o desempenho do site institucional
// (visitas, cliques, leads) puxando do CRM de marketing (odin-tubos-crm),
// via integracoesRouter (server/src/router/integracoes.ts). Só aparece pra
// quem tem a feature 'marketing_analytics' liberada (ver Sidebar.tsx/permissoes.ts).
export default function Analytics() {
  const { user } = useAuth()
  const [dataInicio, setDataInicio] = useState(trintaDiasAtrasString())
  const [dataFim, setDataFim] = useState(hojeBrString())
  const [verTodasEmpresas, setVerTodasEmpresas] = useState(false)

  const { data: resumo, isLoading: carregandoResumo } = trpc.integracoes.analyticsResumo.useQuery({ dateFrom: dataInicio, dateTo: dataFim })
  const { data: serie } = trpc.integracoes.analyticsSerieDiaria.useQuery({ dateFrom: dataInicio, dateTo: dataFim })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Analytics</h1>
          <p className="text-sm text-dark-400 mt-0.5">Desempenho do site institucional — visitas, cliques e leads.</p>
        </div>
        <div className="flex items-end gap-3">
          <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          {user?.superAdmin && (
            <button
              onClick={() => setVerTodasEmpresas((v) => !v)}
              className={`text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                verTodasEmpresas ? 'bg-gold-400 text-dark-950 border-gold-400' : 'bg-dark-800 text-dark-300 border-dark-600 hover:border-gold-600'
              }`}
            >
              Comparar empresas
            </button>
          )}
        </div>
      </div>

      {verTodasEmpresas && user?.superAdmin ? (
        <ComparativoEmpresas dateFrom={dataInicio} dateTo={dataFim} />
      ) : carregandoResumo ? (
        <p className="text-dark-500">Carregando...</p>
      ) : !resumo ? (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 text-center">
          <p className="text-dark-300 font-medium">Integração de analytics não configurada pra essa empresa.</p>
          <p className="text-xs text-dark-500 mt-1">
            Fale com o administrador — precisa configurar MARKETING_CRM_URL/MARKETING_CRM_API_KEY no servidor.
          </p>
        </div>
      ) : (
        <>
          <SerieChart serie={serie?.serie || []} />
          <ResumoView resumo={resumo} />
        </>
      )}
    </div>
  )
}
