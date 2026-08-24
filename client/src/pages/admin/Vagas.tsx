import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, MapPin, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import { timeAgo } from '../../lib/utils'

interface FormState {
  title: string
  description: string
  benefits: string
  requirements: string
  city: string
  empresaIds: number[]
}

const EMPTY_FORM: FormState = { title: '', description: '', benefits: '', requirements: '', city: '', empresaIds: [] }

// Vagas publicadas pros sites do grupo (Trabalhe Conosco) — portado do
// CRM-GRUPO-ODIN. Quem tem a feature 'vagas' liberada gerencia; só o
// superAdmin escolhe em quais empresas a vaga entra na criação.
export default function AdminVagas() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const [modal, setModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null })
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: vagas = [], isLoading } = trpc.vagas.list.useQuery()
  const { data: candidatos = [] } = trpc.candidatos.list.useQuery(undefined)
  const { data: empresas = [] } = trpc.empresas.list.useQuery(undefined, { enabled: !!user?.superAdmin })

  const createMut = trpc.vagas.create.useMutation({
    onSuccess() {
      toast.success('Vaga criada!')
      utils.vagas.list.invalidate()
      closeModal()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const updateMut = trpc.vagas.update.useMutation({
    onSuccess() {
      toast.success('Vaga atualizada!')
      utils.vagas.list.invalidate()
      closeModal()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const deleteMut = trpc.vagas.delete.useMutation({
    onSuccess() {
      toast.success('Vaga excluída')
      utils.vagas.list.invalidate()
      setDeleteId(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function openCreate() {
    setForm(EMPTY_FORM)
    setModal({ open: true, editing: null })
  }

  function openEdit(vaga: any) {
    setForm({
      title: vaga.title,
      description: vaga.description,
      benefits: vaga.benefits ?? '',
      requirements: vaga.requirements ?? '',
      city: vaga.city ?? '',
      empresaIds: [],
    })
    setModal({ open: true, editing: vaga })
  }

  function toggleEmpresa(empresaId: number) {
    setForm((f) => ({
      ...f,
      empresaIds: f.empresaIds.includes(empresaId) ? f.empresaIds.filter((id) => id !== empresaId) : [...f.empresaIds, empresaId],
    }))
  }

  function closeModal() {
    setModal({ open: false, editing: null })
    setForm(EMPTY_FORM)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('Título é obrigatório')
    if (!form.description.trim()) return toast.error('Descrição é obrigatória')
    if (!modal.editing && user?.superAdmin && form.empresaIds.length === 0) {
      return toast.error('Selecione ao menos uma empresa')
    }
    const payload = {
      title: form.title,
      description: form.description,
      benefits: form.benefits || undefined,
      requirements: form.requirements || undefined,
      city: form.city || undefined,
    }
    if (modal.editing) {
      updateMut.mutate({ id: modal.editing.id, ...payload })
    } else {
      createMut.mutate({ ...payload, empresaIds: user?.superAdmin ? form.empresaIds : undefined })
    }
  }

  function toggleActive(vaga: any) {
    updateMut.mutate({ id: vaga.id, isActive: !vaga.isActive })
  }

  function candidateCount(jobId: number) {
    return candidatos.filter((c: any) => c.jobPostingId === jobId).length
  }

  const total = vagas.length
  const abertas = vagas.filter((v: any) => v.isActive).length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Vagas</h1>
          <p className="text-dark-400 text-sm mt-0.5">
            {total} vaga{total !== 1 ? 's' : ''} · {abertas} aberta{abertas !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          Nova Vaga
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="text-dark-400 text-sm">Carregando...</div>
          </div>
        ) : vagas.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-center">
            <Briefcase size={36} className="text-dark-700" />
            <p className="text-dark-400 text-sm">Nenhuma vaga cadastrada ainda</p>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              Criar primeira vaga
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-900/40">
                <th className="text-left text-dark-400 font-medium px-5 py-3">Vaga</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Cidade</th>
                <th className="text-center text-dark-400 font-medium px-5 py-3">Candidatos</th>
                <th className="text-center text-dark-400 font-medium px-5 py-3">Status</th>
                <th className="text-right text-dark-400 font-medium px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {vagas.map((vaga: any) => (
                <tr key={vaga.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-gold-600/10 text-gold-400 border-gold-600/30">
                        <Briefcase size={15} />
                      </div>
                      <div>
                        <span className="font-medium text-dark-100">{vaga.title}</span>
                        <p className="text-xs text-dark-500">Criada {timeAgo(vaga.createdAt)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-dark-400">
                    {vaga.city ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} />
                        {vaga.city}
                      </span>
                    ) : (
                      <span className="text-dark-600 italic">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => navigate(`/admin/candidatos?jobId=${vaga.id}`)}
                      className="inline-flex items-center gap-1.5 font-semibold text-gold-400 hover:underline"
                    >
                      <Users size={13} />
                      {candidateCount(vaga.id)}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => toggleActive(vaga)}
                      className="flex items-center gap-1.5 mx-auto transition-colors"
                      title={vaga.isActive ? 'Fechar vaga' : 'Reabrir vaga'}
                    >
                      {vaga.isActive ? (
                        <>
                          <ToggleRight size={20} className="text-green-400" />
                          <span className="text-xs text-green-400">Aberta</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={20} className="text-dark-500" />
                          <span className="text-xs text-dark-500">Fechada</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(vaga)}
                        className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteId(vaga.id)}
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

      <Modal open={modal.open} onClose={closeModal} title={modal.editing ? 'Editar Vaga' : 'Nova Vaga'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Título da vaga *"
            placeholder="Ex: Vendedor Técnico, Assistente Administrativo..."
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            autoFocus
          />
          <Input
            label="Cidade (opcional)"
            placeholder="Ex: Curitiba/PR"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
          <Textarea
            label="Descrição da vaga *"
            placeholder="Responsabilidades, rotina do dia a dia..."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
          />
          <Textarea
            label="O que a vaga oferece (opcional)"
            placeholder="Vale alimentação, plano de saúde, comissão..."
            value={form.benefits}
            onChange={(e) => setForm((f) => ({ ...f, benefits: e.target.value }))}
            rows={3}
          />
          <Textarea
            label="Requisitos (opcional)"
            placeholder="Experiência mínima, CNH, disponibilidade..."
            value={form.requirements}
            onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            rows={3}
          />
          {!modal.editing && user?.superAdmin && (
            <div>
              <label className="block text-sm text-dark-300 mb-2">Publicar em *</label>
              <div className="flex flex-wrap gap-2">
                {empresas.map((emp) => (
                  <label
                    key={emp.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                      form.empresaIds.includes(emp.id)
                        ? 'border-gold-600 bg-gold-600/10 text-gold-400'
                        : 'border-dark-600 text-dark-300 hover:border-dark-500'
                    }`}
                  >
                    <input type="checkbox" className="hidden" checked={form.empresaIds.includes(emp.id)} onChange={() => toggleEmpresa(emp.id)} />
                    {emp.nome}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" loading={createMut.isPending || updateMut.isPending}>
              {modal.editing ? 'Salvar alterações' : 'Criar vaga'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Excluir vaga" size="sm">
        <p className="text-dark-300 text-sm mb-5">Tem certeza? Os candidatos que já se aplicaram a essa vaga também serão excluídos.</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteId(null)}>
            Cancelar
          </Button>
          <Button variant="danger" className="flex-1" loading={deleteMut.isPending} onClick={() => deleteId && deleteMut.mutate({ id: deleteId })}>
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  )
}
