import { useRef, useState } from 'react'
import { Plus, Edit3, Trash2, UserCheck, UserX, KeyRound, Camera, Tv, Eye, EyeOff, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import AvatarMeta from '../../components/ui/AvatarMeta'
import { formatDate, formatDateTime, timeAgo, downloadBase64Excel } from '../../lib/utils'

function fmtMinutos(segundos: number): string {
  const mins = Math.round(segundos / 60)
  if (mins < 60) return `${mins}min`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}min`
}

function AccessBadge({
  accessedToday,
  lastLoginAt,
  lastLoginTimeToday,
  onlineNow,
  onlineSecondsToday,
}: {
  accessedToday: boolean
  lastLoginAt: string | null
  lastLoginTimeToday: string | null
  onlineNow: boolean
  onlineSecondsToday: number
}) {
  if (accessedToday) {
    return (
      <span className="inline-flex flex-col text-xs font-medium text-green-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full bg-green-500 ${onlineNow ? 'shadow-[0_0_6px_rgba(34,197,94,0.8)]' : ''}`} />
          {onlineNow ? 'Online agora' : `Online hoje às ${lastLoginTimeToday}`}
        </span>
        {onlineSecondsToday > 0 && <span className="text-dark-500 font-normal ml-3.5">{fmtMinutos(onlineSecondsToday)} online hoje</span>}
      </span>
    )
  }
  if (!lastLoginAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-dark-500">
        <span className="w-2 h-2 rounded-full bg-dark-600" />
        Nunca acessou
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-dark-400" title={formatDateTime(lastLoginAt)}>
      <span className="w-2 h-2 rounded-full bg-dark-600" />
      {timeAgo(lastLoginAt)} ({formatDateTime(lastLoginAt)})
    </span>
  )
}

function AccessHeatmap({
  days,
  accessed,
  dayTimes,
  dayOnlineSeconds,
}: {
  days: string[]
  accessed: boolean[]
  dayTimes: string[][]
  dayOnlineSeconds: number[]
}) {
  return (
    <div className="flex gap-0.5">
      {days.map((day, i) => {
        const times = dayTimes[i] ?? []
        const onlineSeconds = dayOnlineSeconds[i] ?? 0
        const dateLabel = day.split('-').reverse().join('/')
        const tooltip = times.length
          ? `${dateLabel} — acessou às ${times.join(', ')}${onlineSeconds > 0 ? ` · ${fmtMinutos(onlineSeconds)} online` : ''}`
          : `${dateLabel} — não acessou`
        return <span key={day} title={tooltip} className={`w-2.5 h-4 rounded-sm ${accessed[i] ? 'bg-green-500/80' : 'bg-dark-700'}`} />
      })}
    </div>
  )
}

// Resumo rápido "X/14 dias" ao lado do heatmap — bate o olho sem precisar
// contar os pontinhos. Verde = entrou todos os dias, amarelo = faltou pouco,
// vermelho = faltou muito (limites arbitrários, só pra guiar o olho).
function AccessStreak({ accessed }: { accessed: boolean[] }) {
  const total = accessed.length
  const acessados = accessed.filter(Boolean).length
  const pct = total > 0 ? acessados / total : 0
  const cor = pct === 1 ? 'text-green-400' : pct >= 0.7 ? 'text-yellow-400' : 'text-red-400'
  return (
    <span className={`text-xs font-medium ${cor}`} title={`Acessou em ${acessados} dos ${total} dias úteis do mês (até hoje)`}>
      {acessados}/{total} dias
    </span>
  )
}

// Status "visível" explícito (ativo + aparecendo no Painel de TV) — antes só
// avisava quando estava oculto, agora sempre mostra um dos dois estados.
function VisibilityBadge({ isActive, ocultoPainelTv }: { isActive: boolean; ocultoPainelTv: boolean }) {
  if (!isActive) return null
  if (ocultoPainelTv) {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-400 mt-0.5">
        <EyeOff size={12} />
        Oculto do Painel de TV
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-green-400 mt-0.5">
      <Eye size={12} />
      Visível
    </span>
  )
}

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
  whatsapp: string
}

const DEFAULT_FORM: UserForm = { name: '', username: '', role: 'vendor', regiao: '', whatsapp: '' }

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
  const { data: accessLog } = trpc.users.accessLog.useQuery()
  const accessByUser = new Map((accessLog?.users ?? []).map((u) => [u.id, u]))

  const exportMut = trpc.users.exportAccessLog.useMutation({
    onSuccess(data) {
      downloadBase64Excel(data.data, data.filename)
      toast.success('Relatório de acessos exportado!')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

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
        await updateMut.mutateAsync({
          id: editUser.id,
          name: form.name,
          username: form.username,
          role: form.role,
          regiao: (form.regiao || undefined) as any,
          whatsapp: form.whatsapp || undefined,
        })
        userId = editUser.id
      } else {
        const data = await createMut.mutateAsync({ name: form.name, username: form.username, role: form.role, regiao: (form.regiao || undefined) as any })
        userId = data.id
        if (form.whatsapp) await updateMut.mutateAsync({ id: userId, whatsapp: form.whatsapp })
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
    setForm({ name: user.name, username: user.username, role: user.role, regiao: user.regiao ?? '', whatsapp: user.whatsapp ?? '' })
    setFotoForm(null)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Vendedores</h1>
          <p className="text-dark-400 text-sm">{users?.length ?? 0} usuários cadastrados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" loading={exportMut.isPending} onClick={() => exportMut.mutate()}>
            <Download size={16} />
            Exportar acessos (mês)
          </Button>
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
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-600 bg-dark-700/50">
              {['Foto', 'Nome', 'Usuário', 'Região', 'Perfil', 'Status', 'Acesso', 'Dias trabalhados no mês', 'Cadastrado', 'Ações'].map((h) => (
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
                    {Array.from({ length: 10 }).map((_, j) => (
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
                      <VisibilityBadge isActive={user.isActive} ocultoPainelTv={user.ocultoPainelTv} />
                    </td>
                    <td className="px-4 py-3">
                      <AccessBadge
                        accessedToday={accessByUser.get(user.id)?.accessedToday ?? false}
                        lastLoginAt={accessByUser.get(user.id)?.lastLoginAt ?? null}
                        lastLoginTimeToday={accessByUser.get(user.id)?.lastLoginTimeToday ?? null}
                        onlineNow={accessByUser.get(user.id)?.onlineNow ?? false}
                        onlineSecondsToday={accessByUser.get(user.id)?.onlineSecondsToday ?? 0}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {accessLog && (
                        <div className="flex flex-col gap-1">
                          <AccessStreak accessed={accessByUser.get(user.id)?.days ?? accessLog.days.map(() => false)} />
                          <AccessHeatmap
                            days={accessLog.days}
                            accessed={accessByUser.get(user.id)?.days ?? accessLog.days.map(() => false)}
                            dayTimes={accessByUser.get(user.id)?.dayTimes ?? accessLog.days.map(() => [])}
                            dayOnlineSeconds={accessByUser.get(user.id)?.dayOnlineSeconds ?? accessLog.days.map(() => 0)}
                          />
                        </div>
                      )}
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
                        <button
                          onClick={() => updateMut.mutate({ id: user.id, ocultoPainelTv: !user.ocultoPainelTv })}
                          className={`p-1.5 rounded-lg transition-colors ${user.ocultoPainelTv ? 'hover:bg-green-900/30 text-green-400' : 'hover:bg-yellow-900/30 text-yellow-400'}`}
                          title={user.ocultoPainelTv ? 'Mostrar no Painel de TV' : 'Ocultar do Painel de TV'}
                        >
                          {user.ocultoPainelTv ? <Tv size={14} /> : <EyeOff size={14} />}
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
            label="Usuário (login)"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          {!!editUser && (
            <p className="text-xs text-dark-500 -mt-2">
              Cuidado: isso muda o que a pessoa digita pra entrar no sistema — avise ela se trocar.
            </p>
          )}
          <Select
            label="Região"
            value={form.regiao}
            onChange={(e) => setForm({ ...form, regiao: e.target.value })}
            placeholder="Sem região"
            options={REGIOES}
          />
          <Input
            label="WhatsApp (opcional)"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="Ex: 5511999999999"
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
