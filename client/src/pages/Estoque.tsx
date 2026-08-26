import { useState } from 'react'
import { Plus, Search, Pencil, Trash2, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

type TabKey = 'maquinas' | 'catalogo' | 'racks'
const TAB_LABELS: Record<TabKey, string> = { maquinas: 'Máquinas em Estoque', catalogo: 'Catálogo de Modelos', racks: 'Porta-Pallets' }

const STATUS_LABELS: Record<string, string> = { estoque: 'Em estoque', reservada: 'Reservada', alocada: 'Alocada', vendida: 'Vendida' }
const STATUS_COLORS: Record<string, string> = {
  estoque: 'text-green-400 bg-green-900/20 border-green-700/40',
  reservada: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  alocada: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  vendida: 'text-dark-400 bg-dark-700/50 border-dark-600',
}

export default function Estoque() {
  const [tab, setTab] = useState<TabKey>('maquinas')

  return (
    <div className="p-6">
      <h1 className="font-heading text-2xl text-dark-50 font-bold mb-4">Almoxarifado</h1>
      <div className="flex gap-1 border-b border-dark-700 mb-5">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'maquinas' && <AbaMaquinas />}
      {tab === 'catalogo' && <AbaCatalogo />}
      {tab === 'racks' && <AbaRacks />}
    </div>
  )
}

type MaquinaForm = { numeroSerie: string; modelo: string; voltagem: string; pressaoBar: string; porte: 'pequeno' | 'grande'; dataEntrada: string; observacoes: string }
const MAQUINA_VAZIA: MaquinaForm = { numeroSerie: '', modelo: '', voltagem: '', pressaoBar: '', porte: 'pequeno', dataEntrada: '', observacoes: '' }

function AbaMaquinas() {
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<MaquinaForm>(MAQUINA_VAZIA)
  const [excluindo, setExcluindo] = useState<{ id: number; numeroSerie: string } | null>(null)

  const utils = trpc.useUtils()
  const { data: maquinas, isLoading } = trpc.estoque.listarMaquinas.useQuery({ q: busca || undefined, status: statusFiltro || undefined })

  const criarMut = trpc.estoque.criarMaquina.useMutation({ onSuccess: () => { toast.success('Máquina cadastrada'); fechar(); utils.estoque.listarMaquinas.invalidate() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.estoque.atualizarMaquina.useMutation({ onSuccess: () => { toast.success('Salvo'); fechar(); utils.estoque.listarMaquinas.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.estoque.excluirMaquina.useMutation({ onSuccess: () => { toast.success('Removida'); setExcluindo(null); utils.estoque.listarMaquinas.invalidate() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(MAQUINA_VAZIA) }
  function abrirEdicao(m: NonNullable<typeof maquinas>[number]) {
    setEditando(m.id)
    setForm({ numeroSerie: m.numeroSerie, modelo: m.modelo ?? '', voltagem: m.voltagem ?? '', pressaoBar: m.pressaoBar ?? '', porte: m.porte as 'pequeno' | 'grande', dataEntrada: m.dataEntrada ?? '', observacoes: m.observacoes ?? '' })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.numeroSerie.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex gap-2">
          <Input icon={<Search size={14} />} placeholder="Buscar por série ou modelo..." value={busca} onChange={(e) => setBusca(e.target.value)} className="w-64" />
          <Select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} placeholder="Todos os status" options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} className="w-44" />
        </div>
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Nova Máquina</Button>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-2">
          {(maquinas ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <div>
                <span className="text-dark-100 font-medium">{m.numeroSerie}</span>
                <span className="text-dark-500 ml-2">{m.modelo}</span>
                {m.voltagem && <span className="text-dark-500 ml-2">· {m.voltagem}V</span>}
                {m.ordem && <span className="text-dark-500 ml-2">· Pedido #{m.ordem.id}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={STATUS_COLORS[m.status]}>{STATUS_LABELS[m.status]}</Badge>
                <button onClick={() => abrirEdicao(m)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                <button onClick={() => setExcluindo({ id: m.id, numeroSerie: m.numeroSerie })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {(!maquinas || maquinas.length === 0) && <p className="text-dark-500 text-sm">Nenhuma máquina encontrada</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Máquina' : 'Nova Máquina'} size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Número de série" value={form.numeroSerie} onChange={(e) => setForm({ ...form, numeroSerie: e.target.value })} />
            <Input label="Modelo" value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} />
            <Input label="Voltagem" value={form.voltagem} onChange={(e) => setForm({ ...form, voltagem: e.target.value })} />
            <Input label="Pressão (bar)" value={form.pressaoBar} onChange={(e) => setForm({ ...form, pressaoBar: e.target.value })} />
            <Select label="Porte" value={form.porte} onChange={(e) => setForm({ ...form, porte: e.target.value as 'pequeno' | 'grande' })} options={[{ value: 'pequeno', label: 'Pequeno' }, { value: 'grande', label: 'Grande' }]} />
            <Input label="Data de entrada" type="date" value={form.dataEntrada} onChange={(e) => setForm({ ...form, dataEntrada: e.target.value })} />
          </div>
          <Input label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <Button className="w-full" disabled={!form.numeroSerie.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Cadastrar'}</Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover máquina" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover a máquina "{excluindo?.numeroSerie}" do estoque?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

type CatalogoForm = { categoria: string; linha: string; modelo: string; especificacoes: string }
const CATALOGO_VAZIO: CatalogoForm = { categoria: '', linha: '', modelo: '', especificacoes: '' }

function AbaCatalogo() {
  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<CatalogoForm>(CATALOGO_VAZIO)
  const [excluindo, setExcluindo] = useState<{ id: number; modelo: string } | null>(null)

  const utils = trpc.useUtils()
  const { data: catalogo, isLoading } = trpc.estoque.listarCatalogo.useQuery({ q: busca || undefined })

  const criarMut = trpc.estoque.criarCatalogo.useMutation({ onSuccess: () => { toast.success('Modelo cadastrado'); fechar(); utils.estoque.listarCatalogo.invalidate() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.estoque.atualizarCatalogo.useMutation({ onSuccess: () => { toast.success('Salvo'); fechar(); utils.estoque.listarCatalogo.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.estoque.excluirCatalogo.useMutation({ onSuccess: () => { toast.success('Removido'); setExcluindo(null); utils.estoque.listarCatalogo.invalidate() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(CATALOGO_VAZIO) }
  function abrirEdicao(c: NonNullable<typeof catalogo>[number]) {
    setEditando(c.id)
    setForm({ categoria: c.categoria, linha: c.linha ?? '', modelo: c.modelo, especificacoes: c.especificacoes ?? '' })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.categoria.trim() || !form.modelo.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Input icon={<Search size={14} />} placeholder="Buscar modelo ou categoria..." value={busca} onChange={(e) => setBusca(e.target.value)} className="w-72" />
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Novo Modelo</Button>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(catalogo ?? []).map((c) => (
            <div key={c.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="text-sm font-semibold text-dark-100">{c.modelo}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => abrirEdicao(c)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                  <button onClick={() => setExcluindo({ id: c.id, modelo: c.modelo })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="text-xs text-dark-400">{c.categoria}{c.linha ? ` · ${c.linha}` : ''}</div>
              {c.especificacoes && <div className="text-xs text-dark-500 mt-1.5">{c.especificacoes}</div>}
            </div>
          ))}
          {(!catalogo || catalogo.length === 0) && <p className="text-dark-500 text-sm col-span-full">Nenhum modelo encontrado</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Modelo' : 'Novo Modelo'} size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="ex: Compressor" />
            <Input label="Linha" value={form.linha} onChange={(e) => setForm({ ...form, linha: e.target.value })} placeholder="ex: Premium (VSD)" />
          </div>
          <Input label="Modelo" value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} />
          <Input label="Especificações" value={form.especificacoes} onChange={(e) => setForm({ ...form, especificacoes: e.target.value })} />
          <Button className="w-full" disabled={!form.categoria.trim() || !form.modelo.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Cadastrar'}</Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover modelo" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover o modelo "{excluindo?.modelo}" do catálogo?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function AbaRacks() {
  const [modalAberto, setModalAberto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [andares, setAndares] = useState('1')

  const utils = trpc.useUtils()
  const { data: racks, isLoading } = trpc.estoque.listarRacks.useQuery()
  const criarMut = trpc.estoque.criarRack.useMutation({
    onSuccess: () => { toast.success('Porta-pallet criado'); setModalAberto(false); setCodigo(''); setAndares('1'); utils.estoque.listarRacks.invalidate() },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-dark-500">Estrutura física do almoxarifado — usada opcionalmente pra localizar uma máquina.</p>
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Novo Porta-Pallet</Button>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(racks ?? []).map((r) => (
            <div key={r.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Link2 size={13} className="text-dark-500" />
                <h3 className="text-sm font-semibold text-dark-100">{r.codigo}</h3>
              </div>
              <div className="text-xs text-dark-400">{r.andaresCount} andar(es) · {r.vagas.length} vaga(s) cadastrada(s)</div>
              {r.observacoes && <div className="text-xs text-dark-500 mt-1.5">{r.observacoes}</div>}
            </div>
          ))}
          {(!racks || racks.length === 0) && <p className="text-dark-500 text-sm col-span-full">Nenhum porta-pallet cadastrado</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Novo Porta-Pallet" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ex: A" />
          <Input label="Número de andares" type="number" value={andares} onChange={(e) => setAndares(e.target.value)} />
          <Button className="w-full" disabled={!codigo.trim()} loading={criarMut.isPending} onClick={() => criarMut.mutate({ codigo, andaresCount: Number(andares) || 1 })}>
            Criar
          </Button>
        </div>
      </Modal>
    </div>
  )
}
