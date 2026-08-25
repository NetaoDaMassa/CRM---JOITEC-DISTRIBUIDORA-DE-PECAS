import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Paperclip, Trash2, ArrowLeft, ShieldAlert, Phone, Mail, Building2, MapPin, Calendar, Clock,
  MessageSquare, Repeat2, Bell, Eye, MousePointerClick, FileText, Download, ChevronDown, Hash, AlertCircle, Pencil,
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import ContatoButtons from '../../components/ui/ContatoButtons'
import { WhatsappButton } from '../../components/ui/ContatoButtons'
import EmailButton from '../../components/ui/EmailButton'
import { Badge } from '../../components/ui/Badge'
import { timeAgo, formatElapsed } from '../../lib/utils'
import LeadChangeStatusModal from '../../components/LeadChangeStatusModal'
import LeadReopenDisqualifiedModal from '../../components/LeadReopenDisqualifiedModal'
import LeadContactAttemptForm from '../../components/LeadContactAttemptForm'
import LeadNegotiationTagPicker from '../../components/LeadNegotiationTagPicker'
import {
  LEAD_STATUS_VALUES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_SEGMENT_LABELS,
  LEAD_CHANNEL_LABELS,
  LEAD_RESULT_LABELS,
  LEAD_PAYMENT_METHOD_LABELS,
  LEAD_PAYMENT_METHOD_VALUES,
  isLeadTerminalStatus,
  isLeadStatusAllowedForEmpresa,
  getLeadContactUrgency,
} from '../../lib/leadsShared'

const HISTORY_ACTION_LABELS: Record<string, string> = {
  criado: 'Lead criado',
  status_alterado: 'Mudança de etapa',
  reaberto_desqualificado: 'Reaberto (era desqualificado)',
  desqualificacao_aprovada: 'Desqualificação confirmada',
  tentativa_contato: 'Tentativa de contato',
  transferido: 'Transferido de vendedor',
  excluido: 'Excluído',
  reatribuicao_automatica: 'Reatribuído por rodízio',
}

const TRACKING_EVENT_LABELS: Record<string, string> = {
  page_view: 'Visitou uma página',
  click: 'Clicou em um botão',
  form_submit: 'Preencheu um formulário',
  ebook_download: 'Baixou um material',
  blog_signup: 'Assinou o blog',
}
const TRACKING_EVENT_ICONS: Record<string, typeof Eye> = {
  page_view: Eye,
  click: MousePointerClick,
  form_submit: FileText,
  ebook_download: Download,
  blog_signup: Bell,
}

const NOTE_TYPE_ICONS: Record<string, { icon: typeof MessageSquare; classes: string }> = {
  nota: { icon: MessageSquare, classes: 'text-blue-400' },
  followup: { icon: Repeat2, classes: 'text-gold-400' },
  lembrete: { icon: Bell, classes: 'text-purple-400' },
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] text-dark-500 uppercase tracking-wide">
        <Icon size={11} /> {label}
      </p>
      <div className="text-dark-200 mt-0.5">{children}</div>
    </div>
  )
}

function MessageTemplateMenu({ phone, email }: { phone: string; email: string | null }) {
  const [open, setOpen] = useState(false)
  const { data: templates } = trpc.messageTemplates.list.useQuery()

  if (!templates || templates.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 border border-gold-600/30 hover:border-gold-500/60 rounded-lg px-2.5 py-1.5 transition-colors"
      >
        Mensagens prontas <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl p-2 max-h-80 overflow-y-auto">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-dark-700">
                <span className="text-xs text-dark-200 truncate">{t.label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {email && <EmailButton email={email} subject={t.emailSubject} body={t.emailBody} size="sm" />}
                  <WhatsappButton telefone={phone} mensagem={t.whatsappText} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LeadDetailSkeleton() {
  return (
    <div className="p-6 space-y-5">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-12 bg-dark-800 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

export default function LeadDetail() {
  const { id } = useParams()
  const leadId = Number(id)
  const navigate = useNavigate()
  const { user, empresaAtivaId } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/leads' : '/vendedor/leads'
  const utils = trpc.useUtils()

  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaSlug = empresas?.find((e) => e.id === empresaAtivaId)?.slug

  const { data: lead, isLoading } = trpc.leads.get.useQuery({ id: leadId }, { enabled: !!leadId })
  const { data: tracking } = trpc.leads.trackingHistory.useQuery({ id: leadId }, { enabled: !!leadId })

  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<string | undefined>(undefined)
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [saleValuesOpen, setSaleValuesOpen] = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [noteType, setNoteType] = useState<'nota' | 'lembrete'>('nota')
  const [noteNextContact, setNoteNextContact] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editNextContact, setEditNextContact] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addNoteMut = trpc.leads.addNote.useMutation({
    onSuccess() {
      toast.success('Anotação adicionada')
      utils.leads.get.invalidate({ id: leadId })
      setNoteContent('')
      setNoteNextContact('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const updateNoteMut = trpc.leads.updateNote.useMutation({
    onSuccess() {
      toast.success('Anotação atualizada')
      utils.leads.get.invalidate({ id: leadId })
      setEditingNoteId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const addAttachmentMut = trpc.leads.addAttachment.useMutation({
    onSuccess() {
      toast.success('Anexo adicionado')
      utils.leads.get.invalidate({ id: leadId })
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const deleteAttachmentMut = trpc.leads.deleteAttachment.useMutation({
    onSuccess() {
      toast.success('Anexo removido')
      utils.leads.get.invalidate({ id: leadId })
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const deleteMut = trpc.leads.delete.useMutation({
    onSuccess() {
      toast.success('Lead excluído')
      navigate(basePath)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const token = localStorage.getItem('odin_token')
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/upload/lead-attachment', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      if (!res.ok) {
        toast.error('Falha ao enviar o arquivo')
        return
      }
      const data = await res.json()
      addAttachmentMut.mutate({ leadId, filename: data.path, originalName: data.originalName, mimeType: data.mimeType, size: data.size })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (isLoading) return <LeadDetailSkeleton />
  if (!lead) return <div className="p-6 text-dark-400 text-sm">Lead não encontrado.</div>

  const isOwner = !isAdmin || lead.vendorId === user?.id
  const urgency = lead.nextContactAt ? getLeadContactUrgency(lead.nextContactAt, lead.status) : null
  const terminal = isLeadTerminalStatus(lead.status)
  const tempoAtendimento = lead.assignedAt
    ? terminal && lead.statusChangedAt
      ? `Tempo de atendimento: ${formatElapsed(lead.assignedAt, lead.statusChangedAt)}`
      : `Em atendimento há ${formatElapsed(lead.assignedAt)}`
    : null

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => navigate(basePath)} className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-dark-100 transition-colors">
        <ArrowLeft size={15} /> Voltar
      </button>

      {lead.requiresAttachment && (
        <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 text-yellow-300 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          Este lead precisa de um anexo (ex: comprovante/proposta) antes de avançar de etapa.
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-heading text-xl text-gold-400 font-bold">{lead.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <Badge className="text-dark-400 bg-dark-700/50 border-dark-600">
                <Hash size={10} className="mr-0.5" />
                {lead.id}
              </Badge>
              <Badge className="text-dark-400 bg-dark-700/50 border-dark-600">Criado {timeAgo(lead.createdAt)}</Badge>
              {urgency?.atrasado && (
                <Badge className="text-red-400 bg-red-900/20 border-red-700/40">Atrasado {timeAgo(lead.nextContactAt!)}</Badge>
              )}
              {tracking && tracking.length > 0 && <Badge className="text-cyan-400 bg-cyan-900/20 border-cyan-700/40">🌐 Veio do site</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lead.status === 'abordagem' && <MessageTemplateMenu phone={lead.phone} email={lead.email} />}
            <ContatoButtons telefone={lead.phone} email={lead.email} size="md" />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-4">
          {isAdmin && lead.status === 'desqualificado' && (
            <Button size="sm" variant="secondary" onClick={() => setReopenModalOpen(true)}>
              <ShieldAlert size={14} /> Reabrir
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => setSaleValuesOpen(true)}>
              Corrigir valores
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (confirm(`Excluir o lead "${lead.name}"?`)) deleteMut.mutate({ id: lead.id })
              }}
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
        </div>

        {/* Posição na etapa — clicar em outra etapa já abre o modal com ela pré-selecionada */}
        {isOwner && (
          <div className="flex items-center gap-1.5 flex-wrap mt-4 pt-4 border-t border-dark-700">
            {LEAD_STATUS_VALUES.filter((s) => isLeadStatusAllowedForEmpresa(s, empresaSlug)).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setPendingStatus(s)
                  setStatusModalOpen(true)
                }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  s === lead.status
                    ? 'bg-gold-600/20 border-gold-600/40 text-gold-300 font-semibold'
                    : 'bg-dark-900/40 border-dark-700 text-dark-400 hover:border-gold-600/40 hover:text-gold-300'
                }`}
              >
                {LEAD_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-dark-700 text-sm">
          <InfoRow icon={Phone} label="Telefone">
            ({lead.ddd}) {lead.phone}
          </InfoRow>
          {lead.email && <InfoRow icon={Mail} label="E-mail">{lead.email}</InfoRow>}
          {lead.company && <InfoRow icon={Building2} label="Empresa">{lead.company}</InfoRow>}
          {lead.city && <InfoRow icon={MapPin} label="Cidade">{lead.city}</InfoRow>}
          <InfoRow icon={MapPin} label="Vendedor">{lead.vendor?.name ?? 'Sem vendedor'}</InfoRow>
          <InfoRow icon={MapPin} label="Região">{lead.region?.name ?? '—'}</InfoRow>
          <InfoRow icon={Building2} label="Segmento">{lead.segment ? LEAD_SEGMENT_LABELS[lead.segment] : '—'}</InfoRow>
          <InfoRow icon={Building2} label="Origem">{lead.source ?? '—'}</InfoRow>
          {tempoAtendimento && (
            <InfoRow icon={Clock} label="Atendimento">
              {tempoAtendimento}
            </InfoRow>
          )}
          <InfoRow icon={Calendar} label="Próximo contato">
            {lead.nextContactAt ? timeAgo(lead.nextContactAt) : '—'}
          </InfoRow>
          {lead.orderValue != null && (
            <InfoRow icon={Building2} label="Valor do pedido">
              {lead.orderValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </InfoRow>
          )}
          {lead.finalOrderValue != null && (
            <InfoRow icon={Building2} label="Valor final">
              <span className="text-green-400">{lead.finalOrderValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </InfoRow>
          )}
          {lead.paymentMethod && <InfoRow icon={Building2} label="Pagamento">{LEAD_PAYMENT_METHOD_LABELS[lead.paymentMethod]}</InfoRow>}
          {lead.lossReason && (
            <div className="col-span-2">
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">Motivo da perda</p>
              <p className="text-red-300 mt-0.5">{lead.lossReason}</p>
            </div>
          )}
          {lead.disqualifyReason && (
            <div className="col-span-2">
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">Motivo da desqualificação</p>
              <p className="text-dark-300 mt-0.5">{lead.disqualifyReason}</p>
            </div>
          )}
          {lead.status === 'consumidor_final' && lead.finalConsumerReason && (
            <div className="col-span-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
              <MessageSquare size={12} className="shrink-0 mt-0.5" />
              <span className="text-xs font-medium">{lead.finalConsumerReason}</span>
            </div>
          )}
        </div>
        {lead.observations && (
          <div className="mt-4 pt-4 border-t border-dark-700">
            <p className="text-[10px] text-dark-500 uppercase tracking-wide mb-1">Observações</p>
            <p className="text-sm text-dark-300 whitespace-pre-wrap">{lead.observations}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex flex-col justify-center">
          <p className="text-[10px] text-dark-500 uppercase tracking-wide">Tentativas na etapa atual</p>
          <p className="text-2xl font-bold text-dark-100 mt-1">{lead.attemptCount ?? 0}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-2">Destaque da negociação</p>
          <LeadNegotiationTagPicker leadId={lead.id} tag={lead.negotiationTag} />
        </div>
        {isAdmin && lead.status === 'desqualificado' && (
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <p className="text-sm font-semibold text-dark-100 mb-1">Devolver pro Kanban</p>
            <p className="text-xs text-dark-500 mb-3">Reabre o lead numa etapa ativa e reatribui por rodízio.</p>
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setReopenModalOpen(true)}>
              <ShieldAlert size={14} /> Reabrir lead
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Tentativas de contato</p>
          {isOwner && <LeadContactAttemptForm leadId={lead.id} hasNextContact={!!lead.nextContactAt} />}
          <div className="space-y-2 mt-3 max-h-80 overflow-y-auto">
            {lead.contactAttempts.length === 0 ? (
              <p className="text-xs text-dark-500">Nenhuma tentativa registrada.</p>
            ) : (
              lead.contactAttempts.map((a) => (
                <div key={a.id} className="text-xs bg-dark-900/60 rounded-lg px-3 py-2">
                  <p className="text-dark-200">
                    {LEAD_CHANNEL_LABELS[a.channel]} · {LEAD_RESULT_LABELS[a.result]}
                  </p>
                  <p className="text-dark-500 mt-0.5">
                    {a.user?.name ?? '—'} · {timeAgo(a.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Notas e lembretes</p>
          {isOwner && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!noteContent.trim()) return
                addNoteMut.mutate({ leadId: lead.id, type: noteType, content: noteContent, nextContactAt: noteType === 'lembrete' ? noteNextContact || undefined : undefined })
              }}
              className="space-y-2 mb-3"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNoteType('nota')}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${noteType === 'nota' ? 'bg-blue-600/20 border-blue-600/40 text-blue-300' : 'bg-dark-900/40 border-dark-700 text-dark-400'}`}
                >
                  Nota
                </button>
                <button
                  type="button"
                  onClick={() => setNoteType('lembrete')}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${noteType === 'lembrete' ? 'bg-purple-600/20 border-purple-600/40 text-purple-300' : 'bg-dark-900/40 border-dark-700 text-dark-400'}`}
                >
                  Lembrete
                </button>
                {noteType === 'lembrete' && (
                  <Input type="datetime-local" value={noteNextContact} onChange={(e) => setNoteNextContact(e.target.value)} className="flex-1" />
                )}
              </div>
              <Textarea placeholder="Escreva aqui..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={2} />
              <Button type="submit" size="sm" loading={addNoteMut.isPending}>
                Adicionar
              </Button>
            </form>
          )}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {lead.notes.length === 0 ? (
              <p className="text-xs text-dark-500">Nenhuma nota ainda.</p>
            ) : (
              lead.notes.map((n) => {
                const { icon: NoteIcon, classes } = NOTE_TYPE_ICONS[n.type] ?? NOTE_TYPE_ICONS.nota
                const isEditing = editingNoteId === n.id
                return (
                  <div key={n.id} className="text-xs bg-dark-900/60 rounded-lg px-3 py-2">
                    <div className="flex items-start gap-2">
                      <NoteIcon size={13} className={`shrink-0 mt-0.5 ${classes}`} />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} />
                            {n.type === 'lembrete' && (
                              <Input type="datetime-local" value={editNextContact} onChange={(e) => setEditNextContact(e.target.value)} />
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setEditingNoteId(null)}>
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                loading={updateNoteMut.isPending}
                                onClick={() => updateNoteMut.mutate({ id: n.id, content: editContent, nextContactAt: n.type === 'lembrete' ? editNextContact || undefined : undefined })}
                              >
                                Salvar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-dark-200 whitespace-pre-wrap">{n.content}</p>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-dark-500">
                                {n.user?.name ?? '—'} · {timeAgo(n.createdAt)}
                              </p>
                              {isOwner && (
                                <button
                                  onClick={() => {
                                    setEditingNoteId(n.id)
                                    setEditContent(n.content)
                                    setEditNextContact(n.nextContactAt ?? '')
                                  }}
                                  className="text-dark-500 hover:text-gold-400"
                                >
                                  <Pencil size={11} />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-dark-100">Anexos</p>
            {isOwner && (
              <label className="text-xs text-gold-400 hover:underline cursor-pointer">
                <Paperclip size={12} className="inline mr-1" />
                {uploading ? 'Enviando...' : 'Anexar arquivo'}
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} disabled={uploading} />
              </label>
            )}
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {lead.attachments.length === 0 ? (
              <p className="text-xs text-dark-500">Nenhum anexo.</p>
            ) : (
              lead.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/uploads/${a.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-xs bg-dark-900/60 hover:bg-dark-700 rounded-lg px-3 py-2 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0 text-dark-200 hover:text-gold-400">
                    <Paperclip size={12} className="shrink-0" />
                    <span className="truncate">{a.originalName}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-dark-500">{timeAgo(a.createdAt)}</span>
                    {isOwner && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          deleteAttachmentMut.mutate({ id: a.id })
                        }}
                        className="text-dark-500 hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Histórico</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {lead.history.map((h) => (
              <div key={h.id} className="flex items-start gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-dark-500 shrink-0 mt-1.5" />
                <div>
                  <p className="text-dark-200">{HISTORY_ACTION_LABELS[h.action] ?? h.action}</p>
                  <p className="text-dark-500">
                    {h.user?.name ?? 'Sistema'} · {timeAgo(h.createdAt)}
                    {h.details ? ` — ${h.details}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <p className="text-sm font-semibold text-dark-100 mb-3">🌐 Atividade no site</p>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {!tracking || tracking.length === 0 ? (
            <p className="text-xs text-dark-500">Nenhuma atividade registrada ainda.</p>
          ) : (
            tracking.map((t) => {
              const Icon = TRACKING_EVENT_ICONS[t.eventType] ?? Eye
              return (
                <div key={t.id} className="flex items-start gap-2 text-xs bg-dark-700/50 rounded-xl px-3 py-2">
                  <Icon size={13} className="text-blue-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-dark-200">
                      {TRACKING_EVENT_LABELS[t.eventType] ?? t.eventType} {t.pageTitle ? `— ${t.pageTitle}` : ''}
                    </p>
                    {t.metadata && typeof t.metadata === 'object' && 'ebook' in t.metadata && (
                      <p className="text-dark-500">Material: {String((t.metadata as Record<string, unknown>).ebook)}</p>
                    )}
                    {(t.utmSource || t.utmCampaign) && (
                      <p className="text-dark-500">
                        {t.utmSource ? `origem: ${t.utmSource}` : ''} {t.utmCampaign ? `· campanha: ${t.utmCampaign}` : ''}
                      </p>
                    )}
                    <p className="text-dark-500">{timeAgo(t.createdAt)}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <LeadChangeStatusModal
        leadId={lead.id}
        currentStatus={lead.status}
        initialStatus={pendingStatus}
        empresaSlug={empresaSlug}
        open={statusModalOpen}
        onClose={() => {
          setStatusModalOpen(false)
          setPendingStatus(undefined)
        }}
      />
      <LeadReopenDisqualifiedModal leadId={lead.id} empresaSlug={empresaSlug} open={reopenModalOpen} onClose={() => setReopenModalOpen(false)} />
      <SaleValuesModal lead={lead} open={saleValuesOpen} onClose={() => setSaleValuesOpen(false)} />
    </div>
  )
}

function SaleValuesModal({ lead, open, onClose }: { lead: any; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [codSap, setCodSap] = useState(lead.codSap ?? '')
  const [orderValue, setOrderValue] = useState(lead.orderValue?.toString() ?? '')
  const [finalOrderValue, setFinalOrderValue] = useState(lead.finalOrderValue?.toString() ?? '')
  const [paymentMethod, setPaymentMethod] = useState(lead.paymentMethod ?? '')

  const mut = trpc.leads.updateSaleValues.useMutation({
    onSuccess() {
      toast.success('Valores atualizados')
      utils.leads.get.invalidate({ id: lead.id })
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Corrigir valores da venda" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          mut.mutate({
            id: lead.id,
            codSap: codSap || undefined,
            orderValue: orderValue ? Number(orderValue) : null,
            finalOrderValue: finalOrderValue ? Number(finalOrderValue) : null,
            paymentMethod: (paymentMethod || null) as any,
          })
        }}
        className="space-y-4"
      >
        <Input label="Código SAP" value={codSap} onChange={(e) => setCodSap(e.target.value)} />
        <Input label="Valor do pedido" type="number" step="0.01" value={orderValue} onChange={(e) => setOrderValue(e.target.value)} />
        <Input label="Valor final do pedido" type="number" step="0.01" value={finalOrderValue} onChange={(e) => setFinalOrderValue(e.target.value)} />
        <Select
          label="Forma de pagamento"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          placeholder="—"
          options={LEAD_PAYMENT_METHOD_VALUES.map((p) => ({ value: p, label: LEAD_PAYMENT_METHOD_LABELS[p] }))}
        />
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  )
}
