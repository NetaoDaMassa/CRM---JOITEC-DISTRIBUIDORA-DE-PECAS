import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Phone } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { SlaBadge, ReassignedBadge } from '../../components/ui/Badge'
import { timeAgo } from '../../lib/utils'

export default function TodayQueue() {
  const navigate = useNavigate()
  const { data: leads, isLoading } = trpc.leads.todayQueue.useQuery()

  const criticoCount = leads?.filter((l) => l.slaStatus === 'critico').length ?? 0

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Fila de Hoje</h1>
        <p className="text-dark-400 text-sm">Leads em Abordagem que precisam de ação, ordenados por urgência</p>
      </div>

      {criticoCount > 0 && (
        <div className="flex items-center gap-3 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl p-4">
          <AlertTriangle size={18} className="shrink-0" />
          <p className="text-sm font-medium">
            Você tem {criticoCount} lead{criticoCount > 1 ? 's' : ''} crítico{criticoCount > 1 ? 's' : ''}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-dark-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : leads && leads.length > 0 ? (
        <div className="space-y-2">
          {leads.map((lead: any) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/vendedor/leads/${lead.id}`)}
              className="bg-dark-800 border border-dark-600 rounded-xl p-4 cursor-pointer hover:border-gold-600/50 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-medium text-dark-100">{lead.name}</h3>
                    <SlaBadge slaStatus={lead.slaStatus} />
                    {lead.autoReassignedAt && <ReassignedBadge />}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-2">
                    <Phone size={11} />
                    <span>({lead.ddd}) {lead.phone}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-dark-500">
                    <span>parado há {timeAgo(lead.statusChangedAt ?? lead.updatedAt).replace('há ', '')}</span>
                    <span>{lead.attemptCount ?? 0}/3 tentativas</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-dark-500 shrink-0 mt-1" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-8 text-center text-dark-500 text-sm">
          Nenhum lead em Abordagem no momento.
        </div>
      )}
    </div>
  )
}
