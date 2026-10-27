import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, Calendar, ChevronRight, ChevronsLeftRight, AlertCircle, Repeat2, Phone, Hand, MessageSquare, Image as ImageIcon, Mic, Play, Snowflake, NotebookPen, Timer } from 'lucide-react'
import { formatElapsed, timeAgo } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../lib/trpc'
import { WhatsappButton } from './ui/ContatoButtons'
import EmailButton from './ui/EmailButton'
import Button from './ui/Button'
import { Badge } from './ui/Badge'
import { AvatarIniciais } from './ui/Visual'
import Modal from './ui/Modal'
import LeadChangeStatusModal from './LeadChangeStatusModal'
import LeadContactAttemptForm from './LeadContactAttemptForm'
import { formatarMoeda } from '../lib/moeda'
import { COR_ETAPA_LEAD, DIAS_ESFRIANDO, diasEsquecido, temperaturaLead, SeloTemperatura, relogioNovo, MensagensProntas } from './leads/KanbanLeadsExtras'
import {
  LEAD_STATUS_VALUES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_TERMINAL_STATUSES,
  LEAD_CLOSING_LABELS,
  LEAD_NEGOTIATION_TAG_CARD_CLASSES,
  isLeadStatusAllowedForEmpresa,
  getLeadContactUrgency,
  isLeadTerminalStatus,
  leadTelefoneCompleto,
  leadTelefoneFormatado,
} from '../lib/leadsShared'

type LeadCard = {
  id: number
  name: string
  phone: string | null
  ddd: number | null
  email: string | null
  company: string | null
  status: string
  negotiationTag: string | null
  tagPprVerde: boolean
  tagOutrasLinhas: boolean
  nextContactAt: string | null
  createdAt: string
  updatedAt: string
  statusChangedAt: string | null
  assignedAt?: string | null
  lastContactAt?: string | null
  attemptCount?: number | null
  orderValue?: number | null
  finalOrderValue?: number | null
  requiresAttachment: boolean
  finalConsumerReason: string | null
  vendor?: { name: string } | null
  fromSite?: boolean
  source?: string | null
  convertidoParaPropostaId?: number | null
  reassignedFrom?: { name: string; type: 'rodizio' | 'transferencia'; at: string; stage: string | null } | null
  observations?: string | null
  // Resposta "qual compressor possui atualmente?" do formulário da Meta.
  compressorAtual?: string | null
  attachments?: { id: number; filename: string; mimeType: string; originalName: string }[]
}

// Prévia de mensagem/foto/áudio no card — pedido do João, 2026-10-13, pra
// induzir o vendedor a abrir o card e ver o que o lead mandou, em vez do
// card ficar "mudo" até alguém clicar. Prioridade: mensagem (texto) > foto
// > áudio — PDF e outros tipos de anexo não entram aqui (não ajudam numa
// prévia rápida), continuam só visíveis dentro do card.
function LeadCardPreview({ lead }: { lead: LeadCard }) {
  const mensagem = lead.observations?.trim()
  const fotos = (lead.attachments ?? []).filter((a) => a.mimeType.startsWith('image/'))
  const audios = (lead.attachments ?? []).filter((a) => a.mimeType.startsWith('audio/'))

  if (!mensagem && fotos.length === 0 && audios.length === 0) return null

  return (
    <div className="mb-2 rounded-lg border border-dark-700 bg-dark-900/50 overflow-hidden">
      {mensagem ? (
        <>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-green-400 px-2.5 pt-1.5">
            <MessageSquare size={10} /> mensagem
          </div>
          <p className="text-[11px] text-dark-300 italic px-2.5 pb-2 pt-0.5 leading-snug line-clamp-3">
            &ldquo;{mensagem.length > 140 ? `${mensagem.slice(0, 140)}…` : mensagem}&rdquo;
          </p>
        </>
      ) : fotos.length > 0 ? (
        <>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-green-400 px-2.5 pt-1.5">
            <ImageIcon size={10} /> {fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`}
          </div>
          <div className="flex gap-1.5 px-2.5 pb-2 pt-1">
            {fotos.slice(0, 2).map((f) => (
              <img
                key={f.id}
                src={`/uploads/${f.filename}`}
                alt={f.originalName}
                className="w-10 h-10 rounded object-cover border border-dark-700"
                loading="lazy"
              />
            ))}
            {fotos.length > 2 && (
              <div className="w-10 h-10 rounded border border-dark-700 bg-dark-800 flex items-center justify-center text-[10px] font-semibold text-dark-400">
                +{fotos.length - 2}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-green-400 px-2.5 pt-1.5">
            <Mic size={10} /> {audios.length === 1 ? 'áudio' : `${audios.length} áudios`}
          </div>
          <div className="flex items-center gap-2 px-2.5 pb-2 pt-1.5">
            <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <Play size={8} className="text-dark-950 fill-dark-950 ml-0.5" />
            </span>
            <span className="text-[10px] text-dark-400 truncate">{audios[0].originalName}</span>
          </div>
        </>
      )}
    </div>
  )
}

// Visual novo do Kanban de Leads (pedido do João, 2026-10-22): cor por etapa
// no topo da coluna, colunas de fim (Ganho, Perdido...) recolhíveis, cards
// mais urgentes primeiro e aviso de lead "esquecido" (sem próximo contato).
// Ordem no card: atrasado → hoje → amanhã → resto (mais recente em cima).
function pesoUrgencia(lead: LeadCard) {
  if (!lead.nextContactAt) return 3
  const u = getLeadContactUrgency(lead.nextContactAt, lead.status)
  if (!u) return 3
  if (u.atrasado) return 0
  if (u.label === 'HOJE') return 1
  if (u.label === 'AMANHÃ') return 2
  return 3
}

export default function LeadKanbanBoard({
  leads,
  basePath,
  empresaSlug,
  mostrarVendedor = true,
  recolhidas,
  aoAlternarColuna,
  empresaNome = '',
}: {
  leads: LeadCard[]
  basePath: string
  empresaSlug: string | undefined
  mostrarVendedor?: boolean
  recolhidas?: string[]
  aoAlternarColuna?: (status: string) => void
  empresaNome?: string
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const colunas = LEAD_STATUS_VALUES.filter((s) => isLeadStatusAllowedForEmpresa(s, empresaSlug))

  // Arrastar o card pra outra coluna abre a mesma janela de "mudar etapa"
  // (que pede os campos obrigatórios da etapa) já com a etapa de destino.
  const [arrastando, setArrastando] = useState<LeadCard | null>(null)
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null)
  const [mudarEtapa, setMudarEtapa] = useState<{ lead: LeadCard; para: string } | null>(null)
  const [registrar, setRegistrar] = useState<LeadCard | null>(null)
  const podeSoltar = (status: string) => !!arrastando && arrastando.status !== status && status !== 'novo_consumidor_final'
  const soltar = (status: string) => {
    if (arrastando && podeSoltar(status)) setMudarEtapa({ lead: arrastando, para: status })
    setArrastando(null)
    setColunaAlvo(null)
  }
  const alvoProps = (status: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!podeSoltar(status)) return
      e.preventDefault()
      setColunaAlvo(status)
    },
    onDragLeave: () => setColunaAlvo((c) => (c === status ? null : c)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      soltar(status)
    },
  })

  // "Pegar esse lead" — fila de Consumidor Final, sem rodízio por tempo:
  // primeiro vendedor da região que clicar fica com o lead. Pedido do João,
  // 2026-09-21.
  const assumirMut = trpc.leads.assumirConsumidorFinal.useMutation({
    onSuccess() {
      toast.success('Lead pego! Já está na sua etapa "Novo".')
      utils.leads.list.invalidate()
    },
    onError(err) {
      toast.error(err.message)
      utils.leads.list.invalidate()
    },
  })
  // Lead "Ganho" da Odin Compressores vira Proposta (ver TransferirParaPropostasModal) —
  // pedido do João (2026-09-03): o lead continua aparecendo aqui normalmente, mas
  // com um link direto pra proposta gerada, pra quem tá procurando não precisar ir
  // catar na busca do board de Propostas.
  const propostasBasePath = basePath.replace('/leads', '/propostas')

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
            .sort((a, b) => pesoUrgencia(a) - pesoUrgencia(b) || (a.updatedAt < b.updatedAt ? 1 : -1))
          const cor = COR_ETAPA_LEAD[status] ?? '#94a3b8'
          const terminal = isLeadTerminalStatus(status)
          const atrasadosColuna = terminal ? 0 : cards.filter((c) => pesoUrgencia(c) === 0).length
          // Valor em jogo: orçamentos (etapas abertas) ou vendas (Ganho).
          const valorColuna = cards.reduce((soma, c) => soma + ((status === 'ganho' ? c.finalOrderValue : c.orderValue) ?? 0), 0)

          if (recolhidas?.includes(status)) {
            return (
              <button
                key={status}
                type="button"
                onClick={() => aoAlternarColuna?.(status)}
                title="Clique para abrir a coluna (ou solte um card aqui)"
                {...alvoProps(status)}
                className={`shrink-0 w-11 rounded-xl border bg-dark-800/60 hover:bg-dark-800 flex flex-col items-center gap-2 py-3 transition-colors ${colunaAlvo === status ? 'border-gold-400 bg-gold-500/10' : 'border-dark-700'}`}
                style={{ borderTop: `3px solid ${cor}` }}
              >
                <span className="text-xs font-bold rounded-full px-1.5 min-w-6 text-center" style={{ color: cor, background: `${cor}22` }}>
                  {cards.length}
                </span>
                <span className="text-xs font-semibold text-dark-300 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{LEAD_STATUS_LABELS[status]}</span>
              </button>
            )
          }

          return (
            <div
              key={status}
              {...alvoProps(status)}
              className={`shrink-0 w-72 rounded-2xl transition-colors ${colunaAlvo === status ? 'bg-gold-500/10 ring-2 ring-gold-400/60 ring-offset-4 ring-offset-dark-950' : ''}`}
            >
              <div className="rounded-xl bg-dark-800/60 border border-dark-700 px-3 py-2 mb-3" style={{ borderTop: `3px solid ${cor}` }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
                  <span className="text-sm font-semibold text-dark-100 truncate">{LEAD_STATUS_LABELS[status]}</span>
                  <span className="text-xs font-bold rounded-full px-2 py-0.5" style={{ color: cor, background: `${cor}22` }}>
                    {cards.length}
                  </span>
                  {atrasadosColuna > 0 && (
                    <span className="text-[10px] font-bold text-red-400 bg-red-500/15 rounded-full px-1.5 py-0.5" title="Leads com contato atrasado nesta etapa">
                      {atrasadosColuna} atrasado{atrasadosColuna > 1 ? 's' : ''}
                    </span>
                  )}
                  {terminal && aoAlternarColuna && (
                    <button
                      type="button"
                      onClick={() => aoAlternarColuna(status)}
                      title="Recolher coluna"
                      className="ml-auto text-dark-500 hover:text-dark-200 transition-colors"
                    >
                      <ChevronsLeftRight size={14} />
                    </button>
                  )}
                </div>
                {valorColuna > 0 && (
                  <p className="text-[11px] text-dark-400 mt-1" title={status === 'ganho' ? 'Soma das vendas fechadas nesta coluna' : 'Soma dos orçamentos dos leads desta coluna'}>
                    <span className="font-semibold text-emerald-400">{formatarMoeda(valorColuna, { casas: 0 })}</span> {status === 'ganho' ? 'vendidos' : 'em jogo'}
                  </p>
                )}
              </div>
              <div className="space-y-2 min-h-24">
                {cards.map((lead) => {
                  const urgency = lead.nextContactAt ? getLeadContactUrgency(lead.nextContactAt, lead.status) : null
                  const tagClasses = lead.negotiationTag ? LEAD_NEGOTIATION_TAG_CARD_CLASSES[lead.negotiationTag] : ''
                  const borderClasses =
                    tagClasses || (lead.requiresAttachment ? 'border-yellow-600/50' : urgency?.atrasado ? 'border-red-600/30' : 'border-dark-600')
                  const parado = diasEsquecido(lead)

                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setArrastando(lead)
                      }}
                      onDragEnd={() => {
                        setArrastando(null)
                        setColunaAlvo(null)
                      }}
                      onClick={() => navigate(`${basePath}/${lead.id}`)}
                      className={`group bg-dark-800 border rounded-xl p-3 cursor-pointer hover:border-gold-600/50 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 transition-all ${borderClasses} ${arrastando?.id === lead.id ? 'opacity-40' : ''}`}
                      style={{ boxShadow: `inset 3px 0 0 ${cor}` }}
                    >
                      <div className="flex items-start gap-2 mb-1">
                        <AvatarIniciais nome={lead.company || lead.name} tamanho={28} />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium text-dark-100 line-clamp-1 group-hover:text-gold-400 transition-colors">{lead.name}</h4>
                          <div className="text-[11px] text-dark-500">recebido há {formatElapsed(lead.createdAt)}</div>
                        </div>
                        <ChevronRight size={14} className="text-dark-600 group-hover:text-gold-400 transition-colors shrink-0 mt-0.5" />
                      </div>

                      {parado >= DIAS_ESFRIANDO && (
                        <div className="flex items-center gap-1.5 text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg px-2 py-1 mb-2 mt-1.5" title="Sem próximo contato marcado e ninguém mexeu nesse lead há dias">
                          <Snowflake size={11} /> esquecido: sem próximo contato, parado há {parado} dias
                        </div>
                      )}
                      {(() => {
                        const t = temperaturaLead(lead)
                        const relogio = relogioNovo(lead)
                        if (!t && !relogio) return null
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 mb-2">
                            {t && <SeloTemperatura t={t} />}
                            {relogio && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5"
                                style={{ color: relogio.cor, background: `${relogio.cor}1f` }}
                                title="Tempo desde que o lead chegou para você, sem nenhum contato registrado. Verde até 1h, amarelo até 4h, vermelho depois."
                              >
                                <Timer size={10} /> {relogio.texto}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                      <div className="mb-1" />

                      <LeadCardPreview lead={lead} />

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

                      {(lead.fromSite || lead.source === 'meta_ads_lead') && (
                        <div className="mb-2">
                          {lead.source === 'meta_ads_lead' ? (
                            <Badge className="text-purple-400 bg-purple-900/20 border-purple-700/40">📱 Meta Ads</Badge>
                          ) : (
                            <Badge className="text-cyan-400 bg-cyan-900/20 border-cyan-700/40">🌐 Veio do site</Badge>
                          )}
                        </div>
                      )}

                      {(lead.tagPprVerde || lead.tagOutrasLinhas) && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {lead.tagPprVerde && (
                            <Badge className="text-emerald-300 bg-emerald-900/20 border-emerald-700/40">🌿 PPR Verde</Badge>
                          )}
                          {lead.tagOutrasLinhas && (
                            <Badge className="text-teal-300 bg-teal-900/20 border-teal-700/40">📦 Outras Linhas</Badge>
                          )}
                        </div>
                      )}

                      {lead.convertidoParaPropostaId && (
                        <div className="mb-2">
                          <Link
                            to={`${propostasBasePath}/${lead.convertidoParaPropostaId}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Ver proposta gerada por este lead"
                          >
                            <Badge className="text-purple-400 bg-purple-900/20 border-purple-700/40 hover:bg-purple-900/40 cursor-pointer">
                              → Proposta #{lead.convertidoParaPropostaId}
                            </Badge>
                          </Link>
                        </div>
                      )}

                      {lead.status === 'novo_consumidor_final' && user?.role === 'vendor' && (
                        <Button
                          size="sm"
                          className="w-full mb-2"
                          loading={assumirMut.isPending}
                          onClick={(e) => {
                            e.stopPropagation()
                            assumirMut.mutate({ id: lead.id })
                          }}
                        >
                          <Hand size={13} className="mr-1" /> Pegar esse lead
                        </Button>
                      )}

                      {lead.status === 'consumidor_final' && lead.finalConsumerReason && (
                        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg mb-2 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                          <span className="text-xs font-medium">{lead.finalConsumerReason}</span>
                        </div>
                      )}

                      {lead.company && (
                        <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
                          <Building2 size={11} className="shrink-0" />
                          <span className="truncate min-w-0 flex-1">{lead.company}</span>
                        </div>
                      )}

                      {lead.compressorAtual && (
                        <p className="text-xs text-gold-300 mb-1.5 truncate" title={`Compressor que possui hoje: ${lead.compressorAtual}`}>
                          🔧 Tem hoje: {lead.compressorAtual}
                        </p>
                      )}

                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-xs text-dark-400">
                          <Phone size={11} />
                          <span>{leadTelefoneFormatado(lead.ddd, lead.phone)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {lead.email && <EmailButton email={lead.email} size="sm" />}
                          {lead.phone && <WhatsappButton telefone={leadTelefoneCompleto(lead.ddd, lead.phone)} size="sm" />}
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

                      {!terminal && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-dark-700/70" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setRegistrar(lead)}
                            className="flex items-center gap-1 text-[11px] font-medium text-gold-400 hover:text-gold-300 bg-gold-500/10 hover:bg-gold-500/20 rounded-md px-2 py-1 transition-colors"
                            title="Registrar ligação, WhatsApp ou e-mail e marcar o próximo contato"
                          >
                            <NotebookPen size={12} /> Registrar contato
                          </button>
                          <MensagensProntas lead={lead} vendedor={user?.name ?? lead.vendor?.name ?? ''} empresa={empresaNome} />
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
      {mudarEtapa && (
        <LeadChangeStatusModal
          leadId={mudarEtapa.lead.id}
          currentStatus={mudarEtapa.lead.status}
          initialStatus={mudarEtapa.para}
          empresaSlug={empresaSlug}
          open
          onClose={() => {
            setMudarEtapa(null)
            utils.leads.list.invalidate()
          }}
        />
      )}
      {registrar && (
        <Modal open onClose={() => setRegistrar(null)} title={`Registrar contato — ${registrar.name}`}>
          <LeadContactAttemptForm leadId={registrar.id} proximoContato={registrar.nextContactAt} encerrado={isLeadTerminalStatus(registrar.status)} />
        </Modal>
      )}
    </div>
  )
}
