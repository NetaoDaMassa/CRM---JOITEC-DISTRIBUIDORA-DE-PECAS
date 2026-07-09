import { useState } from 'react'
import { MessageSquareText, Plus, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'

interface FormState {
  label: string
  whatsappText: string
  emailSubject: string
  emailBody: string
}

const EMPTY_FORM: FormState = { label: '', whatsappText: '', emailSubject: '', emailBody: '' }

export default function AdminMessageTemplates() {
  const utils = trpc.useUtils()
  const [modal, setModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null })
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: templates = [], isLoading } = trpc.messageTemplates.list.useQuery()

  const createMut = trpc.messageTemplates.create.useMutation({
    onSuccess() {
      toast.success('Mensagem criada!')
      utils.messageTemplates.list.invalidate()
      closeModal()
    },
    onError(err) { toast.error(err.message) },
  })

  const updateMut = trpc.messageTemplates.update.useMutation({
    onSuccess() {
      toast.success('Mensagem atualizada!')
      utils.messageTemplates.list.invalidate()
      closeModal()
    },
    onError(err) { toast.error(err.message) },
  })

  const deleteMut = trpc.messageTemplates.delete.useMutation({
    onSuccess() {
      toast.success('Mensagem excluída')
      utils.messageTemplates.list.invalidate()
      setDeleteId(null)
    },
    onError(err) { toast.error(err.message) },
  })

  function openCreate() {
    setForm(EMPTY_FORM)
    setModal({ open: true, editing: null })
  }

  function openEdit(t: any) {
    setForm({ label: t.label, whatsappText: t.whatsappText, emailSubject: t.emailSubject, emailBody: t.emailBody })
    setModal({ open: true, editing: t })
  }

  function closeModal() {
    setModal({ open: false, editing: null })
    setForm(EMPTY_FORM)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim()) return toast.error('Nome da mensagem é obrigatório')
    if (!form.whatsappText.trim()) return toast.error('Texto do WhatsApp é obrigatório')
    if (!form.emailSubject.trim()) return toast.error('Assunto do email é obrigatório')
    if (!form.emailBody.trim()) return toast.error('Corpo do email é obrigatório')

    if (modal.editing) {
      updateMut.mutate({ id: modal.editing.id, ...form })
    } else {
      createMut.mutate(form)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Mensagens Automáticas</h1>
          <p className="text-dark-400 text-sm mt-0.5">
            Modelos usados para iniciar contato por WhatsApp/Email em leads na etapa Abordagem · use{' '}
            <code className="text-gold-500">{'{{nome}}'}</code> pra personalizar com o nome do lead
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          Nova Mensagem
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="text-dark-400 text-sm">Carregando...</div>
          </div>
        ) : templates.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-center">
            <MessageSquareText size={36} className="text-dark-700" />
            <p className="text-dark-400 text-sm">Nenhuma mensagem cadastrada ainda</p>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              Criar primeira mensagem
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {templates.map((t: any) => (
              <div key={t.id} className="p-5 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-dark-100 mb-2">{t.label}</h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-green-400 font-medium">WhatsApp</span>
                      <p className="text-sm text-dark-400 line-clamp-2">{t.whatsappText}</p>
                    </div>
                    <div>
                      <span className="text-xs text-blue-400 font-medium">Email — {t.emailSubject}</span>
                      <p className="text-sm text-dark-400 line-clamp-2">{t.emailBody}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(t)}
                    className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
                    title="Editar"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setDeleteId(t.id)}
                    className="p-1.5 rounded-lg hover:bg-red-900/30 text-dark-500 hover:text-red-400 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.editing ? 'Editar Mensagem' : 'Nova Mensagem'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nome da mensagem *"
            placeholder="Ex: Retomada direta, Consultiva, Oferta especial..."
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            autoFocus
          />
          <Textarea
            label="Texto do WhatsApp *"
            placeholder="Use {{nome}} pra personalizar"
            value={form.whatsappText}
            onChange={(e) => setForm((f) => ({ ...f, whatsappText: e.target.value }))}
            rows={3}
          />
          <Input
            label="Assunto do Email *"
            placeholder="Use {{nome}} pra personalizar"
            value={form.emailSubject}
            onChange={(e) => setForm((f) => ({ ...f, emailSubject: e.target.value }))}
          />
          <Textarea
            label="Corpo do Email *"
            placeholder="Use {{nome}} pra personalizar"
            value={form.emailBody}
            onChange={(e) => setForm((f) => ({ ...f, emailBody: e.target.value }))}
            rows={6}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" loading={createMut.isPending || updateMut.isPending}>
              {modal.editing ? 'Salvar alterações' : 'Criar mensagem'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Excluir mensagem" size="sm">
        <p className="text-dark-300 text-sm mb-5">Tem certeza que deseja excluir esta mensagem automática?</p>
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
