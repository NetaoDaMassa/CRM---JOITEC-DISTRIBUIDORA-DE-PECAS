import { useState } from 'react'
import { Plus, Search, Pencil, Trash2, Link2, Package, Layers, MapPin } from 'lucide-react'
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
  reservada: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
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
                {m.vaga && (
                  <span className="flex items-center gap-1 text-dark-500 text-xs mt-0.5">
                    <MapPin size={11} /> {m.vaga.portaPallet.codigo} · Andar {m.vaga.andar} · Vaga {m.vaga.posicao}
                  </span>
                )}
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

type Vaga = { id: number; andar: number; posicao: number; capacidade: number; maquinas: { id: number; numeroSerie: string; modelo: string | null; porte: string }[] }
type Rack = { id: number; codigo: string; andaresCount: number; observacoes: string | null; vagas: Vaga[] }

function ocupacaoVaga(v: Vaga) {
  return v.maquinas.reduce((s, m) => s + (m.porte === 'grande' ? v.capacidade : 1), 0)
}

function AbaRacks() {
  const [modalAberto, setModalAberto] = useState(false)
  const [editandoRack, setEditandoRack] = useState<Rack | null>(null)
  const [codigo, setCodigo] = useState('')
  const [andares, setAndares] = useState('1')
  const [observacoesRack, setObservacoesRack] = useState('')
  const [excluindoRack, setExcluindoRack] = useState<Rack | null>(null)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [qtdVaga, setQtdVaga] = useState<Record<number, string>>({})
  const [excluindoVaga, setExcluindoVaga] = useState<Vaga | null>(null)
  const [modalMaquinaVaga, setModalMaquinaVaga] = useState<Vaga | null>(null)
  const [numeroSerie, setNumeroSerie] = useState('')
  const [modeloMaquina, setModeloMaquina] = useState('')
  const [porteMaquina, setPorteMaquina] = useState<'pequeno' | 'grande'>('pequeno')

  const utils = trpc.useUtils()
  const { data: racks, isLoading } = trpc.estoque.listarRacks.useQuery()
  const selecionado = (racks ?? []).find((r) => r.id === selecionadoId) ?? null

  function invalidar() { utils.estoque.listarRacks.invalidate() }

  const criarMut = trpc.estoque.criarRack.useMutation({
    onSuccess: () => { toast.success('Porta-pallet criado'); fecharModalRack(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.estoque.atualizarRack.useMutation({
    onSuccess: () => { toast.success('Salvo'); fecharModalRack(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const excluirRackMut = trpc.estoque.excluirRack.useMutation({
    onSuccess: () => { toast.success('Porta-pallet excluído'); setExcluindoRack(null); if (selecionadoId === excluindoRack?.id) setSelecionadoId(null); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const criarVagasMut = trpc.estoque.criarVagas.useMutation({
    onSuccess: () => { toast.success('Vaga(s) adicionada(s)'); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const excluirVagaMut = trpc.estoque.excluirVaga.useMutation({
    onSuccess: () => { toast.success('Vaga excluída'); setExcluindoVaga(null); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const criarMaquinaMut = trpc.estoque.criarMaquina.useMutation({
    onSuccess: () => { toast.success('Máquina cadastrada na vaga'); fecharModalMaquina(); invalidar(); utils.estoque.listarMaquinas.invalidate() },
    onError: (e) => toast.error(e.message),
  })

  function fecharModalRack() { setModalAberto(false); setEditandoRack(null); setCodigo(''); setAndares('1'); setObservacoesRack('') }
  function abrirEdicaoRack(r: Rack) { setEditandoRack(r); setCodigo(r.codigo); setAndares(String(r.andaresCount)); setObservacoesRack(r.observacoes ?? ''); setModalAberto(true) }
  function salvarRack() {
    if (!codigo.trim()) return
    if (editandoRack) atualizarMut.mutate({ id: editandoRack.id, codigo, andaresCount: Number(andares) || 1, observacoes: observacoesRack || undefined })
    else criarMut.mutate({ codigo, andaresCount: Number(andares) || 1, observacoes: observacoesRack || undefined })
  }
  function fecharModalMaquina() { setModalMaquinaVaga(null); setNumeroSerie(''); setModeloMaquina(''); setPorteMaquina('pequeno') }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-3">
        <Button size="sm" className="w-full" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Novo Porta-Pallet</Button>

        <div className="grid grid-cols-2 gap-2">
          {(racks ?? []).map((r) => {
            const isSelected = selecionadoId === r.id
            const totalCap = r.vagas.reduce((s, v) => s + v.capacidade, 0)
            const totalOcup = r.vagas.reduce((s, v) => s + ocupacaoVaga(v), 0)
            const cheio = r.vagas.length > 0 && totalOcup >= totalCap
            return (
              <button
                key={r.id}
                onClick={() => setSelecionadoId(r.id)}
                className={`text-left bg-dark-800 border rounded-xl p-3 transition-colors ${isSelected ? 'border-gold-500 ring-1 ring-gold-500/50' : 'border-dark-600 hover:border-dark-500'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-dark-100"><Link2 size={12} className="text-dark-500" />{r.codigo}</span>
                  {cheio && <span className="text-[10px] font-bold text-red-400">CHEIO</span>}
                </div>
                <p className="text-xs text-dark-400 mt-1">{r.andaresCount} andar(es)</p>
                <p className="text-xs text-dark-400">{totalOcup}/{totalCap} · {r.vagas.length} vaga(s)</p>
              </button>
            )
          })}
          {!isLoading && (!racks || racks.length === 0) && <p className="col-span-full text-sm text-dark-500 text-center py-6">Nenhum porta-pallet cadastrado ainda</p>}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!selecionado ? (
          <div className="bg-dark-800 border border-dark-600 rounded-xl flex flex-col items-center justify-center gap-2 py-16 text-dark-500">
            <Layers size={28} />
            <p className="text-sm">Selecione um porta-pallet para ver os andares e vagas</p>
          </div>
        ) : (
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-dark-100">Porta-Pallet {selecionado.codigo}</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => abrirEdicaoRack(selecionado)} className="flex items-center gap-1 text-xs text-dark-400 hover:text-gold-400 transition-colors"><Pencil size={12} /> Editar</button>
                <button onClick={() => setExcluindoRack(selecionado)} className="flex items-center gap-1 text-xs text-dark-400 hover:text-red-400 transition-colors"><Trash2 size={12} /> Excluir</button>
              </div>
            </div>
            {selecionado.observacoes && <p className="text-sm text-dark-400">{selecionado.observacoes}</p>}

            {Array.from({ length: selecionado.andaresCount }, (_, i) => i + 1).map((andar) => {
              const vagasAndar = selecionado.vagas.filter((v) => v.andar === andar).sort((a, b) => a.posicao - b.posicao)
              return (
                <div key={andar} className="border-t border-dark-700 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dark-500 mb-2">Andar {andar}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-2">
                    {vagasAndar.map((v) => {
                      const ocup = ocupacaoVaga(v)
                      const cheia = ocup >= v.capacidade
                      const vazia = ocup === 0
                      return (
                        <div
                          key={v.id}
                          onClick={() => !cheia && setModalMaquinaVaga(v)}
                          title={cheia ? undefined : 'Clique para adicionar uma máquina nesta vaga'}
                          className={`group relative rounded-lg border-2 px-2.5 py-1.5 text-xs ${!cheia ? 'cursor-pointer hover:border-gold-500/60' : ''} ${
                            cheia ? 'border-red-700/60 bg-red-900/20' : vazia ? 'border-dashed border-dark-600' : 'border-amber-700/60 bg-amber-900/20'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-dark-300">
                            <Package size={12} className={vazia ? 'text-dark-500' : cheia ? 'text-red-400' : 'text-amber-400'} />
                            Vaga {v.posicao} · {ocup}/{v.capacidade}
                            {vazia && (
                              <button onClick={(e) => { e.stopPropagation(); setExcluindoVaga(v) }} className="ml-auto opacity-0 group-hover:opacity-100 text-dark-500 hover:text-red-400 transition-opacity" title="Excluir vaga vazia">
                                <Trash2 size={11} />
                              </button>
                            )}
                            {!vazia && !cheia && <Plus size={11} className="ml-auto opacity-0 group-hover:opacity-100 text-gold-400 transition-opacity shrink-0" />}
                          </div>
                          {v.maquinas.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {v.maquinas.map((m) => (
                                <p key={m.id} className="truncate text-[11px] font-normal text-dark-400" title={`${m.numeroSerie}${m.modelo ? ` — ${m.modelo}` : ''}`}>
                                  {m.numeroSerie}{m.modelo ? ` · ${m.modelo}` : ''}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {vagasAndar.length === 0 && <p className="col-span-full text-xs text-dark-500 italic">Nenhuma vaga neste andar ainda</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-200"
                      placeholder="Qtd."
                      value={qtdVaga[andar] ?? ''}
                      onChange={(e) => setQtdVaga((prev) => ({ ...prev, [andar]: e.target.value }))}
                    />
                    <button
                      onClick={() => { criarVagasMut.mutate({ portaPalletId: selecionado.id, andar, quantidade: Number(qtdVaga[andar]) || 1, capacidade: 2 }); setQtdVaga((prev) => ({ ...prev, [andar]: '' })) }}
                      className="flex items-center gap-1 rounded-lg border border-gold-700/50 px-2.5 py-1 text-xs font-semibold text-gold-400 hover:bg-gold-900/20 transition-colors"
                    >
                      <Plus size={12} /> Adicionar vaga(s)
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal open={modalAberto} onClose={fecharModalRack} title={editandoRack ? 'Editar Porta-Pallet' : 'Novo Porta-Pallet'} size="sm">
        <div className="p-5 space-y-4">
          <Input label="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ex: A" />
          <Input label="Número de andares" type="number" value={andares} onChange={(e) => setAndares(e.target.value)} />
          <Input label="Observações" value={observacoesRack} onChange={(e) => setObservacoesRack(e.target.value)} />
          <Button className="w-full" disabled={!codigo.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvarRack}>
            {editandoRack ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </Modal>

      <Modal open={!!excluindoRack} onClose={() => setExcluindoRack(null)} title="Excluir porta-pallet" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Excluir o porta-pallet "{excluindoRack?.codigo}"? Isso também remove todas as vagas dele.</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindoRack(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirRackMut.isPending} onClick={() => excluindoRack && excluirRackMut.mutate({ id: excluindoRack.id })}>Excluir</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!excluindoVaga} onClose={() => setExcluindoVaga(null)} title="Excluir vaga" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Excluir a vaga {excluindoVaga?.posicao} do andar {excluindoVaga?.andar}?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindoVaga(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirVagaMut.isPending} onClick={() => excluindoVaga && excluirVagaMut.mutate({ id: excluindoVaga.id })}>Excluir</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!modalMaquinaVaga} onClose={fecharModalMaquina} title={`Adicionar máquina na vaga ${modalMaquinaVaga?.posicao ?? ''}`} size="sm">
        <div className="p-5 space-y-4">
          <Input label="Número de série" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} />
          <Input label="Modelo" value={modeloMaquina} onChange={(e) => setModeloMaquina(e.target.value)} />
          <Select label="Porte" value={porteMaquina} onChange={(e) => setPorteMaquina(e.target.value as 'pequeno' | 'grande')} options={[{ value: 'pequeno', label: 'Pequeno (ocupa 1 unidade)' }, { value: 'grande', label: 'Grande (ocupa a vaga inteira)' }]} />
          <Button
            className="w-full"
            disabled={!numeroSerie.trim()}
            loading={criarMaquinaMut.isPending}
            onClick={() => modalMaquinaVaga && criarMaquinaMut.mutate({ numeroSerie, modelo: modeloMaquina || undefined, porte: porteMaquina, vagaId: modalMaquinaVaga.id })}
          >
            Cadastrar
          </Button>
        </div>
      </Modal>
    </div>
  )
}
