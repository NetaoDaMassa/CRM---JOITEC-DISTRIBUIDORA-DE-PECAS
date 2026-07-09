import { useNavigate } from 'react-router-dom'
import { Phone, Building2, Calendar, AlertCircle, ChevronRight } from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import WhatsAppButton from './ui/WhatsAppButton'
import EmailButton from './ui/EmailButton'
import { STATUS_LABELS, STATUS_ORDER, TERMINAL_STATUSES, formatDate, SEGMENT_LABELS } from '../lib/utils'

const FINAL_STATUSES = TERMINAL_STATUSES

interface KanbanBoardProps {
  leads: any[]
  isAdmin?: boolean
  basePath?: string
}

function getContactUrgency(nextContactAt: string, status: string) {
  if (FINAL_STATUSES.includes(status)) return null
  const d = new Date(nextContactAt)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff < 0) return { label: 'VENCIDO', classes: 'bg-red-500/15 text-red-400 border border-red-500/30', dot: 'bg-red-500' }
  if (diff === 0) return { label: 'HOJE', classes: 'bg-orange-500/15 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500' }
  if (diff === 1) return { label: 'AMANHÃ', classes: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30', dot: 'bg-yellow-500' }
  return { label: null, classes: 'bg-gold-500/10 text-gold-500 border border-gold-500/20', dot: 'bg-gold-500' }
}

export default function KanbanBoard({ leads, isAdmin = false, basePath = '' }: KanbanBoardProps) {
  const navigate = useNavigate()

  const columns = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    leads: leads.filter((l) => l.status === status),
  }))

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
      {columns.map(({ status, label, leads: colLeads }) => (
        <div
          key={status}
          className="shrink-0 w-72 flex flex-col"
        >
          {/* Column header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={status} />
              <span className="text-dark-400 text-xs font-medium">{colLeads.length}</span>
            </div>
          </div>

          {/* Cards */}
          <div className="flex-1 space-y-2 min-h-24">
            {colLeads.map((lead) => {
              const urgency = lead.nextContactAt
                ? getContactUrgency(lead.nextContactAt, lead.status)
                : null

              return (
                <div
                  key={lead.id}
                  onClick={() => navigate(`${basePath}/leads/${lead.id}`)}
                  className={`
                    bg-dark-800 border rounded-xl p-3 cursor-pointer
                    hover:border-gold-600/50 transition-all group
                    ${lead.requiresAttachment ? 'border-yellow-600/50' : urgency?.label === 'VENCIDO' ? 'border-red-600/30' : 'border-dark-600'}
                  `}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">
                      {lead.name}
                    </h4>
                    <ChevronRight size={14} className="text-dark-500 shrink-0 mt-0.5" />
                  </div>

                  {lead.company && (
                    <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
                      <Building2 size={11} />
                      <span className="truncate">{lead.company}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-dark-400">
                      <Phone size={11} />
                      <span>({lead.ddd}) {lead.phone}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {lead.email && <EmailButton email={lead.email} size="sm" />}
                      <WhatsAppButton ddd={lead.ddd} phone={lead.phone} size="sm" />
                    </div>
                  </div>

                  {lead.segment && lead.segment !== 'outros' && (
                    <div className="text-xs text-dark-500 mb-2">
                      {SEGMENT_LABELS[lead.segment]}
                    </div>
                  )}

                  {isAdmin && lead.vendor && (
                    <div className="mb-2">
                      <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full truncate max-w-full inline-block">
                        {lead.vendor.name}
                      </span>
                    </div>
                  )}

                  {/* Next contact date — destaque visual */}
                  {lead.nextContactAt && urgency && (
                    <div className={`flex items-center justify-between px-2 py-1.5 rounded-lg mt-1 ${urgency.classes}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${urgency.dot}`} />
                        <Calendar size={11} />
                        <span className="text-xs font-medium">{formatDate(lead.nextContactAt)}</span>
                      </div>
                      {urgency.label && (
                        <span className="text-xs font-bold tracking-wide">{urgency.label}</span>
                      )}
                    </div>
                  )}

                  {lead.requiresAttachment && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-yellow-500">
                      <AlertCircle size={11} />
                      Anexo obrigatório
                    </div>
                  )}
                </div>
              )
            })}

            {colLeads.length === 0 && (
              <div className="h-24 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                Nenhum lead nesta etapa
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
