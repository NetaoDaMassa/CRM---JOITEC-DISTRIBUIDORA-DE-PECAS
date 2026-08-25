import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Paperclip, Trash2, ArrowLeft, ShieldAlert } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import ContatoButtons from '../../components/ui/ContatoButtons'
import { timeAgo } from '../../lib/utils'
import LeadChangeStatusModal from '../../components/LeadChangeStatusModal'
import LeadReopenDisqualifiedModal from '../../components/LeadReopenDisqualifiedModal'
import LeadContactAttemptForm from '../../components/LeadContactAttemptForm'
import LeadNegotiationTagPicker from '../../components/LeadNegotiationTagPicker'
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_SEGMENT_LABELS,
  LEAD_CHANNEL_LABELS,
  LEAD_RESULT_LABELS,
  LEAD_PAYMENT_METHOD_LABELS,
  LEAD_PAYMENT_METHOD_VALUES,
  isLeadTerminalStatus,
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
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [saleValuesOpen, setSaleValuesOpen] = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [noteType, setNoteType] = useState<'nota' | 'lembrete'>('nota')
  const [noteNextContact, setNoteNextContact] = useState('')
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

  if (isLoading) return <div className="p-6 text-dark-400 text-sm">Carregando...</div>
  if (!lead) return <div className="p-6 text-dark-400 text-sm">Lead não encontrado.</div>

  const isOwner = !isAdmin || lead.vendorId === user?.id

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => navigate(basePath)} className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-dark-100 transition-colors">
        <ArrowLeft size={15} /> Voltar
      </button>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-heading text-xl text-dark-50 font-bold">{lead.name}</h1>
              {tracking && tracking.length > 0 && <span title="Veio do site">🌐</span>}
            </div>
            <p className="text-sm text-dark-400 mt-0.5">
              {lead.phone} {lead.company ? `· ${lead.company}` : ''} {lead.city ? `· ${lead.city}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ContatoButtons telefone={lead.phone} email={lead.email} size="md" />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-4">
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${LEAD_STATUS_COLORS[lead.status as keyof typeof LEAD_STATUS_COLORS]}`}>
            {LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS]}
          </span>
          <LeadNegotiationTagPicker leadId={lead.id} tag={lead.negotiationTag} />
          {isOwner && (
            <Button size="sm" onClick={() => setStatusModalOpen(true)}>
              Mudar etapa
            </Button>
          )}
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-dark-700 text-sm">
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Vendedor</p>
            <p className="text-dark-200 mt-0.5">{lead.vendor?.name ?? 'Sem vendedor'}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Região</p>
            <p className="text-dark-200 mt-0.5">{lead.region?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Segmento</p>
            <p className="text-dark-200 mt-0.5">{lead.segment ? LEAD_SEGMENT_LABELS[lead.segment] : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Origem</p>
            <p className="text-dark-200 mt-0.5">{lead.source ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Criado</p>
            <p className="text-dark-200 mt-0.5">{timeAgo(lead.createdAt)}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Próximo contato</p>
            <p className="text-dark-200 mt-0.5">{lead.nextContactAt ? timeAgo(lead.nextContactAt) : '—'}</p>
          </div>
          {lead.orderValue != null && (
            <div>
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">Valor do pedido</p>
              <p className="text-dark-200 mt-0.5">{lead.orderValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          )}
          {lead.finalOrderValue != null && (
            <div>
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">Valor final</p>
              <p className="text-green-400 mt-0.5">{lead.finalOrderValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          )}
          {lead.paymentMethod && (
            <div>
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">Pagamento</p>
              <p className="text-dark-200 mt-0.5">{LEAD_PAYMENT_METHOD_LABELS[lead.paymentMethod]}</p>
            </div>
          )}
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
        </div>
        {lead.observations && (
          <div className="mt-4 pt-4 border-t border-dark-700">
            <p className="text-[10px] text-dark-500 uppercase tracking-wide mb-1">Observações</p>
            <p className="text-sm text-dark-300 whitespace-pre-wrap">{lead.observations}</p>
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
              <div className="grid grid-cols-2 gap-2">
                <Select value={noteType} onChange={(e) => setNoteType(e.target.value as any)} options={[{ value: 'nota', label: 'Nota' }, { value: 'lembrete', label: 'Lembrete' }]} />
                {noteType === 'lembrete' && (
                  <Input type="datetime-local" value={noteNextContact} onChange={(e) => setNoteNextContact(e.target.value)} />
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
              lead.notes.map((n) => (
                <div key={n.id} className="text-xs bg-dark-900/60 rounded-lg px-3 py-2">
                  <p className="text-dark-200 whitespace-pre-wrap">
                    {n.type === 'lembrete' ? '⏰ ' : ''}
                    {n.content}
                  </p>
                  <p className="text-dark-500 mt-1">
                    {n.user?.name ?? '—'} · {timeAgo(n.createdAt)}
                  </p>
                </div>
              ))
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
                <div key={a.id} className="flex items-center justify-between text-xs bg-dark-900/60 rounded-lg px-3 py-2">
                  <a href={`/uploads/${a.filename}`} target="_blank" rel="noopener noreferrer" className="text-dark-200 hover:text-gold-400 truncate">
                    {a.originalName}
                  </a>
                  {isOwner && (
                    <button onClick={() => deleteAttachmentMut.mutate({ id: a.id })} className="text-dark-500 hover:text-red-400 shrink-0 ml-2">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">Histórico</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {lead.history.map((h) => (
              <div key={h.id} className="text-xs">
                <p className="text-dark-200">{HISTORY_ACTION_LABELS[h.action] ?? h.action}</p>
                <p className="text-dark-500">
                  {h.user?.name ?? 'Sistema'} · {timeAgo(h.createdAt)}
                  {h.details ? ` — ${h.details}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {tracking && tracking.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <p className="text-sm font-semibold text-dark-100 mb-3">🌐 Atividade no site</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {tracking.map((t) => (
              <div key={t.id} className="text-xs">
                <p className="text-dark-200">
                  {TRACKING_EVENT_LABELS[t.eventType] ?? t.eventType} {t.pageTitle ? `— ${t.pageTitle}` : ''}
                </p>
                <p className="text-dark-500">{timeAgo(t.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <LeadChangeStatusModal leadId={lead.id} currentStatus={lead.status} empresaSlug={empresaSlug} open={statusModalOpen} onClose={() => setStatusModalOpen(false)} />
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
