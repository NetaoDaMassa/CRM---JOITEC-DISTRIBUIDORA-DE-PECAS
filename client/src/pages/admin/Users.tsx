import { useState } from 'react'
import { Plus, Edit3, Trash2, UserCheck, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import { formatDate } from '../../lib/utils'

interface UserForm {
  name: string; username: string; password: string; role: 'admin' | 'vendor'
}

const DEFAULT_FORM: UserForm = { name: '', username: '', password: '', role: 'vendor' }

export default function AdminUsers() {
  const [createModal, setCreateModal] = useState(false)
  const [editUser, setEditUser] = useState<any | null>(null)
  const [deleteUser, setDeleteUser] = useState<any | null>(null)
  const [form, setForm] = useState<UserForm>(DEFAULT_FORM)

  const utils = trpc.useUtils()
  const { data: users, isLoading } = trpc.users.list.useQuery()

  const createMut = trpc.users.create.useMutation({
    onSuccess() {
      toast.success('Usuário criado')
      utils.users.list.invalidate()
      setCreateModal(false)
      setForm(DEFAULT_FORM)
    },
    onError(err) { toast.error(err.message) },
  })

  const updateMut = trpc.users.update.useMutation({
    onSuccess() {
      toast.success('Usuário atualizado')
      utils.users.list.invalidate()
      setEditUser(null)
    },
    onError(err) { toast.error(err.message) },
  })

  const deleteMut = trpc.users.delete.useMutation({
    onSuccess() {
      toast.success('Usuário excluído')
      utils.users.list.invalidate()
      setDeleteUser(null)
    },
  })

  function openEdit(user: any) {
    setEditUser(user)
    setForm({ name: user.name, username: user.username, password: '', role: user.role })
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Vendedores</h1>
          <p className="text-dark-400 text-sm">{users?.length ?? 0} usuários cadastrados</p>
        </div>
        <Button onClick={() => { setCreateModal(true); setForm(DEFAULT_FORM) }}>
          <Plus size={16} />Novo Usuário
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-600 bg-dark-700/50">
              {['Nome', 'Usuário', 'Perfil', 'Status', 'Cadastrado', 'Ações'].map((h) => (
                <th key={h} className="text-left text-dark-400 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-dark-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : users?.map((user) => (
                  <tr key={user.id} className="hover:bg-dark-700/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-dark-100">{user.name}</td>
                    <td className="px-4 py-3 text-dark-400">@{user.username}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.role === 'admin'
                          ? 'bg-gold-600/20 text-gold-400'
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
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
                        <button
                          onClick={() => openEdit(user)}
                          className="p-1.5 rounded-lg hover:bg-blue-900/30 text-blue-400 transition-colors"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => updateMut.mutate({ id: user.id, isActive: !user.isActive })}
                          className={`p-1.5 rounded-lg transition-colors ${user.isActive ? 'hover:bg-yellow-900/30 text-yellow-400' : 'hover:bg-green-900/30 text-green-400'}`}
                          title={user.isActive ? 'Desativar' : 'Ativar'}
                        >
                          {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                        </button>
                        <button
                          onClick={() => setDeleteUser(user)}
                          className="p-1.5 rounded-lg hover:bg-red-900/30 text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={createModal || !!editUser}
        onClose={() => { setCreateModal(false); setEditUser(null) }}
        title={editUser ? 'Editar Usuário' : 'Novo Usuário'}
        size="sm"
      >
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault()
          if (editUser) {
            updateMut.mutate({
              id: editUser.id,
              name: form.name,
              username: form.username,
              role: form.role,
              ...(form.password ? { password: form.password } : {}),
            })
          } else {
            createMut.mutate(form)
          }
        }}>
          <Input label="Nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Usuário" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <Input label={editUser ? 'Nova senha (deixe em branco para manter)' : 'Senha'} type="password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            required={!editUser} />
          <Select label="Perfil" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'vendor' })}
            options={[{ value: 'vendor', label: 'Vendedor' }, { value: 'admin', label: 'Administrador' }]} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1"
              onClick={() => { setCreateModal(false); setEditUser(null) }}>Cancelar</Button>
            <Button type="submit" className="flex-1" loading={createMut.isPending || updateMut.isPending}>
              {editUser ? 'Salvar' : 'Criar Usuário'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteUser} onClose={() => setDeleteUser(null)} title="Confirmar Exclusão" size="sm">
        <p className="text-dark-300 mb-6">Excluir o usuário <strong className="text-dark-100">{deleteUser?.name}</strong>?</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteUser(null)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={deleteMut.isPending}
            onClick={() => deleteUser && deleteMut.mutate({ id: deleteUser.id })}>Excluir</Button>
        </div>
      </Modal>
    </div>
  )
}
