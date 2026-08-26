import { useState } from 'react'
import { Plus, Search, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'

type RevendaForm = {
  nome: string
  nomeContato: string
  telefoneContato: string
  cidade: string
  estado: string
  responsavel: string
  observacoes: string
}

const FORM_VAZIO: RevendaForm = { nome: '', nomeContato: '', telefoneContato: '', cidade: '', estado: '', responsavel: '', observacoes: '' }

export default function Revendas() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<RevendaForm>(FORM_VAZIO)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)

  const utils = trpc.useUtils()
  const { data: revendas, isLoading } = trpc.revendas.listar.useQuery()

  const criarMut = trpc.revendas.criar.useMutation({
    onSuccess: () => { toast.success('Revenda adicionada'); fechar(); utils.revendas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.revendas.atualizar.useMutation({
    onSuccess: () => { toast.success('Salvo'); fechar(); utils.revendas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.revendas.excluir.useMutation({
    onSuccess: () => { toast.success('Removida'); setExcluindo(null); utils.revendas.listar.invalidate() },
    onError: (e) => toast.error(e.message),
  })

  function fechar() {
    setModalAberto(false)
    setEditando(null)
    setForm(FORM_VAZIO)
  }

  function abrirEdicao(r: NonNullable<typeof revendas>[number]) {
    setEditando(r.id)
    setForm({
      nome: r.nome,
      nomeContato: r.nomeContato ?? '',
      telefoneContato: r.telefoneContato ?? '',
      cidade: r.cidade ?? '',
      estado: r.estado ?? '',
      responsavel: r.responsavel ?? '',
      observacoes: r.observacoes ?? '',
    })
    setModalAberto(true)
  }

  function salvar() {
    if (!form.nome.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  const filtradas = (revendas ?? []).filter((r) => {
    const q = busca.toLowerCase()
    return !q || r.nome.toLowerCase().includes(q) || r.cidade?.toLowerCase().includes(q) || r.responsavel?.toLowerCase().includes(q)
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Revendas</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => setModalAberto(true)}>
            <Plus size={14} className="mr-1" /> Nova Revenda
          </Button>
        )}
      </div>

      <div className="w-72 mb-4">
        <Input icon={<Search size={14} />} placeholder="Buscar por nome, cidade, responsável..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtradas.map((r) => (
            <div key={r.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-dark-100">{r.nome}</h3>
                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => abrirEdicao(r)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                    <button onClick={() => setExcluindo({ id: r.id, nome: r.nome })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <div className="space-y-1 text-xs text-dark-400">
                {r.responsavel && <div>Responsável: {r.responsavel}</div>}
                {r.nomeContato && <div>Contato: {r.nomeContato}{r.telefoneContato ? ` · ${r.telefoneContato}` : ''}</div>}
                {(r.cidade || r.estado) && <div>{[r.cidade, r.estado].filter(Boolean).join(' - ')}</div>}
                {r.observacoes && <div className="text-dark-500 mt-1.5">{r.observacoes}</div>}
              </div>
            </div>
          ))}
          {filtradas.length === 0 && <p className="text-dark-500 text-sm col-span-full">Nenhuma revenda encontrada</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Revenda' : 'Nova Revenda'} size="md">
        <div className="p-5 space-y-4">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome do contato" value={form.nomeContato} onChange={(e) => setForm({ ...form, nomeContato: e.target.value })} />
            <Input label="Telefone do contato" value={form.telefoneContato} onChange={(e) => setForm({ ...form, telefoneContato: e.target.value })} />
            <Input label="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            <Input label="Estado" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} maxLength={2} />
            <Input label="Responsável" value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} className="col-span-2" />
          </div>
          <Input label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <Button className="w-full" disabled={!form.nome.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>
            {editando ? 'Salvar' : 'Adicionar'}
          </Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover revenda" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover a revenda "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>
              Remover
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
