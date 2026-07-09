import { useNavigate } from 'react-router-dom'
import { Award, TrendingUp, Clock, AlertCircle, Calendar, Phone } from 'lucide-react'
import { isToday, isPast, addDays, isBefore, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { StatusBadge } from '../../components/ui/Badge'
import { STATUS_ORDER, STATUS_LABELS, timeAgo } from '../../lib/utils'

const FUNNEL_STAGES = [
  { key: 'novo', label: 'Novo', color: 'bg-blue-500', light: 'text-blue-300' },
  { key: 'abordagem', label: 'Abordagem', color: 'bg-yellow-500', light: 'text-yellow-300' },
  { key: 'qualificado', label: 'Qualificado', color: 'bg-purple-500', light: 'text-purple-300' },
  { key: 'em_negociacao', label: 'Em Negociação', color: 'bg-orange-500', light: 'text-orange-300' },
  { key: 'ganho', label: 'Ganho', color: 'bg-green-500', light: 'text-green-300' },
]

export default function VendorDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: stats } = trpc.leads.stats.useQuery()
  const { data: leadsData } = trpc.leads.list.useQuery({ page: 1, pageSize: 200 })

  const leads = leadsData?.data ?? []

  const requiresAttachment = leads.filter((l) => l.requiresAttachment)

  const todayContacts = leads.filter((l) => {
    if (!l.nextContactAt) return false
    return isToday(new Date(l.nextContactAt))
  })

  const overdueContacts = leads.filter((l) => {
    if (!l.nextContactAt) return false
    if (['ganho', 'perdido', 'desqualificado'].includes(l.status)) return false
    const d = new Date(l.nextContactAt)
    d.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return d < today
  })

  const upcomingContacts = leads.filter((l) => {
    if (!l.nextContactAt) return false
    if (['ganho', 'perdido', 'desqualificado'].includes(l.status)) return false
    const d = new Date(l.nextContactAt)
    d.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const in7 = addDays(today, 7)
    return d > today && isBefore(d, in7)
  }).sort((a, b) => new Date(a.nextContactAt!).getTime() - new Date(b.nextContactAt!).getTime())

  const topCount = stats?.byStatus?.['novo'] ?? 1

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Bem-vindo, {user?.name}!</h1>
        <p className="text-dark-400 text-sm">Seus leads e agenda de hoje</p>
      </div>

      {/* Alerts */}
      <div className="space-y-2">
        {overdueContacts.length > 0 && (
          <div
            onClick={() => navigate('/vendedor/calendario')}
            className="bg-red-900/20 border border-red-700/40 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-red-900/30 transition-colors"
          >
            <AlertCircle className="text-red-400 shrink-0" size={16} />
            <p className="text-red-400 text-sm flex-1">
              <span className="font-semibold">{overdueContacts.length} contato{overdueContacts.length > 1 ? 's' : ''} vencido{overdueContacts.length > 1 ? 's' : ''}</span>
              {' '}— clique para ver no calendário
            </p>
          </div>
        )}
        {requiresAttachment.length > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3 flex items-center gap-3">
            <AlertCircle className="text-yellow-500 shrink-0" size={16} />
            <p className="text-yellow-400 text-sm">
              <span className="font-semibold">{requiresAttachment.length} lead{requiresAttachment.length > 1 ? 's requerem' : ' requer'} anexo</span>
              {' '}obrigatório (2+ follow-ups sem avanço)
            </p>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Meus Leads', value: stats?.total ?? 0, icon: TrendingUp, color: 'text-blue-400' },
          { label: 'Em Negociação', value: stats?.byStatus?.em_negociacao ?? 0, icon: Clock, color: 'text-orange-400' },
          { label: 'Ganhos', value: stats?.byStatus?.ganho ?? 0, icon: Award, color: 'text-green-400' },
          { label: 'Conversão', value: `${stats?.conversion ?? 0}%`, icon: TrendingUp, color: 'text-gold-400' },
        ].map((s) => (
          <div key={s.label} className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-dark-400 text-xs">{s.label}</span>
              <s.icon size={16} className={s.color} />
            </div>
            <div className="font-heading text-2xl font-bold text-dark-100">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Funil do vendedor */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <h3 className="font-heading text-gold-400 font-semibold mb-4">Meu Funil</h3>
          <div className="space-y-2">
            {FUNNEL_STAGES.map((stage) => {
              const count = stats?.byStatus?.[stage.key] ?? 0
              const pct = topCount > 0 ? Math.round((count / topCount) * 100) : 0
              return (
                <button
                  key={stage.key}
                  onClick={() => navigate('/vendedor/leads')}
                  className="w-full flex items-center gap-3 hover:opacity-80 transition-opacity"
                >
                  <span className={`text-xs w-24 text-right shrink-0 ${stage.light}`}>{stage.label}</span>
                  <div className="flex-1 h-6 bg-dark-700 rounded-lg overflow-hidden relative">
                    <div
                      className={`h-full ${stage.color} opacity-80 rounded-lg transition-all duration-500`}
                      style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-xs font-bold text-white">
                      {count}
                    </span>
                  </div>
                  <span className="text-xs text-dark-500 w-8 text-right shrink-0">{pct}%</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Agenda */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-gold-400" />
              <h3 className="font-heading text-gold-400 font-semibold">Agenda</h3>
            </div>
            <button
              onClick={() => navigate('/vendedor/calendario')}
              className="text-xs text-gold-500 hover:text-gold-400 transition-colors"
            >
              Ver calendário →
            </button>
          </div>

          {todayContacts.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-orange-400 mb-2 uppercase tracking-wide">Hoje</p>
              <div className="space-y-1.5">
                {todayContacts.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`/vendedor/leads/${lead.id}`)}
                    className="flex items-center gap-2 p-2 bg-orange-900/15 border border-orange-700/30 rounded-lg cursor-pointer hover:bg-orange-900/25 transition-colors"
                  >
                    <Phone size={12} className="text-orange-400 shrink-0" />
                    <span className="text-sm text-dark-100 flex-1 truncate">{lead.name}</span>
                    <StatusBadge status={lead.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {upcomingContacts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-dark-400 mb-2 uppercase tracking-wide">Próximos 7 dias</p>
              <div className="space-y-1.5 overflow-y-auto max-h-48">
                {upcomingContacts.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`/vendedor/leads/${lead.id}`)}
                    className="flex items-center gap-2 p-2 bg-dark-700/50 rounded-lg cursor-pointer hover:bg-dark-700 transition-colors"
                  >
                    <Calendar size={12} className="text-gold-500 shrink-0" />
                    <span className="text-sm text-dark-100 flex-1 truncate">{lead.name}</span>
                    <span className="text-xs text-gold-500 shrink-0">
                      {format(new Date(lead.nextContactAt!), "d MMM", { locale: ptBR })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {todayContacts.length === 0 && upcomingContacts.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-dark-600 gap-2">
              <Calendar size={28} className="text-dark-700" />
              <span className="text-sm text-dark-500">Sem contatos agendados</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent leads */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-gold-400 font-semibold">Leads Recentes</h3>
          <button
            onClick={() => navigate('/vendedor/leads')}
            className="text-sm text-gold-500 hover:text-gold-400 transition-colors"
          >
            Ver todos →
          </button>
        </div>
        <div className="space-y-2">
          {leads.slice(0, 6).map((lead) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/vendedor/leads/${lead.id}`)}
              className="flex items-center justify-between p-3 bg-dark-700/50 rounded-xl hover:bg-dark-700 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                {lead.requiresAttachment && (
                  <AlertCircle size={14} className="text-yellow-500 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-dark-100">{lead.name}</p>
                  <p className="text-xs text-dark-400">({lead.ddd}) {lead.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={lead.status} />
                <span className="text-xs text-dark-500">{timeAgo(lead.createdAt)}</span>
              </div>
            </div>
          ))}
          {leads.length === 0 && (
            <p className="text-center text-dark-500 py-8">Nenhum lead atribuído ainda</p>
          )}
        </div>
      </div>
    </div>
  )
}
