import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, Building2, MapPin, Calendar, Edit3,
  MessageSquare, Repeat2, Bell, Paperclip, AlertCircle, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
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

export default function VendorLeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const leadId = parseInt(id!)

  const [noteType, setNoteType] = useState<'nota' | 'lembrete'>('nota')
  const [noteContent, setNoteContent] = useState('')
  const [nextContact, setNextContact] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [statusModalTarget, setStatusModalTarget] = useState<string | null>(null)

  const [editObs, setEditObs] = useState('')
  const [editNextContact, setEditNextContact] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editSegment, setEditSegment] = useState('')

  const { data: lead, isLoading } = trpc.leads.get.useQuery({ id: leadId }, {
    onSuccess(data: any) {
      if (editMode) return
      setEditObs(data.observations ?? '')
      setEditNextContact(data.nextContactAt ? new Date(data.nextContactAt).toISOString().slice(0, 16) : '')
      setEditCompany(data.company ?? '')
      setEditCity(data.city ?? '')
      setEditSegment(data.segment ?? '')
    },
  } as any)

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

  if (isLoading || !lead) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-dark-800 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/vendedor/leads')} className="text-dark-400 hover:text-dark-100 transition-colors">
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
        <Button
          variant={editMode ? 'primary' : 'secondary'}
          size="sm"
          onClick={editMode ? () => updateMut.mutate({ id: leadId, observations: editObs, company: editCompany, city: editCity, segment: editSegment as any, nextContactAt: editNextContact || null }) : () => setEditMode(true)}
          loading={updateMut.isPending}
        >
          <Edit3 size={14} />{editMode ? 'Salvar' : 'Editar'}
        </Button>
      </div>

      {lead.requiresAttachment && (
        <div className="flex items-center gap-3 bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
          <AlertCircle className="text-yellow-500 shrink-0" size={18} />
          <div>
            <p className="text-yellow-400 text-sm font-medium">Anexo obrigatório</p>
            <p className="text-yellow-600 text-xs">Este lead teve múltiplos follow-ups sem avanço. Adicione um documento abaixo.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Info */}
        <div className="col-span-2 bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
          <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide">Informações</h2>
          {editMode ? (
            <div className="grid grid-cols-2 gap-4">
              <Input label="Empresa" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
              <Input label="Cidade" value={editCity} onChange={(e) => setEditCity(e.target.value)} />
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
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: <Phone size={14} />, label: 'Telefone', value: `(${lead.ddd}) ${lead.phone}` },
                {
                  icon: <Mail size={14} />,
                  label: 'Email',
                  value: lead.email ? (
                    <a href={`mailto:${lead.email}`} className="text-blue-400 hover:text-blue-300 hover:underline">
                      {lead.email}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                { icon: <Building2 size={14} />, label: 'Empresa', value: lead.company ?? '—' },
                { icon: <MapPin size={14} />, label: 'Cidade', value: lead.city ?? '—' },
                { icon: null, label: 'Segmento', value: SEGMENT_LABELS[lead.segment ?? ''] ?? '—' },
                { icon: <MapPin size={14} />, label: 'Região', value: lead.region?.name ?? '—' },
                { icon: <Calendar size={14} />, label: 'Próximo contato', value: lead.nextContactAt ? formatDateTime(lead.nextContactAt) : '—' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-0.5">{item.icon}{item.label}</div>
                  <p className="text-sm text-dark-100">{item.value}</p>
                </div>
              ))}
            </div>
          )}
          {(lead.codSap || lead.orderValue || lead.finalOrderValue || lead.paymentMethod || lead.lossReason || lead.disqualifyReason) && (
            <div className="pt-3 border-t border-dark-600 grid grid-cols-2 gap-4">
              {lead.codSap && (
                <div>
                  <div className="text-xs text-dark-400 mb-0.5">Código SAP</div>
                  <p className="text-sm text-dark-100">{lead.codSap}</p>
                </div>
              )}
              {lead.orderValue != null && (
                <div>
                  <div className="text-xs text-dark-400 mb-0.5">Valor do Pedido</div>
                  <p className="text-sm text-dark-100">R$ {lead.orderValue}</p>
                </div>
              )}
              {lead.finalOrderValue != null && (
                <div>
                  <div className="text-xs text-dark-400 mb-0.5">Valor Final</div>
                  <p className="text-sm text-dark-100">R$ {lead.finalOrderValue}</p>
                </div>
              )}
              {lead.paymentMethod && (
                <div>
                  <div className="text-xs text-dark-400 mb-0.5">Forma de Pagamento</div>
                  <p className="text-sm text-dark-100">
                    {PAYMENT_METHOD_OPTIONS.find((o) => o.value === lead.paymentMethod)?.label ?? lead.paymentMethod}
                  </p>
                </div>
              )}
              {lead.lossReason && (
                <div className="col-span-2">
                  <div className="text-xs text-dark-400 mb-0.5">Motivo da Perda</div>
                  <p className="text-sm text-dark-100">{lead.lossReason}</p>
                </div>
              )}
              {lead.disqualifyReason && (
                <div className="col-span-2">
                  <div className="text-xs text-dark-400 mb-0.5">Motivo da Desqualificação</div>
                  <p className="text-sm text-dark-100">{lead.disqualifyReason}</p>
                </div>
              )}
            </div>
          )}
          {!editMode && lead.observations && (
            <div className="pt-3 border-t border-dark-600">
              <p className="text-xs text-dark-400 mb-1">Observações</p>
              <p className="text-sm text-dark-200">{lead.observations}</p>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide mb-3">Status</h2>
          <div className="space-y-2">
            {STATUS_ORDER.map((s) => (
              <button key={s} onClick={() => s !== lead.status && setStatusModalTarget(s)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all ${
                  lead.status === s ? 'bg-gold-600/20 border border-gold-600/40 text-gold-300' : 'hover:bg-dark-700 text-dark-400 border border-transparent'
                }`}>
                {STATUS_LABELS[s]}
              </button>
            ))}
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
            <Button variant="outline" size="sm" type="button"><Plus size={14} />Adicionar</Button>
          </label>
        </div>
        {lead.attachments.length === 0 ? (
          <p className="text-dark-500 text-sm">Nenhum anexo</p>
        ) : (
          <div className="space-y-2">
            {lead.attachments.map((att: any) => (
              <a key={att.id} href={`/uploads/${att.filename}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-dark-700 rounded-xl hover:bg-dark-600 transition-colors">
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
            <button key={t} onClick={() => setNoteType(t)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-all ${
                noteType === t ? 'bg-gold-600/20 text-gold-400 border border-gold-600/40' : 'bg-dark-700 text-dark-400 border border-dark-600 hover:text-dark-200'
              }`}>
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
        <Button size="sm" loading={addNoteMut.isPending}
          disabled={!noteContent.trim()}
          onClick={() => addNoteMut.mutate({ leadId, type: noteType, content: noteContent, nextContactAt: nextContact || null })}>
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
