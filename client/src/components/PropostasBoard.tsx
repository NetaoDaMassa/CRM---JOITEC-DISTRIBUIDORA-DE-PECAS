import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, AlertCircle, MessageSquareWarning, Zap, FileText, MessageCircle, ArrowRight, RefreshCcw, Pencil, Trash2 } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { timeAgo } from '../lib/utils'
import { Badge } from './ui/Badge'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { Input } from './ui/Input'
import { PROPOSTA_BOARD_COLUMNS, PROPOSTA_STAGE_LABELS, PROPOSTA_STAGE_COLORS, PROPOSTA_STAGE_DOT_COLORS, PROPOSTA_STAGE_NEXT, isOverdue, type PropostaStage } from '../lib/propostasShared'

type PropostaCard = {
  id: number
  clienteNome: string
  stage: string
  prioridade: string
  vendedorId: number
  motivoUrgencia: string | null
  motivoPerda: string | null
  dataRetorno: string | null
  produtosDescricao: string | null
  comissao: string | null
  revenda: string | null
  formaPagamento: string | null
  updatedAt: string
  vendedor: { id: number; name: string; whatsapp: string | null } | null
  arquivos: { fileCategory: string | null; tipoArquivo: string | null }[]
  alteracoes: unknown[]
}

export default function PropostasBoard({ propostas, basePath, mostrarVendedor = true }: { propostas: PropostaCard[]; basePath: string; mostrarVendedor?: boolean }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  const boardRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [boardWidth, setBoardWidth] = useState(0)
  const [chamarDepoisId, setChamarDepoisId] = useState<number | null>(null)
  const [dataRetorno, setDataRetorno] = useState('')
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)

  function invalidar() { utils.propostas.listar.invalidate() }
  const moverMut = trpc.propostas.moverEtapa.useMutation({ onSuccess: () => { toast.success('Etapa alterada'); invalidar() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.propostas.atualizar.useMutation()
  const excluirMut = trpc.propostas.excluir.useMutation({ onSuccess: () => { toast.success('Excluída'); setExcluindo(null); invalidar() }, onError: (e) => toast.error(e.message) })

  async function confirmarChamarDepois() {
    if (!chamarDepoisId || !dataRetorno) return
    try {
      await atualizarMut.mutateAsync({ id: chamarDepoisId, dataRetorno })
      await moverMut.mutateAsync({ id: chamarDepoisId, novaEtapa: 'chamar_depois' })
      setChamarDepoisId(null)
      setDataRetorno('')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

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
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PROPOSTA_STAGE_DOT_COLORS[stage]}`} />
                <span className="text-sm font-semibold text-dark-200">{PROPOSTA_STAGE_LABELS[stage]}</span>
                <span className="text-dark-500 text-xs bg-dark-800 rounded-full px-1.5 py-0.5">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((p) => {
                  const temPdf = p.arquivos.some((a) => a.fileCategory === 'proposta_pdf' || a.tipoArquivo?.includes('pdf'))
                  const isUrgente = p.prioridade === 'urgente'
                  const temAlteracao = p.alteracoes.length > 0
                  const podeAgir = isAdmin || p.vendedorId === user?.id
                  const proximaEtapa = PROPOSTA_STAGE_NEXT[stage]
                  return (
                    <div
                      key={p.id}
                      onClick={() => navigate(`${basePath}/${p.id}`)}
                      className={`group bg-dark-800 border rounded-xl p-3 cursor-pointer hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150
                        ${isUrgente ? 'border-l-4 border-l-red-500 border-y-dark-600 border-r-dark-600' : temAlteracao ? 'border-l-4 border-l-amber-400 border-y-dark-600 border-r-dark-600' : 'border-dark-600 hover:border-gold-600/50'}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-dark-500">#{p.id}</span>
                          {isUrgente && (
                            <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-400 flex items-center gap-0.5">
                              <Zap size={9} /> URGENTE
                            </span>
                          )}
                          {temAlteracao && (
                            <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                              <AlertCircle size={9} /> ALTERAÇÃO{p.alteracoes.length > 1 ? ` (${p.alteracoes.length})` : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {podeAgir && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/${p.id}`) }}
                                className="p-1 rounded text-dark-500 hover:text-gold-400 hover:bg-dark-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Editar"
                              >
                                <Pencil size={12} />
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExcluindo({ id: p.id, nome: p.clienteNome }) }}
                                  className="p-1 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Excluir"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </>
                          )}
                          <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0" />
                        </div>
                      </div>
                      <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors mb-1">{p.clienteNome}</h4>

                      {isUrgente && p.motivoUrgencia && (
                        <p className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1 mb-1.5">⚡ {p.motivoUrgencia}</p>
                      )}

                      {temAlteracao && (
                        <p className="text-[11px] text-amber-400 bg-amber-900/20 rounded px-2 py-1 mb-1.5 flex items-center gap-1">
                          <MessageSquareWarning size={11} className="shrink-0" /> Alteração solicitada — veja o histórico
                        </p>
                      )}

                      {stage === 'perdido' && p.motivoPerda && (
                        <div className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1 mb-1.5 line-clamp-2">❌ {p.motivoPerda}</div>
                      )}

                      {stage === 'chamar_depois' && p.dataRetorno && (
                        <Badge className={isOverdue(p.dataRetorno) ? 'text-red-400 bg-red-900/20 border-red-700/40 mb-1.5' : 'text-orange-400 bg-orange-900/20 border-orange-700/40 mb-1.5'}>
                          {isOverdue(p.dataRetorno) ? 'Retomar HOJE/atrasado' : `Retomar em ${p.dataRetorno}`}
                        </Badge>
                      )}

                      {p.produtosDescricao && <p className="text-xs text-dark-400 line-clamp-2 mb-1.5">{p.produtosDescricao}</p>}

                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        {p.comissao && <Badge className="text-purple-400 bg-purple-900/20 border-purple-700/40">Comissão: {p.comissao}</Badge>}
                        {p.formaPagamento && <Badge className="text-blue-400 bg-blue-900/20 border-blue-700/40">{p.formaPagamento}</Badge>}
                        {p.revenda && <Badge className="text-orange-400 bg-orange-900/20 border-orange-700/40">{p.revenda}</Badge>}
                        {temPdf && (
                          <span className="flex items-center gap-0.5 rounded-full bg-green-900/20 px-2 py-0.5 text-[11px] text-green-400 font-medium">
                            <FileText size={9} /> PDF
                          </span>
                        )}
                        {p.vendedor?.whatsapp && (
                          <span className="flex items-center gap-0.5 rounded-full bg-green-900/10 px-2 py-0.5 text-[11px] text-green-500 font-medium">
                            <MessageCircle size={9} /> Zap
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        {mostrarVendedor && p.vendedor && (
                          <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full truncate max-w-[60%]">{p.vendedor.name}</span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          {!temPdf && stage === 'proposta' && <AlertCircle size={12} className="text-yellow-500" />}
                        </div>
                      </div>

                      {podeAgir && stage !== 'convertido' && (proximaEtapa || stage !== 'chamar_depois') && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dark-700/60">
                          {proximaEtapa && (
                            <button
                              onClick={(e) => { e.stopPropagation(); moverMut.mutate({ id: p.id, novaEtapa: proximaEtapa }) }}
                              className="flex items-center gap-1 text-[11px] font-semibold text-gold-400 hover:text-gold-300 transition-colors"
                            >
                              <ArrowRight size={11} /> Avançar
                            </button>
                          )}
                          {stage !== 'chamar_depois' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setChamarDepoisId(p.id); setDataRetorno('') }}
                              className="flex items-center gap-1 text-[11px] font-semibold text-dark-400 hover:text-dark-200 transition-colors"
                            >
                              <RefreshCcw size={11} /> Chamar Depois
                            </button>
                          )}
                        </div>
                      )}
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

      <Modal open={chamarDepoisId !== null} onClose={() => setChamarDepoisId(null)} title="Chamar depois" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Data de retorno" type="date" value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)} />
          <Button className="w-full" disabled={!dataRetorno} loading={atualizarMut.isPending || moverMut.isPending} onClick={confirmarChamarDepois}>
            Confirmar
          </Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Excluir proposta" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Excluir a proposta de "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Excluir</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
