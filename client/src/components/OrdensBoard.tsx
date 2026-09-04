import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, ArrowLeft, User, Building2, AlertTriangle, Clock, CheckCircle2, Truck } from 'lucide-react'
import { timeAgo, formatDateTime } from '../lib/utils'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Badge } from './ui/Badge'
import { getStageSequence, STAGE_LABELS, STAGE_COLORS, STAGE_DOT_COLORS, PRIORIDADE_CONFIG, type OrderType, type Stage } from '../lib/ordensShared'

type OrdemCard = {
  id: number
  stage: string
  status: string
  orderType: string
  createdAt: string
  updatedAt: string
  cliente: { id: number; razaoSocial: string; codigo: string | null; telefoneWhatsapp: string | null } | null
  vendedor: { id: number; name: string } | null
  detalhes: { prioridadeDespacho: string | null } | null
  aprovacaoFrete: { retiradaLocal: boolean; semFrete: boolean; cotacaoSelecionadaId: number | null; cotacaoFinalizada?: boolean } | null
  freteFinalizado: { confirmado: boolean } | null
  preparacao: { aprovadoGestor: boolean; operadorFinalizou?: boolean } | null
  coleta: { confirmado: boolean } | null
  rastreio: { transportadora: string | null; codigoRastreio: string | null } | null
}

// Alerta visual quando o pedido demora demais numa etapa — mesmos limites
// do KanbanCard.tsx original (coleta > 24h, preparação > 72h, geral > 48h).
function nivelAlerta(ordem: OrdemCard): 'vermelho' | 'laranja' | null {
  const horas = (Date.now() - new Date(ordem.updatedAt.replace(' ', 'T') + 'Z').getTime()) / 3_600_000
  if (ordem.stage === 'coleta' && horas > 24) return 'vermelho'
  if (ordem.stage === 'preparacao' && horas > 72) return 'vermelho'
  if (horas > 48) return 'laranja'
  return null
}

export default function OrdensBoard({ ordens, orderType, basePath }: { ordens: OrdemCard[]; orderType: OrderType; basePath: string }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()
  const colunas = getStageSequence(orderType)

  // "Voltar" no card é só do gestor — o back-end (ordens.core.mover) já
  // reseta as confirmações das etapas que ficaram pra frente. Avançar
  // continua só no detalhe do pedido, onde dá pra ver os anexos/aprovações
  // que destravam cada etapa.
  const moverMut = trpc.ordens.core.mover.useMutation({
    onSuccess: () => { toast.success('Pedido voltou de etapa'); utils.ordens.core.listarKanban.invalidate() },
    onError: (e) => toast.error(e.message),
  })

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
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STAGE_DOT_COLORS[stage as Stage]}`} />
                <span className="text-sm font-semibold text-dark-200">{STAGE_LABELS[stage as Stage]}</span>
                <span className="text-dark-500 text-xs bg-dark-800 rounded-full px-1.5 py-0.5">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((ordem) => {
                  const alerta = nivelAlerta(ordem)
                  const coletaPronta = ordem.stage === 'coleta' && ordem.coleta?.confirmado
                  const prioridade = ordem.detalhes?.prioridadeDespacho ? PRIORIDADE_CONFIG[ordem.detalhes.prioridadeDespacho] : null
                  const prioridadeLabel = prioridade ? (ordem.orderType === 'peca' && prioridade.labelPeca) || prioridade.label : null
                  const metodoFrete = ordem.aprovacaoFrete?.retiradaLocal
                    ? { label: '🏭 Cliente Retira', cls: 'text-sky-400 bg-sky-900/20 border-sky-700/40' }
                    : ordem.aprovacaoFrete?.semFrete
                      ? { label: '📦 Sem Frete', cls: 'text-dark-400 bg-dark-700/40 border-dark-600' }
                      : ordem.aprovacaoFrete?.cotacaoSelecionadaId
                        ? { label: '🚚 Cotação', cls: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40' }
                        : null
                  const mostrarPills = stage === 'cotacao_frete' || stage === 'preparacao'
                  const idxStage = colunas.indexOf(stage)
                  const etapaAnterior = isAdmin && idxStage > 0 ? colunas[idxStage - 1] : undefined

                  return (
                    <div
                      key={ordem.id}
                      onClick={() => navigate(`${basePath}/${ordem.id}`)}
                      className={`group relative bg-dark-800 border rounded-xl p-3 pt-4 cursor-pointer overflow-hidden
                        hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150
                        ${coletaPronta ? 'border-green-600/50' : alerta === 'vermelho' ? 'border-red-600/60' : alerta === 'laranja' ? 'border-orange-500/50' : 'border-dark-600 hover:border-gold-600/50'}`}
                    >
                      {prioridade && <div className={`absolute top-0 left-0 right-0 h-1 ${prioridade.barra}`} />}

                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">
                          Pedido #{ordem.id}
                        </h4>
                        {coletaPronta ? (
                          <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />
                        ) : alerta === 'vermelho' ? (
                          <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                        ) : alerta === 'laranja' ? (
                          <Clock size={14} className="text-orange-400 shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0 mt-0.5" />
                        )}
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

                      {stage === 'rastreio' && ordem.rastreio?.transportadora && (
                        <div className="flex items-center gap-1 text-[11px] text-dark-400 mb-2">
                          <Truck size={11} className="shrink-0" />
                          <span className="font-medium">{ordem.rastreio.transportadora}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className={STAGE_COLORS[stage as Stage]}>{timeAgo(ordem.updatedAt)}</Badge>
                        {prioridadeLabel && <Badge className={prioridade!.badge}>{prioridadeLabel}</Badge>}
                        {metodoFrete && <Badge className={metodoFrete.cls}>{metodoFrete.label}</Badge>}
                      </div>
                      <div className="text-[10px] text-dark-600 mt-1">Criado: {formatDateTime(ordem.createdAt)}</div>

                      {coletaPronta && (
                        <div className="mt-2 flex items-center gap-1 rounded-full bg-green-900/30 border border-green-700/40 px-2 py-0.5 w-fit">
                          <CheckCircle2 size={10} className="text-green-400" />
                          <span className="text-[10px] font-bold text-green-400">PRONTO PARA RASTREIO</span>
                        </div>
                      )}

                      {(ordem.aprovacaoFrete?.cotacaoFinalizada || ordem.preparacao?.operadorFinalizou) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {ordem.aprovacaoFrete?.cotacaoFinalizada && (
                            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold border text-green-400 bg-green-900/20 border-green-700/40">
                              <CheckCircle2 size={10} /> Cotação finalizada
                            </span>
                          )}
                          {ordem.preparacao?.operadorFinalizou && (
                            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold border text-green-400 bg-green-900/20 border-green-700/40">
                              <CheckCircle2 size={10} /> Preparação finalizada
                            </span>
                          )}
                        </div>
                      )}

                      {mostrarPills && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${ordem.freteFinalizado?.confirmado ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-dark-500 bg-dark-700/30 border-dark-600'}`}>
                            {ordem.freteFinalizado?.confirmado ? <CheckCircle2 size={10} /> : <Clock size={10} />} Frete
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${ordem.preparacao?.aprovadoGestor ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-dark-500 bg-dark-700/30 border-dark-600'}`}>
                            {ordem.preparacao?.aprovadoGestor ? <CheckCircle2 size={10} /> : <Clock size={10} />} Prep
                          </span>
                        </div>
                      )}

                      {etapaAnterior && (
                        <div className="mt-2 pt-2 border-t border-dark-700/60" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => moverMut.mutate({ id: ordem.id, novaEtapa: etapaAnterior })}
                            disabled={moverMut.isPending}
                            className="flex items-center gap-1 text-[11px] font-semibold text-dark-400 hover:text-dark-200 transition-colors disabled:opacity-50"
                            title={`Voltar para "${STAGE_LABELS[etapaAnterior]}"`}
                          >
                            <ArrowLeft size={11} /> Voltar pra "{STAGE_LABELS[etapaAnterior]}"
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

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
