import { useState } from 'react'
import {
  Download, FileSpreadsheet, TrendingUp, Target, Clock, TrendingDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { downloadBase64Excel, STATUS_LABELS, STATUS_ORDER } from '../../lib/utils'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

const PALETTE = ['#24aff4', '#22c55e', '#a855f7', '#f97316', '#eab308', '#ef4444', '#71717a', '#0d9de0', '#65bdf5']

const FUNNEL_COLORS: Record<string, string> = {
  novo: '#3b82f6',
  abordagem: '#eab308',
  qualificado: '#a855f7',
  em_negociacao: '#f97316',
  ganho: '#22c55e',
  perdido: '#ef4444',
  desqualificado: '#71717a',
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`
}

function fmtDays(n: number) {
  return n > 0 ? `${n.toFixed(1)} dias` : '—'
}

function KpiCard({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-dark-400 text-sm">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="font-heading text-3xl font-bold text-dark-100">{value}</div>
      {sub && <div className="text-dark-400 text-xs mt-1">{sub}</div>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
      <h3 className="font-heading text-gold-400 font-semibold mb-4">{title}</h3>
      {children}
    </div>
  )
}

const chartTooltipStyle = {
  contentStyle: { background: '#111e2d', border: '1px solid #2b3d52', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#dce5ee' },
  itemStyle: { color: '#dce5ee' },
}

function ConversionFunnel({ funnel }: { funnel: any[] }) {
  const top = funnel.find((f) => f.status === 'novo')?.count || 1
  return (
    <div className="space-y-2">
      {funnel.map((stage) => {
        const pct = top > 0 ? Math.round((stage.count / top) * 100) : 0
        return (
          <div key={stage.status} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <span className="text-xs font-medium" style={{ color: FUNNEL_COLORS[stage.status] }}>
                {stage.label}
              </span>
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
            <div className="w-20 shrink-0 text-right">
              {stage.conversionRate !== null ? (
                <span className="text-xs text-dark-400">{fmtPct(stage.conversionRate)}</span>
              ) : (
                <span className="text-xs text-dark-600">—</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminReports() {
  const [vendorId, setVendorId] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: vendors } = trpc.users.vendors.useQuery()
  const { data: analytics } = trpc.reports.analytics.useQuery({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  })

  const exportMut = trpc.reports.exportLeads.useMutation({
    onSuccess(data) {
      downloadBase64Excel(data.data, data.filename)
      toast.success(`${data.count} leads exportados com sucesso!`)
    },
    onError(err) { toast.error(err.message) },
  })

  const vendorOptions = [
    { value: '', label: 'Todos os vendedores' },
    ...(vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []),
  ]

  const kpis = analytics?.kpis

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Relatórios</h1>
          <p className="text-dark-400 text-sm">Análises de marketing e performance de vendas</p>
        </div>
        <div className="flex items-end gap-3">
          <Input
            label="Data inicial"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            label="Data final"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Total de Leads"
          value={kpis?.total ?? 0}
          icon={Target}
          color="bg-blue-500/20 text-blue-400"
        />
        <KpiCard
          label="Taxa de Conversão"
          value={fmtPct(kpis?.taxaConversao ?? 0)}
          sub={`${kpis?.ganhos ?? 0} ganhos`}
          icon={TrendingUp}
          color="bg-green-500/20 text-green-400"
        />
        <KpiCard
          label="Taxa de Perda"
          value={fmtPct(kpis?.taxaPerda ?? 0)}
          sub={`${(kpis?.perdidos ?? 0) + (kpis?.desqualificados ?? 0)} perdidos/desqualificados`}
          icon={TrendingDown}
          color="bg-red-500/20 text-red-400"
        />
        <KpiCard
          label="Tempo Médio de Fechamento"
          value={fmtDays(kpis?.tempoMedioFechamentoDias ?? 0)}
          sub="da criação até o fechamento"
          icon={Clock}
          color="bg-gold-600/20 text-gold-400"
        />
      </div>

      {/* Funil de conversão */}
      <Card title="Funil de Conversão">
        <ConversionFunnel funnel={analytics?.funnel ?? []} />
      </Card>

      {/* Evolução mensal */}
      <Card title="Evolução Mensal — Leads Gerados x Ganhos">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={analytics?.monthlyTrend ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2b3d52" />
            <XAxis dataKey="month" stroke="#6580a0" fontSize={12} />
            <YAxis stroke="#6580a0" fontSize={12} allowDecimals={false} />
            <Tooltip {...chartTooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="total" name="Leads gerados" stroke="#24aff4" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ganho" name="Ganhos" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="perdido" name="Perdidos" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
        {(analytics?.monthlyTrend?.length ?? 0) === 0 && (
          <p className="text-dark-500 text-sm text-center py-4">Sem dados suficientes ainda</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-6">
        {/* Performance por campanha */}
        <Card title="Performance por Campanha">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={analytics?.byCampaign ?? []} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3d52" horizontal={false} />
              <XAxis type="number" stroke="#6580a0" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="#6580a0" fontSize={11} width={110} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="total" name="Leads" fill="#24aff4" radius={[0, 4, 4, 0]} />
              <Bar dataKey="ganho" name="Ganhos" fill="#22c55e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-600 text-dark-400">
                  <th className="text-left py-1.5 pr-2 font-medium">Campanha</th>
                  <th className="text-left py-1.5 pr-2 font-medium">Canal</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Leads</th>
                  <th className="text-right py-1.5 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {(analytics?.byCampaign ?? []).map((c) => (
                  <tr key={c.name}>
                    <td className="py-1.5 pr-2 text-dark-100">{c.name}</td>
                    <td className="py-1.5 pr-2 text-dark-400">{c.channelLabel}</td>
                    <td className="py-1.5 pr-2 text-right text-dark-200">{c.total}</td>
                    <td className="py-1.5 text-right text-gold-400 font-medium">{fmtPct(c.taxaConversao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Performance por canal */}
        <Card title="Distribuição por Canal">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={analytics?.byChannel ?? []}
                dataKey="total"
                nameKey="channelLabel"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(d: any) => `${d.channelLabel} (${d.total})`}
                labelLine={false}
                fontSize={11}
              >
                {(analytics?.byChannel ?? []).map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...chartTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-600 text-dark-400">
                  <th className="text-left py-1.5 pr-2 font-medium">Canal</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Leads</th>
                  <th className="text-right py-1.5 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {(analytics?.byChannel ?? []).map((c) => (
                  <tr key={c.channel}>
                    <td className="py-1.5 pr-2 text-dark-100">{c.channelLabel}</td>
                    <td className="py-1.5 pr-2 text-right text-dark-200">{c.total}</td>
                    <td className="py-1.5 text-right text-gold-400 font-medium">{fmtPct(c.taxaConversao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Performance por vendedor */}
        <Card title="Performance por Vendedor">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={analytics?.byVendor ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3d52" />
              <XAxis dataKey="name" stroke="#6580a0" fontSize={11} />
              <YAxis stroke="#6580a0" fontSize={12} allowDecimals={false} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="total" name="Leads" fill="#24aff4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ganho" name="Ganhos" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-600 text-dark-400">
                  <th className="text-left py-1.5 pr-2 font-medium">Vendedor</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Leads</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Conversão</th>
                  <th className="text-right py-1.5 font-medium">Tempo médio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {(analytics?.byVendor ?? []).map((v) => (
                  <tr key={v.name}>
                    <td className="py-1.5 pr-2 text-dark-100">{v.name}</td>
                    <td className="py-1.5 pr-2 text-right text-dark-200">{v.total}</td>
                    <td className="py-1.5 pr-2 text-right text-gold-400 font-medium">{fmtPct(v.taxaConversao)}</td>
                    <td className="py-1.5 text-right text-dark-300">{fmtDays(v.tempoMedioFechamentoDias)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Performance por região */}
        <Card title="Performance por Região">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={analytics?.byRegion ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3d52" />
              <XAxis dataKey="name" stroke="#6580a0" fontSize={11} />
              <YAxis stroke="#6580a0" fontSize={12} allowDecimals={false} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="total" name="Leads" fill="#24aff4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ganho" name="Ganhos" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-600 text-dark-400">
                  <th className="text-left py-1.5 pr-2 font-medium">Região</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Leads</th>
                  <th className="text-right py-1.5 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {(analytics?.byRegion ?? []).map((r) => (
                  <tr key={r.name}>
                    <td className="py-1.5 pr-2 text-dark-100">{r.name}</td>
                    <td className="py-1.5 pr-2 text-right text-dark-200">{r.total}</td>
                    <td className="py-1.5 text-right text-gold-400 font-medium">{fmtPct(r.taxaConversao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Análise de perdas */}
      <div className="grid grid-cols-2 gap-6">
        <Card title="Análise de Perdas por Segmento">
          {(analytics?.lossBySegment?.length ?? 0) > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={analytics?.lossBySegment ?? []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(d: any) => `${d.name} (${d.value})`}
                  labelLine={false}
                  fontSize={11}
                >
                  {(analytics?.lossBySegment ?? []).map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-dark-500 text-sm text-center py-8">Nenhum lead perdido/desqualificado no período</p>
          )}
        </Card>

        <Card title="Análise de Perdas por Canal">
          {(analytics?.lossByChannel?.length ?? 0) > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={analytics?.lossByChannel ?? []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(d: any) => `${d.name} (${d.value})`}
                  labelLine={false}
                  fontSize={11}
                >
                  {(analytics?.lossByChannel ?? []).map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-dark-500 text-sm text-center py-8">Nenhum lead perdido/desqualificado no período</p>
          )}
        </Card>
      </div>

      {/* Exportar Excel */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 space-y-5 max-w-2xl">
        <div className="flex items-center gap-3 mb-2">
          <FileSpreadsheet className="text-green-400" size={20} />
          <h2 className="font-heading text-gold-400 font-semibold">Exportar Leads para Excel</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Vendedor"
            options={vendorOptions}
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          />
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>

        <Button
          size="lg"
          className="w-full"
          loading={exportMut.isPending}
          onClick={() => exportMut.mutate({
            vendorId: vendorId ? parseInt(vendorId) : undefined,
            status: status || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          })}
        >
          <Download size={16} />
          Exportar Excel
        </Button>
      </div>
    </div>
  )
}
