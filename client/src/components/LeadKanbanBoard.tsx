import { useNavigate } from 'react-router-dom'
import { timeAgo } from '../lib/utils'
import { LEAD_STATUS_VALUES, LEAD_STATUS_LABELS, isLeadStatusAllowedForEmpresa, leadNegotiationTagLabel } from '../lib/leadsShared'

type LeadCard = {
  id: number
  name: string
  phone: string
  company: string | null
  status: string
  negotiationTag: string | null
  nextContactAt: string | null
  createdAt: string
  vendor?: { name: string } | null
  fromSite?: boolean
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

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {colunas.map((status) => {
        const cards = leads.filter((l) => l.status === status)
        return (
          <div key={status} className="shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-dark-200">{LEAD_STATUS_LABELS[status]}</span>
              <span className="text-dark-500 text-xs">{cards.length}</span>
            </div>
            <div className="space-y-2">
              {cards.map((lead) => {
                const tagLabel = leadNegotiationTagLabel(lead.negotiationTag)
                const atrasado = lead.nextContactAt && new Date(lead.nextContactAt) < new Date()
                return (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`${basePath}/${lead.id}`)}
                    className="bg-dark-800 border border-dark-600 rounded-xl p-3 cursor-pointer hover:border-gold-600/50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-dark-100 leading-tight">{lead.name}</p>
                      {lead.fromSite && <span title="Veio do site" className="text-xs shrink-0">🌐</span>}
                    </div>
                    {lead.company && <p className="text-xs text-dark-400 truncate">{lead.company}</p>}
                    <p className="text-xs text-dark-500 mt-1">{lead.phone}</p>
                    {mostrarVendedor && (
                      <p className="text-xs text-dark-400 mt-1">{lead.vendor?.name ?? 'Sem vendedor'}</p>
                    )}
                    {lead.nextContactAt && (
                      <p className={`text-xs mt-1 ${atrasado ? 'text-red-400' : 'text-dark-500'}`}>
                        {atrasado ? '⏰ atrasado — ' : 'próximo contato '}
                        {timeAgo(lead.nextContactAt)}
                      </p>
                    )}
                    {tagLabel && <p className="text-xs mt-2">{tagLabel}</p>}
                    <p className="text-xs text-dark-600 mt-1">Criado {timeAgo(lead.createdAt)}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
