import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, TrendingUp, Users, Target, Award, RefreshCw } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/Badge'
import QuickLeadCreate from '../../components/QuickLeadCreate'
import { STATUS_LABELS, STATUS_ORDER, timeAgo } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'

function StatCard({ label, value, sub, icon: Icon, color }: any) {
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

const FUNNEL_STAGES = [
  { key: 'novo', label: 'Novo', color: 'from-blue-600 to-blue-500', text: 'text-blue-300' },
  { key: 'abordagem', label: 'Abordagem', color: 'from-yellow-600 to-yellow-500', text: 'text-yellow-300' },
  { key: 'qualificado', label: 'Qualificado', color: 'from-purple-600 to-purple-500', text: 'text-purple-300' },
  { key: 'em_negociacao', label: 'Em Negociação', color: 'from-orange-600 to-orange-500', text: 'text-orange-300' },
  { key: 'ganho', label: 'Ganho', color: 'from-green-600 to-green-500', text: 'text-green-300' },
]

function SalesFunnel({ byStatus }: { byStatus: Record<string, number> }) {
  const top = byStatus['novo'] ?? 1
  const exits = (byStatus['perdido'] ?? 0) + (byStatus['desqualificado'] ?? 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-gold-400 font-semibold">Funil de Vendas</h3>
        {exits > 0 && (
          <span className="text-xs text-dark-500">
            {exits} saída{exits > 1 ? 's' : ''} (perdido/desqualificado)
          </span>
        )}
      </div>

      <div className="space-y-2">
        {FUNNEL_STAGES.map((stage, i) => {
          const count = byStatus[stage.key] ?? 0
          const pct = top > 0 ? Math.round((count / top) * 100) : 0
          // Bar width: clamp between 20% and 100%, narrowing as funnel progresses
          const maxWidth = 100 - i * 10
          const barWidth = Math.max(pct * maxWidth / 100, count > 0 ? 8 : 0)
          const prevCount = i > 0 ? (byStatus[FUNNEL_STAGES[i - 1].key] ?? 0) : null
          const convRate = prevCount && prevCount > 0 ? Math.round((count / prevCount) * 100) : null

          return (
            <div key={stage.key}>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-28 shrink-0 text-right">
                  <span className={`text-xs font-medium ${stage.text}`}>{stage.label}</span>
                </div>
                <div className="flex-1 relative h-8 bg-dark-700 rounded-lg overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${stage.color} rounded-lg transition-all duration-700`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-3">
                    <span className="text-xs font-bold text-white drop-shadow">
                      {count}
                    </span>
                  </div>
                </div>
                <div className="w-16 shrink-0 text-right">
                  <span className="text-xs text-dark-400">{pct}%</span>
                  {convRate !== null && convRate < 100 && i > 0 && (
                    <div className="text-xs text-dark-600">↓{convRate}%</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Exit indicator */}
      {exits > 0 && (
        <div className="mt-3 pt-3 border-t border-dark-700 flex gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs text-dark-500">Perdido: {byStatus['perdido'] ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-xs text-dark-500">Desqualificado: {byStatus['desqualificado'] ?? 0}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: stats } = trpc.leads.stats.useQuery()
  const { data: leadsData } = trpc.leads.list.useQuery({ page: 1, pageSize: 8 })
  const { data: roundRobin } = trpc.regions.roundRobinStatus.useQuery()

  const recentLeads = leadsData?.data ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Dashboard</h1>
          <p className="text-dark-400 text-sm mt-0.5">Visão geral do CRM · {user?.companyName}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          Novo Lead
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total de Leads"
          value={stats?.total ?? 0}
          icon={Users}
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          label="Em Negociação"
          value={stats?.byStatus?.em_negociacao ?? 0}
          sub="leads ativos"
          icon={TrendingUp}
          color="bg-orange-500/20 text-orange-400"
        />
        <StatCard
          label="Ganhos"
          value={stats?.byStatus?.ganho ?? 0}
          sub="conversões"
          icon={Award}
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          label="Taxa de Conversão"
          value={`${stats?.conversion ?? 0}%`}
          sub="leads ganhos / total"
          icon={Target}
          color="bg-gold-600/20 text-gold-400"
        />
      </div>

      {/* Funnel + Sidebar */}
      <div className="grid grid-cols-3 gap-6">
        {/* Funil visual — ocupa 2 colunas */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 col-span-2">
          <SalesFunnel byStatus={stats?.byStatus ?? {}} />
        </div>

        {/* Rodízio */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw size={16} className="text-gold-400" />
            <h3 className="font-heading text-gold-400 font-semibold">Próximo no Rodízio</h3>
          </div>
          <div className="space-y-3">
            {roundRobin?.map((r) => (
              <div key={r.regionId} className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-dark-400">{r.regionName}</div>
                  <div className="text-sm text-dark-100 font-medium">
                    {r.nextVendor?.name ?? 'Sem vendedor'}
                  </div>
                </div>
                <div className="text-xs text-dark-500">#{r.nextIndex + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leads por vendedor */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h3 className="font-heading text-gold-400 font-semibold mb-4">Performance por Vendedor</h3>
        <div className="space-y-3">
          {Object.entries(stats?.byVendor ?? {})
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([name, count]) => {
              const total = stats?.total ?? 1
              const pct = Math.round(((count as number) / total) * 100)
              return (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gold-700/30 border border-gold-600/30 flex items-center justify-center text-gold-400 text-xs font-semibold">
                        {name.charAt(0)}
                      </div>
                      <span className="text-sm text-dark-200">{name}</span>
                    </div>
                    <span className="text-gold-400 font-semibold text-sm">{count as number}</span>
                  </div>
                  <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden ml-9">
                    <div
                      className="h-full bg-gold-600 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          {Object.keys(stats?.byVendor ?? {}).length === 0 && (
            <p className="text-dark-500 text-sm">Nenhum lead ainda</p>
          )}
        </div>
      </div>

      {/* Recent leads */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-gold-400 font-semibold">Leads Recentes</h3>
          <button
            onClick={() => navigate('/admin/leads')}
            className="text-sm text-gold-500 hover:text-gold-400 transition-colors"
          >
            Ver todos →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600">
                {['Nome', 'DDD/Tel', 'Status', 'Vendedor', 'Criado'].map((h) => (
                  <th key={h} className="text-left text-dark-400 font-medium pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {recentLeads.map((lead: any) => (
                <tr
                  key={lead.id}
                  onClick={() => navigate(`/admin/leads/${lead.id}`)}
                  className="hover:bg-dark-700/50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 pr-4 text-dark-100 font-medium">{lead.name}</td>
                  <td className="py-2.5 pr-4 text-dark-400">({lead.ddd}) {lead.phone}</td>
                  <td className="py-2.5 pr-4"><StatusBadge status={lead.status} /></td>
                  <td className="py-2.5 pr-4 text-dark-300">{lead.vendor?.name ?? '—'}</td>
                  <td className="py-2.5 text-dark-500">{timeAgo(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentLeads.length === 0 && (
            <p className="text-center text-dark-500 py-8">Nenhum lead cadastrado ainda</p>
          )}
        </div>
      </div>

      <QuickLeadCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
