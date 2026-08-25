import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Calendar, ChevronRight, AlertCircle, Repeat2, Phone } from 'lucide-react'
import { formatElapsed, timeAgo } from '../lib/utils'
import { WhatsappButton } from './ui/ContatoButtons'
import EmailButton from './ui/EmailButton'
import { Badge } from './ui/Badge'
import {
  LEAD_STATUS_VALUES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_TERMINAL_STATUSES,
  LEAD_CLOSING_LABELS,
  LEAD_NEGOTIATION_TAG_CARD_CLASSES,
  isLeadStatusAllowedForEmpresa,
  getLeadContactUrgency,
  leadTelefoneCompleto,
  leadTelefoneFormatado,
} from '../lib/leadsShared'

type LeadCard = {
  id: number
  name: string
  phone: string
  ddd: number
  email: string | null
  company: string | null
  status: string
  negotiationTag: string | null
  nextContactAt: string | null
  createdAt: string
  updatedAt: string
  statusChangedAt: string | null
  requiresAttachment: boolean
  finalConsumerReason: string | null
  vendor?: { name: string } | null
  fromSite?: boolean
  reassignedFrom?: { name: string; type: 'rodizio' | 'transferencia'; at: string; stage: string | null } | null
}

export default function LeadKanbanBoard({
  leads,
  basePath,
  empresaSlug,
  mostrarVendedor = true,
}: {
  leads: LeadCard[]
  basePath: string
  empresaSlug: string | undefined
  mostrarVendedor?: boolean
}) {
  const navigate = useNavigate()
  const colunas = LEAD_STATUS_VALUES.filter((s) => isLeadStatusAllowedForEmpresa(s, empresaSlug))

  // Scrollbar superior sincronizada com a do board — sem isso, um board largo
  // (muitas colunas) esconde a barra de rolagem lá embaixo, fora da vista.
  const boardRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [boardWidth, setBoardWidth] = useState(0)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const observer = new ResizeObserver(() => setBoardWidth(board.scrollWidth))
    observer.observe(board)
    setBoardWidth(board.scrollWidth)
    return () => observer.disconnect()
  }, [leads])

  function handleTopScroll() {
    if (topScrollRef.current && boardRef.current) boardRef.current.scrollLeft = topScrollRef.current.scrollLeft
  }
  function handleBoardScroll() {
    if (topScrollRef.current && boardRef.current) topScrollRef.current.scrollLeft = boardRef.current.scrollLeft
  }

  return (
    <div>
      <div ref={topScrollRef} onScroll={handleTopScroll} className="overflow-x-auto mb-1.5" style={{ height: 12 }}>
        <div style={{ width: boardWidth, height: 1 }} />
      </div>
      <div ref={boardRef} onScroll={handleBoardScroll} className="flex gap-4 overflow-x-auto pb-4">
        {colunas.map((status) => {
          const cards = leads
            .filter((l) => l.status === status)
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          return (
            <div key={status} className="shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-dark-200">{LEAD_STATUS_LABELS[status]}</span>
                <span className="text-dark-500 text-xs">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((lead) => {
                  const urgency = lead.nextContactAt ? getLeadContactUrgency(lead.nextContactAt, lead.status) : null
                  const tagClasses = lead.negotiationTag ? LEAD_NEGOTIATION_TAG_CARD_CLASSES[lead.negotiationTag] : ''
                  const borderClasses =
                    tagClasses || (lead.requiresAttachment ? 'border-yellow-600/50' : urgency?.atrasado ? 'border-red-600/30' : 'border-dark-600')

                  return (
                    <div
                      key={lead.id}
                      onClick={() => navigate(`${basePath}/${lead.id}`)}
                      className={`group bg-dark-800 border rounded-xl p-3 cursor-pointer hover:border-gold-600/50 transition-all ${borderClasses}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">
                          {lead.name}
                        </h4>
                        <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0 mt-0.5" />
                      </div>

                      <div className="text-[11px] text-dark-500 mb-2">recebido há {formatElapsed(lead.createdAt)}</div>

                      {lead.reassignedFrom && (
                        <div className="flex items-center gap-1.5 text-[11px] text-cyan-400 mb-2">
                          <Repeat2 size={11} />
                          <span>
                            Recebeu de {lead.reassignedFrom.name} por{' '}
                            {lead.reassignedFrom.type === 'rodizio' ? 'rodízio' : 'transferência'}
                            {lead.reassignedFrom.stage
                              ? ` em "${LEAD_STATUS_LABELS[lead.reassignedFrom.stage as keyof typeof LEAD_STATUS_LABELS] ?? lead.reassignedFrom.stage}"`
                              : ''}
                            , há {formatElapsed(lead.reassignedFrom.at)}
                          </span>
                        </div>
                      )}

                      {(LEAD_TERMINAL_STATUSES as string[]).includes(lead.status) && lead.statusChangedAt && (
                        <Badge className={`mb-2 ${LEAD_STATUS_COLORS[lead.status as keyof typeof LEAD_STATUS_COLORS] ?? ''}`}>
                          <Calendar size={10} className="mr-1" />
                          {LEAD_CLOSING_LABELS[lead.status] ?? 'Fechado em'} {timeAgo(lead.statusChangedAt)}
                        </Badge>
                      )}

                      {lead.fromSite && (
                        <div className="mb-2">
                          <Badge className="text-cyan-400 bg-cyan-900/20 border-cyan-700/40">🌐 Veio do site</Badge>
                        </div>
                      )}

                      {lead.status === 'consumidor_final' && lead.finalConsumerReason && (
                        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg mb-2 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                          <span className="text-xs font-medium">{lead.finalConsumerReason}</span>
                        </div>
                      )}

                      {lead.company && (
                        <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
                          <Building2 size={11} />
                          <span className="truncate">{lead.company}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-xs text-dark-400">
                          <Phone size={11} />
                          <span>{leadTelefoneFormatado(lead.ddd, lead.phone)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {lead.email && <EmailButton email={lead.email} size="sm" />}
                          <WhatsappButton telefone={leadTelefoneCompleto(lead.ddd, lead.phone)} size="sm" />
                        </div>
                      </div>

                      {mostrarVendedor && lead.vendor && (
                        <div className="mb-2">
                          <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full truncate max-w-full inline-block">
                            {lead.vendor.name}
                          </span>
                        </div>
                      )}

                      {lead.nextContactAt && urgency && (
                        <div className={`flex items-center justify-between px-2 py-1.5 rounded-lg mt-1 ${urgency.classes}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${urgency.dot}`} />
                            <Calendar size={11} />
                            <span className="text-xs font-medium">{timeAgo(lead.nextContactAt)}</span>
                          </div>
                          {urgency.label && <span className="text-xs font-bold tracking-wide">{urgency.label}</span>}
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

                {cards.length === 0 && (
                  <div className="h-24 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                    Nenhum lead nesta etapa
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
