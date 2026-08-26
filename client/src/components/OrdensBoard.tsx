import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, User, Building2 } from 'lucide-react'
import { timeAgo } from '../lib/utils'
import { Badge } from './ui/Badge'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, type OrderType, type Stage } from '../lib/ordensShared'

type OrdemCard = {
  id: number
  stage: string
  status: string
  updatedAt: string
  cliente: { id: number; razaoSocial: string } | null
  vendedor: { id: number; name: string } | null
}

// Mesmo padrão de LeadKanbanBoard.tsx — sem drag-and-drop (não existe
// biblioteca de DnD nesse app), mudar de etapa é clicar no card e usar o
// botão "Avançar etapa" na tela de detalhe.
export default function OrdensBoard({ ordens, orderType, basePath }: { ordens: OrdemCard[]; orderType: OrderType; basePath: string }) {
  const navigate = useNavigate()
  const colunas = getStageSequence(orderType)

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
  }, [ordens])

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
        {colunas.map((stage) => {
          const cards = ordens.filter((o) => o.stage === stage && o.status === 'ativo').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          return (
            <div key={stage} className="shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-dark-200">{STAGE_LABELS[stage as Stage]}</span>
                <span className="text-dark-500 text-xs">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((ordem) => (
                  <div
                    key={ordem.id}
                    onClick={() => navigate(`${basePath}/${ordem.id}`)}
                    className={`group bg-dark-800 border rounded-xl p-3 cursor-pointer hover:border-gold-600/50 transition-all border-dark-600`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">
                        Pedido #{ordem.id}
                      </h4>
                      <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0 mt-0.5" />
                    </div>

                    {ordem.cliente && (
                      <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
                        <Building2 size={11} />
                        <span className="truncate">{ordem.cliente.razaoSocial}</span>
                      </div>
                    )}

                    {ordem.vendedor && (
                      <div className="flex items-center gap-1.5 text-xs text-dark-500 mb-2">
                        <User size={11} />
                        <span className="truncate">{ordem.vendedor.name}</span>
                      </div>
                    )}

                    <Badge className={STAGE_COLORS[stage as Stage]}>atualizado {timeAgo(ordem.updatedAt)}</Badge>
                  </div>
                ))}

                {cards.length === 0 && (
                  <div className="h-24 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                    Nenhum pedido nesta etapa
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
