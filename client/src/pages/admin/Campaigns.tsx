import { useState } from 'react'
import {
  Megaphone, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Facebook, Instagram, Search, Globe, MessageCircle, Users, Tag,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'

const CHANNEL_OPTIONS = [
  { value: 'facebook', label: 'Facebook Ads' },
  { value: 'instagram', label: 'Instagram Ads' },
  { value: 'google', label: 'Google Ads' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site', label: 'Site / Landing Page' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'outro', label: 'Outro' },
]

const CHANNEL_LABELS: Record<string, string> = {
  facebook: 'Facebook Ads',
  instagram: 'Instagram Ads',
  google: 'Google Ads',
  whatsapp: 'WhatsApp',
  site: 'Site / Landing Page',
  indicacao: 'Indicação',
  outro: 'Outro',
}

const CHANNEL_COLORS: Record<string, string> = {
  facebook: 'bg-blue-600/20 text-blue-300 border-blue-500/30',
  instagram: 'bg-pink-600/20 text-pink-300 border-pink-500/30',
  google: 'bg-red-600/20 text-red-300 border-red-500/30',
  whatsapp: 'bg-green-600/20 text-green-300 border-green-500/30',
  site: 'bg-purple-600/20 text-purple-300 border-purple-500/30',
  indicacao: 'bg-gold-600/20 text-gold-300 border-gold-500/30',
  outro: 'bg-dark-600/50 text-dark-300 border-dark-500/30',
}

function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  const cls = `shrink-0`
  switch (channel) {
    case 'facebook': return <Facebook size={size} className={cls} />
    case 'instagram': return <Instagram size={size} className={cls} />
    case 'google': return <Search size={size} className={cls} />
    case 'whatsapp': return <MessageCircle size={size} className={cls} />
    case 'site': return <Globe size={size} className={cls} />
    case 'indicacao': return <Users size={size} className={cls} />
    default: return <Tag size={size} className={cls} />
  }
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${CHANNEL_COLORS[channel] ?? CHANNEL_COLORS.outro}`}>
      <ChannelIcon channel={channel} size={11} />
      {CHANNEL_LABELS[channel] ?? channel}
    </span>
  )
}

interface FormState {
  name: string
  channel: string
  description: string
}

const EMPTY_FORM: FormState = { name: '', channel: 'outro', description: '' }

export default function AdminCampaigns() {
  const utils = trpc.useUtils()
  const [modal, setModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null })
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: campaigns = [], isLoading } = trpc.campaigns.list.useQuery()

  const createMut = trpc.campaigns.create.useMutation({
    onSuccess() {
      toast.success('Campanha criada!')
      utils.campaigns.list.invalidate()
      utils.campaigns.listActive.invalidate()
      closeModal()
    },
    onError(err) { toast.error(err.message) },
  })

  const updateMut = trpc.campaigns.update.useMutation({
    onSuccess() {
      toast.success('Campanha atualizada!')
      utils.campaigns.list.invalidate()
      utils.campaigns.listActive.invalidate()
      closeModal()
    },
    onError(err) { toast.error(err.message) },
  })

  const deleteMut = trpc.campaigns.delete.useMutation({
    onSuccess() {
      toast.success('Campanha excluída')
      utils.campaigns.list.invalidate()
      utils.campaigns.listActive.invalidate()
      setDeleteId(null)
    },
    onError(err) { toast.error(err.message) },
  })

  function openCreate() {
    setForm(EMPTY_FORM)
    setModal({ open: true, editing: null })
  }

  function openEdit(c: any) {
    setForm({ name: c.name, channel: c.channel, description: c.description ?? '' })
    setModal({ open: true, editing: c })
  }

  function closeModal() {
    setModal({ open: false, editing: null })
    setForm(EMPTY_FORM)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Nome é obrigatório')
    if (modal.editing) {
      updateMut.mutate({ id: modal.editing.id, name: form.name, channel: form.channel as any, description: form.description || null })
    } else {
      createMut.mutate({ name: form.name, channel: form.channel as any, description: form.description || undefined })
    }
  }

  function toggleActive(c: any) {
    updateMut.mutate({ id: c.id, isActive: !c.isActive })
  }

  const total = campaigns.length
  const active = campaigns.filter((c: any) => c.isActive).length
  const totalLeads = campaigns.reduce((sum: number, c: any) => sum + (c.leadCount ?? 0), 0)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Campanhas</h1>
          <p className="text-dark-400 text-sm mt-0.5">
            {total} campanha{total !== 1 ? 's' : ''} · {active} ativa{active !== 1 ? 's' : ''} · {totalLeads} leads captados
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          Nova Campanha
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Campanhas Ativas', value: active, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
          { label: 'Campanhas Inativas', value: total - active, color: 'text-dark-400', bg: 'bg-dark-700/50 border-dark-600' },
          { label: 'Total de Leads', value: totalLeads, color: 'text-gold-400', bg: 'bg-gold-500/10 border-gold-500/20' },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border p-5 ${s.bg}`}>
            <p className="text-dark-400 text-sm mb-1">{s.label}</p>
            <p className={`font-heading text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Campaigns table */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="text-dark-400 text-sm">Carregando...</div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-center">
            <Megaphone size={36} className="text-dark-700" />
            <p className="text-dark-400 text-sm">Nenhuma campanha cadastrada ainda</p>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              Criar primeira campanha
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-900/40">
                <th className="text-left text-dark-400 font-medium px-5 py-3">Campanha</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Canal</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Descrição</th>
                <th className="text-center text-dark-400 font-medium px-5 py-3">Leads</th>
                <th className="text-center text-dark-400 font-medium px-5 py-3">Status</th>
                <th className="text-right text-dark-400 font-medium px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {campaigns.map((c: any) => (
                <tr key={c.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${CHANNEL_COLORS[c.channel] ?? CHANNEL_COLORS.outro}`}>
                        <ChannelIcon channel={c.channel} size={15} />
                      </div>
                      <span className="font-medium text-dark-100">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <ChannelBadge channel={c.channel} />
                  </td>
                  <td className="px-5 py-4 text-dark-400 max-w-xs truncate">
                    {c.description || <span className="text-dark-600 italic">Sem descrição</span>}
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className={`font-semibold ${c.leadCount > 0 ? 'text-gold-400' : 'text-dark-500'}`}>
                      {c.leadCount ?? 0}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      className="flex items-center gap-1.5 mx-auto transition-colors"
                      title={c.isActive ? 'Desativar' : 'Ativar'}
                    >
                      {c.isActive ? (
                        <>
                          <ToggleRight size={20} className="text-green-400" />
                          <span className="text-xs text-green-400">Ativa</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={20} className="text-dark-500" />
                          <span className="text-xs text-dark-500">Inativa</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteId(c.id)}
                        className="p-1.5 rounded-lg hover:bg-red-900/30 text-dark-500 hover:text-red-400 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.editing ? 'Editar Campanha' : 'Nova Campanha'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nome da campanha *"
            placeholder="Ex: Facebook — Junho 2026, Google Tubos PPR..."
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
          />
          <Select
            label="Canal / Origem"
            options={CHANNEL_OPTIONS}
            value={form.channel}
            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
          />
          <Textarea
            label="Descrição (opcional)"
            placeholder="Detalhes do anúncio, objetivo, público-alvo..."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1"
              loading={createMut.isPending || updateMut.isPending}
            >
              {modal.editing ? 'Salvar alterações' : 'Criar campanha'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Excluir campanha"
        size="sm"
      >
        <p className="text-dark-300 text-sm mb-5">
          Tem certeza? Os leads vinculados a esta campanha não serão excluídos, mas perderão a referência.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteId(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={deleteMut.isPending}
            onClick={() => deleteId && deleteMut.mutate({ id: deleteId })}
          >
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  )
}
