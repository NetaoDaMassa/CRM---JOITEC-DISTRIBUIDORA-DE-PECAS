import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, User, Paperclip, AlertCircle, MessageSquareWarning, Zap } from 'lucide-react'
import { timeAgo } from '../lib/utils'
import { Badge } from './ui/Badge'
import { PROPOSTA_BOARD_COLUMNS, PROPOSTA_STAGE_LABELS, PROPOSTA_STAGE_COLORS, isOverdue, type PropostaStage } from '../lib/propostasShared'

type PropostaCard = {
  id: number
  clienteNome: string
  stage: string
  prioridade: string
  motivoPerda: string | null
  dataRetorno: string | null
  produtosDescricao: string | null
  comissao: string | null
  revenda: string | null
  updatedAt: string
  vendedor: { id: number; name: string } | null
  arquivos: { fileCategory: string | null; tipoArquivo: string | null }[]
  alteracoes: unknown[]
}

export default function PropostasBoard({ propostas, basePath, mostrarVendedor = true }: { propostas: PropostaCard[]; basePath: string; mostrarVendedor?: boolean }) {
  const navigate = useNavigate()

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
  }, [propostas])

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
        {PROPOSTA_BOARD_COLUMNS.map((stage) => {
          const cards = propostas.filter((p) => p.stage === stage).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          return (
            <div key={stage} className="shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-dark-200">{PROPOSTA_STAGE_LABELS[stage]}</span>
                <span className="text-dark-500 text-xs">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((p) => {
                  const temPdf = p.arquivos.some((a) => a.fileCategory === 'proposta_pdf' || a.tipoArquivo?.includes('pdf'))
                  return (
                    <div
                      key={p.id}
                      onClick={() => navigate(`${basePath}/${p.id}`)}
                      className="group bg-dark-800 border border-dark-600 rounded-xl p-3 cursor-pointer hover:border-gold-600/50 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-dark-500">#{p.id}</span>
                          {p.prioridade === 'urgente' && <Zap size={12} className="text-yellow-400" />}
                        </div>
                        <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0" />
                      </div>
                      <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors mb-1">{p.clienteNome}</h4>

                      {p.alteracoes.length > 0 && stage === 'proposta' && (
                        <div className="flex items-center gap-1.5 text-[11px] text-yellow-400 mb-1.5">
                          <MessageSquareWarning size={11} /> Alteração solicitada
                        </div>
                      )}

                      {stage === 'perdido' && p.motivoPerda && (
                        <div className="text-[11px] text-red-400 mb-1.5 line-clamp-2">❌ {p.motivoPerda}</div>
                      )}

                      {stage === 'chamar_depois' && p.dataRetorno && (
                        <Badge className={isOverdue(p.dataRetorno) ? 'text-red-400 bg-red-900/20 border-red-700/40 mb-1.5' : 'text-orange-400 bg-orange-900/20 border-orange-700/40 mb-1.5'}>
                          {isOverdue(p.dataRetorno) ? 'Retomar HOJE/atrasado' : `Retomar em ${p.dataRetorno}`}
                        </Badge>
                      )}

                      {p.produtosDescricao && <p className="text-xs text-dark-400 line-clamp-2 mb-1.5">{p.produtosDescricao}</p>}

                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {p.comissao && <Badge className="text-dark-300 bg-dark-700 border-dark-600">Com: {p.comissao}</Badge>}
                        {p.revenda && <Badge className="text-dark-300 bg-dark-700 border-dark-600">{p.revenda}</Badge>}
                      </div>

                      <div className="flex items-center justify-between">
                        {mostrarVendedor && p.vendedor && (
                          <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full truncate max-w-[60%]">{p.vendedor.name}</span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          {temPdf && <Paperclip size={12} className="text-green-400" />}
                          {!temPdf && stage === 'proposta' && <AlertCircle size={12} className="text-yellow-500" />}
                        </div>
                      </div>
                      <div className="text-[10px] text-dark-600 mt-1.5">atualizado {timeAgo(p.updatedAt)}</div>
                    </div>
                  )
                })}

                {cards.length === 0 && (
                  <div className="h-24 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                    Nenhuma proposta nesta etapa
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
