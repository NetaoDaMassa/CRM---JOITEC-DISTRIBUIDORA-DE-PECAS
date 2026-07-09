import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, Building2, MapPin, Calendar, Edit3,
  MessageSquare, Repeat2, Bell, Paperclip, AlertCircle, ArrowRightLeft, Trash2, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import ChangeStatusModal from '../../components/ChangeStatusModal'
import ContactAttemptForm from '../../components/ContactAttemptForm'
import MessageTemplateMenu from '../../components/MessageTemplateMenu'
import WhatsAppButton from '../../components/ui/WhatsAppButton'
import EmailButton from '../../components/ui/EmailButton'
import { StatusBadge } from '../../components/ui/Badge'
import { STATUS_LABELS, STATUS_ORDER, SEGMENT_LABELS, formatDateTime, timeAgo } from '../../lib/utils'
import { PAYMENT_METHOD_OPTIONS } from '../../lib/statusFields'

const NOTE_ICONS = { nota: MessageSquare, followup: Repeat2, lembrete: Bell }
const NOTE_COLORS = { nota: 'text-blue-400', followup: 'text-gold-400', lembrete: 'text-purple-400' }

export default function AdminLeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const leadId = parseInt(id!)

  const [editMode, setEditMode] = useState(false)
  const [noteType, setNoteType] = useState<'nota' | 'lembrete'>('nota')
  const [noteContent, setNoteContent] = useState('')
  const [nextContact, setNextContact] = useState('')
  const [transferModal, setTransferModal] = useState(false)
  const [transferTo, setTransferTo] = useState('')
  const [deleteModal, setDeleteModal] = useState(false)
  const [statusModalTarget, setStatusModalTarget] = useState<string | null>(null)

  // Edit form
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editSegment, setEditSegment] = useState('')
  const [editObs, setEditObs] = useState('')
  const [editNextContact, setEditNextContact] = useState('')

  const { data: lead, isLoading } = trpc.leads.get.useQuery({ id: leadId }, {
    onSuccess(data: any) {
      if (editMode) return
      setEditName(data.name)
      setEditEmail(data.email ?? '')
      setEditCompany(data.company ?? '')
      setEditSegment(data.segment ?? '')
      setEditObs(data.observations ?? '')
      setEditNextContact(data.nextContactAt ? new Date(data.nextContactAt).toISOString().slice(0, 16) : '')
    },
  } as any)

  const { data: vendors } = trpc.users.vendors.useQuery()

  const updateMut = trpc.leads.update.useMutation({
    onSuccess() {
      toast.success('Lead atualizado')
      utils.leads.get.invalidate({ id: leadId })
      setEditMode(false)
    },
    onError(err) { toast.error(err.message) },
  })

  const addNoteMut = trpc.leads.addNote.useMutation({
    onSuccess() {
      toast.success('Anotação registrada')
      utils.leads.get.invalidate({ id: leadId })
      setNoteContent('')
      setNextContact('')
    },
    onError(err) { toast.error(err.message) },
  })

  const transferMut = trpc.leads.transfer.useMutation({
    onSuccess() {
      toast.success('Lead transferido')
      utils.leads.get.invalidate({ id: leadId })
      setTransferModal(false)
    },
  })

  const deleteMut = trpc.leads.delete.useMutation({
    onSuccess() {
      toast.success('Lead excluído')
      navigate('/admin/leads')
    },
  })

  if (isLoading || !lead) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-dark-800 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  function handleSave() {
    updateMut.mutate({
      id: leadId,
      name: editName,
      email: editEmail,
      company: editCompany,
      segment: editSegment as any,
      observations: editObs,
      nextContactAt: editNextContact || null,
    })
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin/leads')} className="text-dark-400 hover:text-dark-100 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="font-heading text-xl text-gold-400 font-bold">{lead.name}</h1>
          <p className="text-dark-400 text-sm mb-2">Lead #{lead.id} · Criado {timeAgo(lead.createdAt)}</p>
          <div className="flex items-center gap-2">
            <WhatsAppButton ddd={lead.ddd} phone={lead.phone} size="sm" />
            {lead.email && <EmailButton email={lead.email} size="sm" />}
            {lead.status === 'abordagem' && (
              <MessageTemplateMenu leadName={lead.name} ddd={lead.ddd} phone={lead.phone} email={lead.email} />
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTransferModal(true)}>
            <ArrowRightLeft size={14} />Transferir
          </Button>
          <Button variant={editMode ? 'primary' : 'secondary'} size="sm" onClick={editMode ? handleSave : () => setEditMode(true)} loading={updateMut.isPending}>
            <Edit3 size={14} />{editMode ? 'Salvar' : 'Editar'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {lead.requiresAttachment && (
        <div className="flex items-center gap-3 bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
          <AlertCircle className="text-yellow-500 shrink-0" size={18} />
          <p className="text-yellow-400 text-sm">Este lead requer um anexo após múltiplos follow-ups sem avanço de status.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Info card */}
        <div className="col-span-2 bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
          <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide">Informações do Lead</h2>
          {editMode ? (
            <div className="grid grid-cols-2 gap-4">
              <Input label="Nome" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <Input label="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              <Input label="Empresa" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
              <Select label="Segmento" value={editSegment} onChange={(e) => setEditSegment(e.target.value)}
                options={[
                  { value: 'assistente_tecnico', label: 'Assistente Técnico' },
                  { value: 'instalador', label: 'Instalador' },
                  { value: 'revendedor_lojista', label: 'Revendedor/Lojista' },
                  { value: 'outros', label: 'Outros' },
                ]} placeholder="Selecione..." />
              <Input label="Próximo contato" type="datetime-local" value={editNextContact} onChange={(e) => setEditNextContact(e.target.value)} />
              <div className="col-span-2">
                <Textarea label="Observações" value={editObs} onChange={(e) => setEditObs(e.target.value)} rows={3} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <InfoRow icon={<Phone size={14} />} label="Telefone" value={`(${lead.ddd}) ${lead.phone}`} />
                <InfoRow
                  icon={<Mail size={14} />}
                  label="Email"
                  value={
                    lead.email ? (
                      <a href={`mailto:${lead.email}`} className="text-blue-400 hover:text-blue-300 hover:underline">
                        {lead.email}
                      </a>
                    ) : (
                      '—'
                    )
                  }
                />
                <InfoRow icon={<Building2 size={14} />} label="Empresa" value={lead.company ?? '—'} />
                <InfoRow icon={null} label="Segmento" value={SEGMENT_LABELS[lead.segment ?? ''] ?? '—'} />
                <InfoRow icon={<MapPin size={14} />} label="Região" value={lead.region?.name ?? '—'} />
                <InfoRow icon={null} label="Vendedor" value={lead.vendor?.name ?? '—'} />
                <InfoRow icon={null} label="Fonte" value={lead.source ?? '—'} />
                <InfoRow icon={<Calendar size={14} />} label="Próximo contato"
                  value={lead.nextContactAt ? formatDateTime(lead.nextContactAt) : '—'} />
              </div>
              {(lead.codSap || lead.orderValue || lead.finalOrderValue || lead.paymentMethod || lead.lossReason || lead.disqualifyReason) && (
                <div className="pt-3 border-t border-dark-600 grid grid-cols-2 gap-4">
                  {lead.codSap && <InfoRow icon={null} label="Código SAP" value={lead.codSap} />}
                  {lead.orderValue != null && <InfoRow icon={null} label="Valor do Pedido" value={`R$ ${lead.orderValue}`} />}
                  {lead.finalOrderValue != null && <InfoRow icon={null} label="Valor Final" value={`R$ ${lead.finalOrderValue}`} />}
                  {lead.paymentMethod && (
                    <InfoRow icon={null} label="Forma de Pagamento"
                      value={PAYMENT_METHOD_OPTIONS.find((o) => o.value === lead.paymentMethod)?.label ?? lead.paymentMethod} />
                  )}
                  {lead.lossReason && (
                    <div className="col-span-2">
                      <InfoRow icon={null} label="Motivo da Perda" value={lead.lossReason} />
                    </div>
                  )}
                  {lead.disqualifyReason && (
                    <div className="col-span-2">
                      <InfoRow icon={null} label="Motivo da Desqualificação" value={lead.disqualifyReason} />
                    </div>
                  )}
                </div>
              )}
              {lead.observations && (
                <div className="pt-3 border-t border-dark-600">
                  <p className="text-xs text-dark-400 mb-1">Observações</p>
                  <p className="text-sm text-dark-200">{lead.observations}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status card */}
        <div className="space-y-4">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
            <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide mb-4">Status</h2>
            <div className="space-y-2">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => s !== lead.status && setStatusModalTarget(s)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all ${
                    lead.status === s
                      ? 'bg-gold-600/20 border border-gold-600/40 text-gold-300'
                      : 'hover:bg-dark-700 text-dark-400 border border-transparent'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
            <p className="text-xs text-dark-400 mb-2">Tentativas na etapa atual</p>
            <p className="text-2xl font-bold text-dark-100">{lead.attemptCount ?? 0}</p>
          </div>
        </div>
      </div>

      <ContactAttemptForm leadId={leadId} lead={lead} />

      {/* Attachments */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-gold-400 font-semibold">Anexos</h2>
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const form = new FormData()
              form.append('file', file)
              const token = localStorage.getItem('odin_token')
              const res = await fetch(`/upload/${leadId}`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: form,
              })
              if (res.ok) {
                toast.success('Arquivo enviado')
                utils.leads.get.invalidate({ id: leadId })
              } else {
                toast.error('Erro ao enviar arquivo')
              }
              e.target.value = ''
            }} />
            <Button variant="outline" size="sm" type="button">
              <Plus size={14} />Adicionar
            </Button>
          </label>
        </div>
        {lead.attachments.length === 0 ? (
          <p className="text-dark-500 text-sm">Nenhum anexo</p>
        ) : (
          <div className="space-y-2">
            {lead.attachments.map((att: any) => (
              <a
                key={att.id}
                href={`/uploads/${att.filename}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-dark-700 rounded-xl hover:bg-dark-600 transition-colors"
              >
                <Paperclip size={14} className="text-gold-400 shrink-0" />
                <span className="text-sm text-dark-200 truncate">{att.originalName}</span>
                <span className="text-xs text-dark-500 ml-auto">{timeAgo(att.createdAt)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Add note */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
        <h2 className="font-heading text-gold-400 font-semibold">Registrar Anotação</h2>
        <div className="flex gap-2">
          {(['nota', 'lembrete'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setNoteType(t)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-all ${
                noteType === t
                  ? 'bg-gold-600/20 text-gold-400 border border-gold-600/40'
                  : 'bg-dark-700 text-dark-400 border border-dark-600 hover:text-dark-200'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <Textarea
          placeholder={`Digite ${noteType === 'lembrete' ? 'o lembrete' : 'a nota'}...`}
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          rows={3}
        />
        {noteType === 'lembrete' && (
          <Input
            label="Próximo contato (opcional)"
            type="datetime-local"
            value={nextContact}
            onChange={(e) => setNextContact(e.target.value)}
          />
        )}
        <Button
          size="sm"
          loading={addNoteMut.isPending}
          disabled={!noteContent.trim()}
          onClick={() => addNoteMut.mutate({ leadId, type: noteType, content: noteContent, nextContactAt: nextContact || null })}
        >
          Salvar Anotação
        </Button>
      </div>

      {/* Timeline */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="font-heading text-gold-400 font-semibold mb-4">Histórico</h2>
        <div className="space-y-3">
          {lead.notes.map((note: any) => {
            const Icon = NOTE_ICONS[note.type as keyof typeof NOTE_ICONS]
            return (
              <div key={note.id} className="flex gap-3 p-3 bg-dark-700/50 rounded-xl">
                <Icon size={16} className={`mt-0.5 shrink-0 ${NOTE_COLORS[note.type as keyof typeof NOTE_COLORS]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-dark-300">{note.user?.name}</span>
                    <span className="text-xs text-dark-500">{timeAgo(note.createdAt)}</span>
                  </div>
                  <p className="text-sm text-dark-200 whitespace-pre-wrap">{note.content}</p>
                  {note.nextContactAt && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-gold-500">
                      <Calendar size={11} />Contato em {formatDateTime(note.nextContactAt)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {lead.history.map((h: any) => (
            <div key={h.id} className="flex gap-3 px-3 py-2">
              <div className="w-1.5 h-1.5 rounded-full bg-dark-500 mt-2 shrink-0" />
              <div>
                <span className="text-xs text-dark-500">{timeAgo(h.createdAt)} · </span>
                <span className="text-xs text-dark-400">{h.details}</span>
              </div>
            </div>
          ))}
          {lead.notes.length === 0 && lead.history.length <= 1 && (
            <p className="text-dark-500 text-sm">Sem histórico ainda</p>
          )}
        </div>
      </div>

      {/* Transfer modal */}
      <Modal open={transferModal} onClose={() => setTransferModal(false)} title="Transferir Lead" size="sm">
        <div className="space-y-4">
          <Select
            label="Novo vendedor"
            options={vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []}
            placeholder="Selecione..."
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
          />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setTransferModal(false)}>Cancelar</Button>
            <Button className="flex-1" disabled={!transferTo} loading={transferMut.isPending}
              onClick={() => transferTo && transferMut.mutate({ leadId, newVendorId: parseInt(transferTo) })}>
              Transferir
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Confirmar Exclusão" size="sm">
        <p className="text-dark-300 mb-6">Tem certeza que deseja excluir o lead <strong className="text-dark-100">{lead.name}</strong>?</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteModal(false)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={deleteMut.isPending}
            onClick={() => deleteMut.mutate({ id: leadId })}>Excluir</Button>
        </div>
      </Modal>

      {/* Change status modal */}
      {statusModalTarget && (
        <ChangeStatusModal
          open={!!statusModalTarget}
          onClose={() => setStatusModalTarget(null)}
          lead={lead}
          targetStatus={statusModalTarget}
        />
      )}
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-0.5">
        {icon}
        {label}
      </div>
      <p className="text-sm text-dark-100">{value}</p>
    </div>
  )
}
