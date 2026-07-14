import { useState } from 'react'
import { Zap, ClipboardPaste, User, Phone, Mail, Building2, MapPin, Paperclip, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input } from './ui/Input'
import Select from './ui/Select'
import { parseLeadText } from '../lib/utils'

const SEGMENT_OPTIONS = [
  { value: 'assistente_tecnico', label: 'Assistente Técnico' },
  { value: 'instalador', label: 'Instalador' },
  { value: 'revendedor_lojista', label: 'Revendedor/Lojista' },
  { value: 'outros', label: 'Outros' },
]

interface QuickLeadCreateProps {
  open: boolean
  onClose: () => void
  defaultVendorId?: number
  vendorLocked?: boolean
}

export default function QuickLeadCreate({ open, onClose, defaultVendorId, vendorLocked }: QuickLeadCreateProps) {
  const [pasteText, setPasteText] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ddd, setDdd] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')
  const [segment, setSegment] = useState('')
  const [source, setSource] = useState('')
  const [observations, setObservations] = useState('')
  const [vendorId, setVendorId] = useState(defaultVendorId?.toString() ?? '')
  const [autoAssign, setAutoAssign] = useState(!vendorLocked)
  const [campaignId, setCampaignId] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  const utils = trpc.useUtils()
  const { data: vendors } = trpc.users.vendors.useQuery()
  const { data: campaigns } = trpc.campaigns.listActive.useQuery()

  const createMut = trpc.leads.create.useMutation({
    async onSuccess(data) {
      if (attachmentFile) {
        setUploadingAttachment(true)
        try {
          const form = new FormData()
          form.append('file', attachmentFile)
          const token = localStorage.getItem('odin_token')
          const res = await fetch(`/upload/${data.id}`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          })
          if (!res.ok) toast.error('Lead criado, mas houve erro ao anexar o arquivo')
        } catch {
          toast.error('Lead criado, mas houve erro ao anexar o arquivo')
        } finally {
          setUploadingAttachment(false)
        }
      }
      toast.success('Lead criado e distribuído com sucesso!')
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      handleClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleParse() {
    if (!pasteText.trim()) return
    const parsed = parseLeadText(pasteText)
    if (parsed.name) setName(parsed.name)
    if (parsed.phone) setPhone(parsed.phone)
    if (parsed.ddd) setDdd(parsed.ddd)
    if (parsed.email) setEmail(parsed.email)
    if (parsed.company) setCompany(parsed.company)
    if (parsed.city) setCity(parsed.city)
    if (parsed.observations) setObservations(parsed.observations)
    toast.success('Campos preenchidos automaticamente!')
  }

  function handleClose() {
    setPasteText(''); setName(''); setPhone(''); setDdd(''); setEmail('')
    setCompany(''); setCity(''); setSegment(''); setSource(''); setObservations('')
    setVendorId(defaultVendorId?.toString() ?? ''); setAutoAssign(!vendorLocked); setCampaignId('')
    setAttachmentFile(null)
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !phone || !ddd) return toast.error('Nome, DDD e telefone são obrigatórios')
    createMut.mutate({
      name,
      phone,
      ddd: parseInt(ddd),
      email: email || undefined,
      company: company || undefined,
      city: city || undefined,
      segment: (segment || 'outros') as any,
      source: source || undefined,
      observations: observations || undefined,
      vendorId: vendorLocked ? defaultVendorId : (!autoAssign && vendorId ? parseInt(vendorId) : undefined),
      autoAssign: vendorLocked ? false : autoAssign,
      campaignId: campaignId ? parseInt(campaignId) : undefined,
    })
  }

  return (
    <Modal open={open} onClose={handleClose} title="Cadastrar Novo Lead" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Paste parser */}
        <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-gold-400 text-sm font-medium">
            <Zap size={15} />
            Preenchimento Automático
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Cole aqui o texto do WhatsApp ou formulário (Nome:, Telefone:, Email:, Empresa:...)"
            rows={3}
            className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-gold-600 resize-none"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleParse}>
            <ClipboardPaste size={14} />
            Preencher campos
          </Button>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Input label="Nome *" placeholder="João da Silva" value={name} onChange={(e) => setName(e.target.value)} icon={<User size={14} />} />
          </div>
          <Input label="DDD *" placeholder="11" value={ddd} onChange={(e) => setDdd(e.target.value)} type="number" />
          <Input label="Telefone *" placeholder="99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} icon={<Phone size={14} />} />
          <Input label="Email" placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} type="email" icon={<Mail size={14} />} />
          <Input label="Empresa" placeholder="Empresa Ltda" value={company} onChange={(e) => setCompany(e.target.value)} icon={<Building2 size={14} />} />
          <Input label="Cidade" placeholder="São Paulo" value={city} onChange={(e) => setCity(e.target.value)} icon={<MapPin size={14} />} />
          <Select
            label="Segmento"
            options={SEGMENT_OPTIONS}
            placeholder="Selecione..."
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
          />
          <Input label="Fonte" placeholder="WhatsApp, Site, Indicação..." value={source} onChange={(e) => setSource(e.target.value)} />
          <div className="col-span-2">
            <Select
              label="Campanha de origem"
              options={[
                { value: '', label: 'Sem campanha / origem direta' },
                ...(campaigns?.map((c) => ({ value: c.id, label: c.name })) ?? []),
              ]}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            />
          </div>
        </div>

        <Input
          label="Observações iniciais"
          placeholder="Notas sobre o lead..."
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm text-dark-200 font-medium">Anexo (opcional)</label>
          <label className="cursor-pointer flex items-center gap-2 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-300 hover:border-gold-600 transition-colors">
            <Paperclip size={14} />
            <span className="truncate">{attachmentFile ? attachmentFile.name : 'Selecionar arquivo para o vendedor visualizar'}</span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {/* Assignment */}
        {vendorLocked ? (
          <div className="bg-dark-700/30 border border-dark-600 rounded-xl p-4">
            <p className="text-sm text-dark-200">Este lead será cadastrado para você.</p>
          </div>
        ) : (
          <div className="bg-dark-700/30 border border-dark-600 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAssign}
                onChange={(e) => setAutoAssign(e.target.checked)}
                className="w-4 h-4 accent-gold-500"
              />
              <span className="text-sm text-dark-200">
                Distribuição automática por rodízio (baseada no DDD)
              </span>
            </label>
            {!autoAssign && (
              <Select
                label="Vendedor"
                options={vendors?.map((v) => ({ value: v.id, label: v.name })) ?? []}
                placeholder="Selecione o vendedor..."
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              />
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={createMut.isPending || uploadingAttachment}>
            Cadastrar Lead
          </Button>
        </div>
      </form>
    </Modal>
  )
}
