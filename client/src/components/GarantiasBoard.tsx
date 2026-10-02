import { useNavigate } from 'react-router-dom'
import { ChevronRight, Building2, Wrench } from 'lucide-react'
import { timeAgo, formatDateTime } from '../lib/utils'
import { Badge } from './ui/Badge'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, TIPO_ATENDIMENTO_LABELS, type Stage, type TipoAtendimento } from '../lib/garantiasShared'

type GarantiaCard = {
  id: number
  stage: string
  status: string
  comRetorno: boolean
  tipoAtendimento: string
  createdAt: string
  updatedAt: string
  cliente: { id: number; razaoSocial: string; codigo: string | null } | null
  pedido: { id: number } | null
}

export default function GarantiasBoard({ garantias, comRetorno, basePath }: { garantias: GarantiaCard[]; comRetorno: boolean; basePath: string }) {
  const navigate = useNavigate()
  const colunas = getStageSequence(comRetorno)

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {colunas.map((stage) => {
        const cards = garantias.filter((g) => g.stage === stage && g.status === 'ativo').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        return (
          <div key={stage} className="shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-dark-200">{STAGE_LABELS[stage as Stage]}</span>
              <span className="text-dark-500 text-xs bg-dark-800 rounded-full px-1.5 py-0.5">{cards.length}</span>
            </div>
            <div className="space-y-2">
              {cards.map((g) => (
                <div
                  key={g.id}
                  onClick={() => navigate(`${basePath}/${g.id}`)}
                  className="group relative bg-dark-800 border border-dark-600 hover:border-gold-600/50 rounded-xl p-3 cursor-pointer hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">Garantia #{g.id}</h4>
                    <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0 mt-0.5" />
                  </div>
                  {g.cliente && (
                    <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
                      <Building2 size={11} className="shrink-0" />
                      <span className="truncate min-w-0 flex-1">{g.cliente.razaoSocial}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-dark-500 mb-2 line-clamp-1">{TIPO_ATENDIMENTO_LABELS[g.tipoAtendimento as TipoAtendimento]}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge className={STAGE_COLORS[stage as Stage]}>{timeAgo(g.updatedAt)}</Badge>
                    {g.pedido && <Badge className="text-dark-300 bg-dark-700 border-dark-600">Pedido #{g.pedido.id}</Badge>}
                    {stage === 'oficina' && (
                      <Badge className="text-teal-400 bg-teal-900/20 border-teal-700/40">
                        <Wrench size={10} className="inline mr-1" />
                        Oficina
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-dark-600 mt-1">Criado: {formatDateTime(g.createdAt)}</div>
                </div>
              ))}
              {cards.length === 0 && (
                <div className="h-24 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">Nenhum processo nesta etapa</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
