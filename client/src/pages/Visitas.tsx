import { useState } from 'react'
import { Plus, MapPin, Pencil, Trash2, LogIn, LogOut } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

const OBJETIVOS = ['Prospecção de clientes', 'Visita marketing', 'Manutenção', 'Pós venda']
const RESULTADOS = [
  { value: '', label: 'Em andamento' },
  { value: 'gerar_proposta', label: 'Gerar Proposta' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'nao_encontrado', label: 'Não encontrado' },
]
const RESULTADO_LABELS: Record<string, string> = Object.fromEntries(RESULTADOS.map((r) => [r.value, r.label]))
const RESULTADO_CORES: Record<string, string> = {
  '': 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  gerar_proposta: 'text-green-400 bg-green-900/20 border-green-700/40',
  follow_up: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  sem_interesse: 'text-red-400 bg-red-900/20 border-red-700/40',
  nao_encontrado: 'text-dark-400 bg-dark-700/50 border-dark-600',
}

type TabKey = 'visitas' | 'clientes'

export default function Visitas() {
  const [tab, setTab] = useState<TabKey>('visitas')
  return (
    <div className="p-6">
      <h1 className="font-heading text-2xl text-dark-50 font-bold mb-4">Visitas de Campo</h1>
      <div className="flex gap-1 border-b border-dark-700 mb-5">
        {(['visitas', 'clientes'] as TabKey[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}>
            {t === 'visitas' ? 'Visitas' : 'Clientes de Campo'}
          </button>
        ))}
      </div>
      {tab === 'visitas' ? <AbaVisitas /> : <AbaClientes />}
    </div>
  )
}

type VisitaForm = {
  dataVisita: string
  nomeEmpresa: string
  pessoaContato: string
  telefoneContato: string
  endereco: string
  objetivo: string
  resultado: string
  proximoPasso: string
  dataRetorno: string
  observacoes: string
  propostaItens: string
  propostaPagamento: string
  propostaComissao: string
  propostaRevenda: string
}
const VISITA_VAZIA: VisitaForm = {
  dataVisita: new Date().toISOString().slice(0, 16),
  nomeEmpresa: '', pessoaContato: '', telefoneContato: '', endereco: '', objetivo: '', resultado: '', proximoPasso: '', dataRetorno: '', observacoes: '',
  propostaItens: '', propostaPagamento: '', propostaComissao: '', propostaRevenda: '',
}

function AbaVisitas() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<VisitaForm>(VISITA_VAZIA)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)

  const utils = trpc.useUtils()
  const { data: visitasList, isLoading } = trpc.visitas.listar.useQuery()

  function invalidar() { utils.visitas.listar.invalidate() }
  const criarMut = trpc.visitas.criar.useMutation({
    onSuccess: (r) => { toast.success(r.propostaId ? `Visita registrada — Proposta #${r.propostaId} criada!` : 'Visita registrada'); fechar(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.visitas.atualizar.useMutation({
    onSuccess: (r) => { toast.success(r.propostaId ? `Salvo — Proposta #${r.propostaId} criada!` : 'Salvo'); fechar(); invalidar() },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.visitas.excluir.useMutation({ onSuccess: () => { toast.success('Removida'); setExcluindo(null); invalidar() }, onError: (e) => toast.error(e.message) })
  const checkinMut = trpc.visitas.checkin.useMutation({ onSuccess: () => { toast.success('Check-in registrado'); invalidar() }, onError: (e) => toast.error(e.message) })
  const checkoutMut = trpc.visitas.checkout.useMutation({ onSuccess: () => { toast.success('Check-out registrado'); invalidar() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(VISITA_VAZIA) }
  function abrirEdicao(v: NonNullable<typeof visitasList>[number]) {
    setEditando(v.id)
    setForm({
      dataVisita: v.dataVisita?.slice(0, 16) ?? VISITA_VAZIA.dataVisita,
      nomeEmpresa: v.nomeEmpresa ?? v.clienteNome ?? '',
      pessoaContato: v.pessoaContato ?? '',
      telefoneContato: v.telefoneContato ?? '',
      endereco: v.endereco ?? '',
      objetivo: v.objetivo ?? '',
      resultado: v.resultado ?? '',
      proximoPasso: v.proximoPasso ?? '',
      dataRetorno: v.dataRetorno ?? '',
      observacoes: v.observacoes ?? '',
      propostaItens: v.propostaItens ?? '',
      propostaPagamento: v.propostaPagamento ?? '',
      propostaComissao: v.propostaComissao ?? '',
      propostaRevenda: v.propostaRevenda ?? '',
    })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.nomeEmpresa.trim() && !form.dataVisita) return
    const payload = { ...form, clienteNome: form.nomeEmpresa }
    if (editando) atualizarMut.mutate({ id: editando, ...payload })
    else criarMut.mutate(payload)
  }

  function fazerCheckin(id: number) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => checkinMut.mutate({ id, lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => checkinMut.mutate({ id }),
        { timeout: 5000 }
      )
    } else {
      checkinMut.mutate({ id })
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Nova Visita</Button>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-2">
          {(visitasList ?? []).map((v) => {
            const podeEditar = isAdmin || v.vendedorId === user?.id
            return (
              <div key={v.id} className="p-3 rounded-lg border border-dark-600 bg-dark-800 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-dark-100 font-medium">{v.nomeEmpresa || v.clienteNome || v.cliente?.nome || 'Visita sem nome'}</div>
                    <div className="text-dark-500 text-xs mt-0.5">{v.dataVisita} {isAdmin && v.vendedor ? `· ${v.vendedor.name}` : ''}{v.objetivo ? ` · ${v.objetivo}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={RESULTADO_CORES[v.resultado ?? '']}>{RESULTADO_LABELS[v.resultado ?? ''] ?? v.resultado}</Badge>
                    {v.convertidoParaPropostaId && <Badge className="text-cyan-400 bg-cyan-900/20 border-cyan-700/40">Proposta #{v.convertidoParaPropostaId}</Badge>}
                    {podeEditar && (
                      <>
                        {!v.checkinEm && <button onClick={() => fazerCheckin(v.id)} title="Check-in" className="text-dark-400 hover:text-green-400"><LogIn size={14} /></button>}
                        {v.checkinEm && !v.checkoutEm && <button onClick={() => checkoutMut.mutate({ id: v.id })} title="Check-out" className="text-dark-400 hover:text-yellow-400"><LogOut size={14} /></button>}
                        <button onClick={() => abrirEdicao(v)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                      </>
                    )}
                    {isAdmin && <button onClick={() => setExcluindo({ id: v.id, nome: v.nomeEmpresa || v.clienteNome || `#${v.id}` })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>}
                  </div>
                </div>
                {v.checkinEm && (
                  <div className="flex items-center gap-1 text-[11px] text-dark-500 mt-1.5">
                    <MapPin size={10} /> Check-in {v.checkinEm}{v.checkoutEm ? ` · Check-out ${v.checkoutEm}` : ''}
                  </div>
                )}
                {v.proximoPasso && <div className="text-xs text-dark-400 mt-1.5">{v.proximoPasso}</div>}
              </div>
            )
          })}
          {(!visitasList || visitasList.length === 0) && <p className="text-dark-500 text-sm">Nenhuma visita registrada</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Visita' : 'Nova Visita'} size="lg">
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data/Hora" type="datetime-local" value={form.dataVisita} onChange={(e) => setForm({ ...form, dataVisita: e.target.value })} />
            <Select label="Objetivo" value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} placeholder="Selecione..." options={OBJETIVOS.map((o) => ({ value: o, label: o }))} />
          </div>
          <Input label="Empresa/Cliente" value={form.nomeEmpresa} onChange={(e) => setForm({ ...form, nomeEmpresa: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Pessoa de contato" value={form.pessoaContato} onChange={(e) => setForm({ ...form, pessoaContato: e.target.value })} />
            <Input label="Telefone" value={form.telefoneContato} onChange={(e) => setForm({ ...form, telefoneContato: e.target.value })} />
          </div>
          <Input label="Endereço" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
          <Select label="Resultado" value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value })} options={RESULTADOS} />

          {form.resultado === 'gerar_proposta' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-green-700/30 bg-green-900/10">
              <Input label="Produtos/Serviços" value={form.propostaItens} onChange={(e) => setForm({ ...form, propostaItens: e.target.value })} className="col-span-2" />
              <Input label="Forma de pagamento" value={form.propostaPagamento} onChange={(e) => setForm({ ...form, propostaPagamento: e.target.value })} />
              <Input label="Comissão" value={form.propostaComissao} onChange={(e) => setForm({ ...form, propostaComissao: e.target.value })} />
              <Input label="Revenda" value={form.propostaRevenda} onChange={(e) => setForm({ ...form, propostaRevenda: e.target.value })} className="col-span-2" />
            </div>
          )}
          {form.resultado === 'follow_up' && <Input label="Data de retorno" type="date" value={form.dataRetorno} onChange={(e) => setForm({ ...form, dataRetorno: e.target.value })} />}

          <Input label="Próximo passo" value={form.proximoPasso} onChange={(e) => setForm({ ...form, proximoPasso: e.target.value })} />
          <Input label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <Button className="w-full" loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Registrar visita'}</Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover visita" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover a visita "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

type ClienteForm = { nome: string; cnpj: string; nomeContato: string; telefoneContato: string; endereco: string; cidade: string; estado: string; segmento: string; observacoes: string }
const CLIENTE_VAZIO: ClienteForm = { nome: '', cnpj: '', nomeContato: '', telefoneContato: '', endereco: '', cidade: '', estado: '', segmento: '', observacoes: '' }

function AbaClientes() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [form, setForm] = useState<ClienteForm>(CLIENTE_VAZIO)
  const [excluindo, setExcluindo] = useState<{ id: number; nome: string } | null>(null)

  const utils = trpc.useUtils()
  const { data: clientes, isLoading } = trpc.visitas.listarClientes.useQuery()

  function invalidar() { utils.visitas.listarClientes.invalidate() }
  const criarMut = trpc.visitas.criarCliente.useMutation({ onSuccess: () => { toast.success('Cadastrado'); fechar(); invalidar() }, onError: (e) => toast.error(e.message) })
  const atualizarMut = trpc.visitas.atualizarCliente.useMutation({ onSuccess: () => { toast.success('Salvo'); fechar(); invalidar() }, onError: (e) => toast.error(e.message) })
  const excluirMut = trpc.visitas.excluirCliente.useMutation({ onSuccess: () => { toast.success('Removido'); setExcluindo(null); invalidar() }, onError: (e) => toast.error(e.message) })

  function fechar() { setModalAberto(false); setEditando(null); setForm(CLIENTE_VAZIO) }
  function abrirEdicao(c: NonNullable<typeof clientes>[number]) {
    setEditando(c.id)
    setForm({ nome: c.nome, cnpj: c.cnpj ?? '', nomeContato: c.nomeContato ?? '', telefoneContato: c.telefoneContato ?? '', endereco: c.endereco ?? '', cidade: c.cidade ?? '', estado: c.estado ?? '', segmento: c.segmento ?? '', observacoes: c.observacoes ?? '' })
    setModalAberto(true)
  }
  function salvar() {
    if (!form.nome.trim()) return
    if (editando) atualizarMut.mutate({ id: editando, ...form })
    else criarMut.mutate(form)
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setModalAberto(true)}><Plus size={14} className="mr-1" /> Novo Cliente de Campo</Button>
      </div>
      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(clientes ?? []).map((c) => (
            <div key={c.id} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="text-sm font-semibold text-dark-100">{c.nome}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => abrirEdicao(c)} className="text-dark-400 hover:text-gold-400"><Pencil size={14} /></button>
                  {isAdmin && <button onClick={() => setExcluindo({ id: c.id, nome: c.nome })} className="text-dark-400 hover:text-red-400"><Trash2 size={14} /></button>}
                </div>
              </div>
              <div className="text-xs text-dark-400 space-y-0.5">
                {c.nomeContato && <div>{c.nomeContato}{c.telefoneContato ? ` · ${c.telefoneContato}` : ''}</div>}
                {(c.cidade || c.estado) && <div>{[c.cidade, c.estado].filter(Boolean).join(' - ')}</div>}
                {c.segmento && <div className="text-dark-500">{c.segmento}</div>}
              </div>
            </div>
          ))}
          {(!clientes || clientes.length === 0) && <p className="text-dark-500 text-sm col-span-full">Nenhum cliente de campo cadastrado</p>}
        </div>
      )}

      <Modal open={modalAberto} onClose={fechar} title={editando ? 'Editar Cliente de Campo' : 'Novo Cliente de Campo'} size="md">
        <div className="p-5 space-y-4">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
            <Input label="Segmento" value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} />
            <Input label="Contato" value={form.nomeContato} onChange={(e) => setForm({ ...form, nomeContato: e.target.value })} />
            <Input label="Telefone" value={form.telefoneContato} onChange={(e) => setForm({ ...form, telefoneContato: e.target.value })} />
            <Input label="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            <Input label="Estado" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} maxLength={2} />
          </div>
          <Input label="Endereço" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
          <Input label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <Button className="w-full" disabled={!form.nome.trim()} loading={criarMut.isPending || atualizarMut.isPending} onClick={salvar}>{editando ? 'Salvar' : 'Cadastrar'}</Button>
        </div>
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Remover cliente de campo" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-dark-300">Remover "{excluindo?.nome}"?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExcluindo(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={excluirMut.isPending} onClick={() => excluindo && excluirMut.mutate({ id: excluindo.id })}>Remover</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
