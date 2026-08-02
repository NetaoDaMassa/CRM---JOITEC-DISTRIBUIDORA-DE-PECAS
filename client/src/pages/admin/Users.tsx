import { useRef, useState } from 'react'
import { Plus, Edit3, Trash2, UserCheck, UserX, KeyRound, Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import AvatarMeta from '../../components/ui/AvatarMeta'
import { formatDate } from '../../lib/utils'

const REGIOES = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

interface UserForm {
  name: string
  username: string
  role: 'admin' | 'vendor'
  regiao: string
}

const DEFAULT_FORM: UserForm = { name: '', username: '', role: 'vendor', regiao: '' }

async function uploadFotoVendedor(file: File): Promise<string> {
  const token = localStorage.getItem('odin_token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/upload/foto-vendedor', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar a foto')
  return data.path
}

export default function AdminUsers() {
  const [createModal, setCreateModal] = useState(false)
  const [editUser, setEditUser] = useState<any | null>(null)
  const [deleteUser, setDeleteUser] = useState<any | null>(null)
  const [form, setForm] = useState<UserForm>(DEFAULT_FORM)
  const [senhaGerada, setSenhaGerada] = useState<{ username: string; senha: string } | null>(null)
  const [fotoForm, setFotoForm] = useState<File | null>(null)
  const [enviandoFotoForm, setEnviandoFotoForm] = useState(false)

  const utils = trpc.useUtils()
  const { data: users, isLoading } = trpc.users.list.useQuery()

  const createMut = trpc.users.create.useMutation({
    onSuccess(data, variables) {
      utils.users.list.invalidate()
      setCreateModal(false)
      setSenhaGerada({ username: variables.username, senha: data.senhaTemporaria })
      setForm(DEFAULT_FORM)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const updateMut = trpc.users.update.useMutation({
    onSuccess() {
      toast.success('Usuário atualizado')
      utils.users.list.invalidate()
      setEditUser(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  async function handleSalvarUsuario(e: React.FormEvent) {
    e.preventDefault()
    try {
      let userId: number
      if (editUser) {
        await updateMut.mutateAsync({ id: editUser.id, name: form.name, role: form.role, regiao: (form.regiao || undefined) as any })
        userId = editUser.id
      } else {
        const data = await createMut.mutateAsync({ name: form.name, username: form.username, role: form.role, regiao: (form.regiao || undefined) as any })
        userId = data.id
      }

      if (fotoForm) {
        setEnviandoFotoForm(true)
        const path = await uploadFotoVendedor(fotoForm)
        await updateMut.mutateAsync({ id: userId, fotoUrl: path })
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Falha ao enviar a foto')
    } finally {
      setEnviandoFotoForm(false)
      setFotoForm(null)
    }
  }

  const resetPasswordMut = trpc.users.resetPassword.useMutation({
    onSuccess(data, variables) {
      const alvo = users?.find((u) => u.id === variables.id)
      setSenhaGerada({ username: alvo?.username ?? '', senha: data.senhaTemporaria })
    },
  })

  const [fotoAlvoId, setFotoAlvoId] = useState<number | null>(null)
  const [enviandoFotoId, setEnviandoFotoId] = useState<number | null>(null)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  function abrirSeletorFoto(userId: number) {
    setFotoAlvoId(userId)
    fotoInputRef.current?.click()
  }

  async function handleFotoSelecionada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || fotoAlvoId == null) return

    setEnviandoFotoId(fotoAlvoId)
    try {
      const path = await uploadFotoVendedor(file)
      await updateMut.mutateAsync({ id: fotoAlvoId, fotoUrl: path })
    } catch (err: any) {
      toast.error(err.message ?? 'Falha ao enviar a foto')
    } finally {
      setEnviandoFotoId(null)
      setFotoAlvoId(null)
    }
  }

  const deleteMut = trpc.users.delete.useMutation({
    onSuccess() {
      toast.success('Usuário excluído')
      utils.users.list.invalidate()
      setDeleteUser(null)
    },
    onError(err) {
      toast.error(err.message)
      setDeleteUser(null)
    },
  })

  function openEdit(user: any) {
    setEditUser(user)
    setForm({ name: user.name, username: user.username, role: user.role, regiao: user.regiao ?? '' })
    setFotoForm(null)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Vendedores</h1>
          <p className="text-dark-400 text-sm">{users?.length ?? 0} usuários cadastrados</p>
        </div>
        <Button
          onClick={() => {
            setCreateModal(true)
            setForm(DEFAULT_FORM)
            setFotoForm(null)
          }}
        >
          <Plus size={16} />
          Novo Usuário
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-600 bg-dark-700/50">
              {['Foto', 'Nome', 'Usuário', 'Região', 'Perfil', 'Status', 'Cadastrado', 'Ações'].map((h) => (
                <th key={h} className="text-left text-dark-400 font-medium px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-dark-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : users?.map((user) => (
                  <tr key={user.id} className="hover:bg-dark-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => abrirSeletorFoto(user.id)}
                        disabled={enviandoFotoId === user.id}
                        className="relative group"
                        title="Trocar foto"
                      >
                        <AvatarMeta nome={user.name} fotoUrl={user.fotoUrl} size="sm" />
                        <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Camera size={13} className="text-white" />
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-dark-100">{user.name}</td>
                    <td className="px-4 py-3 text-dark-400">@{user.username}</td>
                    <td className="px-4 py-3 text-dark-400 capitalize">{user.regiao?.replace('_', '-') ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.role === 'admin' ? 'bg-gold-600/20 text-gold-400' : 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {user.role === 'admin' ? 'Administrador' : 'Vendedor'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs ${user.isActive ? 'text-green-400' : 'text-red-400'}`}>
                        {user.isActive ? <UserCheck size={13} /> : <UserX size={13} />}
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-dark-500">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg hover:bg-blue-900/30 text-blue-400 transition-colors">
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => resetPasswordMut.mutate({ id: user.id })}
                          className="p-1.5 rounded-lg hover:bg-purple-900/30 text-purple-400 transition-colors"
                          title="Redefinir senha"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          onClick={() => updateMut.mutate({ id: user.id, isActive: !user.isActive })}
                          className={`p-1.5 rounded-lg transition-colors ${user.isActive ? 'hover:bg-yellow-900/30 text-yellow-400' : 'hover:bg-green-900/30 text-green-400'}`}
                          title={user.isActive ? 'Desativar' : 'Ativar'}
                        >
                          {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                        </button>
                        <button onClick={() => setDeleteUser(user)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <input ref={fotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleFotoSelecionada} />

      <Modal
        open={createModal || !!editUser}
        onClose={() => {
          setCreateModal(false)
          setEditUser(null)
        }}
        title={editUser ? 'Editar Usuário' : 'Novo Usuário'}
        size="sm"
      >
        <form className="space-y-4" onSubmit={handleSalvarUsuario}>
          <Input label="Nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input
            label="Usuário"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            disabled={!!editUser}
          />
          <Select
            label="Região"
            value={form.regiao}
            onChange={(e) => setForm({ ...form, regiao: e.target.value })}
            placeholder="Sem região"
            options={REGIOES}
          />
          <Select
            label="Perfil"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'vendor' })}
            options={[{ value: 'vendor', label: 'Vendedor' }, { value: 'admin', label: 'Administrador' }]}
          />
          {form.role === 'vendor' && (
            <div className="flex items-center gap-3">
              <AvatarMeta nome={form.name || '?'} fotoUrl={fotoForm ? URL.createObjectURL(fotoForm) : editUser?.fotoUrl} size="md" />
              <div className="flex-1">
                <label className="text-sm text-dark-200 font-medium block mb-1">Foto do vendedor (opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFotoForm(e.target.files?.[0] ?? null)}
                  className="text-xs text-dark-300 w-full"
                />
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setCreateModal(false)
                setEditUser(null)
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" loading={createMut.isPending || updateMut.isPending || enviandoFotoForm}>
              {editUser ? 'Salvar' : 'Criar Usuário'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!senhaGerada} onClose={() => setSenhaGerada(null)} title="Senha temporária gerada" size="sm">
        <p className="text-dark-300 mb-2 text-sm">
          Usuário <strong className="text-dark-100">{senhaGerada?.username}</strong> precisa trocar a senha no primeiro login.
        </p>
        <p className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 font-mono text-gold-400 text-sm mb-4">
          {senhaGerada?.senha}
        </p>
        <Button className="w-full" onClick={() => setSenhaGerada(null)}>
          Anotei, fechar
        </Button>
      </Modal>

      <Modal open={!!deleteUser} onClose={() => setDeleteUser(null)} title="Confirmar Exclusão" size="sm">
        <p className="text-dark-300 mb-6">
          Excluir o usuário <strong className="text-dark-100">{deleteUser?.name}</strong>?
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteUser(null)}>
            Cancelar
          </Button>
          <Button variant="danger" className="flex-1" loading={deleteMut.isPending} onClick={() => deleteUser && deleteMut.mutate({ id: deleteUser.id })}>
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  )
}
