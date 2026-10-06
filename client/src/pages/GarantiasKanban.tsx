import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Search, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import GarantiasBoard from '../components/GarantiasBoard'
import GarantiasDetail from './GarantiasDetail'
import CadastroRapidoClienteModal from '../components/CadastroRapidoClienteModal'

// `view` guarda 'analise' | '1' (com retorno) | '0' (sem retorno) — a fila
// de Análise é nova, pedido do João 2026-10-06 (etapa de triagem antes de
// decidir se precisa mesmo abrir processo de garantia).
export default function GarantiasKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/garantias' : '/vendedor/garantias'
  const { id } = useParams()
  const navigate = useNavigate()

  const [view, setView] = usePersistedState<'analise' | '1' | '0'>('garantiasKanban:view', 'analise')
  const [modalAberto, setModalAberto] = useState(false)
  const [busca, setBusca] = usePersistedState('garantiasKanban:busca', '')

  const [clienteId, setClienteId] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false)
  const [modeloMaquina, setModeloMaquina] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [observacoes, setObservacoes] = useState('')

  const utils = trpc.useUtils()
  const comRetornoQuery = view === 'analise' ? null : view === '1'
  const { data: garantiasTodas, isLoading } = trpc.garantias.core.listarKanban.useQuery({ comRetorno: comRetornoQuery })
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })

  const termo = busca.trim().toLowerCase()
  const garantias = termo
    ? (garantiasTodas ?? []).filter((g) => String(g.id).includes(termo) || g.cliente?.razaoSocial.toLowerCase().includes(termo) || g.cliente?.codigo?.toLowerCase().includes(termo))
    : garantiasTodas

  function resetForm() {
    setClienteId('')
    setClienteNome('')
    setBuscaCliente('')
    setModeloMaquina('')
    setNumeroSerie('')
    setObservacoes('')
  }

  const criarMut = trpc.garantias.core.criar.useMutation({
    onSuccess() {
      toast.success('Reclamação registrada pra Análise')
      setModalAberto(false)
      resetForm()
      utils.garantias.core.listarKanban.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function registrar() {
    if (!clienteId) return toast.error('Escolha o cliente')
    criarMut.mutate({
      clienteId: Number(clienteId),
      modeloMaquina: modeloMaquina || undefined,
      numeroSerie: numeroSerie || undefined,
      observacoes: observacoes || undefined,
    })
  }

  if (id) return <GarantiasDetail garantiaId={Number(id)} onClose={() => navigate(basePath)} />

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-xl text-dark-50 font-bold">Garantias</h1>
        <Button size="sm" onClick={() => setModalAberto(true)}>
          <Plus size={14} className="mr-1" /> Nova reclamação
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex rounded-lg border border-dark-600 overflow-hidden">
          <button
            onClick={() => setView('analise')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === 'analise' ? 'bg-gold-600 text-dark-950' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            Análise
          </button>
          <button
            onClick={() => setView('1')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === '1' ? 'bg-gold-600 text-dark-950' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            Com retorno
          </button>
          <button
            onClick={() => setView('0')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === '0' ? 'bg-gold-600 text-dark-950' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            Sem retorno
          </button>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente ou nº..."
            className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-8 pr-3 py-1.5 text-sm text-dark-100 focus:outline-none focus:border-gold-600"
          />
        </div>
      </div>

      {isLoading ? <p className="text-dark-400 text-sm">Carregando...</p> : <GarantiasBoard garantias={garantias ?? []} comRetorno={comRetornoQuery} basePath={basePath} />}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Nova reclamação (Análise)" size="md">
        <div className="p-5 space-y-4">
          <div>
            <Input label="Buscar cliente" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} placeholder="Nome ou código..." />
            {clienteNome && <p className="text-xs text-gold-400 mt-1">Selecionado: {clienteNome}</p>}
            {clientesResultado && buscaCliente.trim().length >= 2 && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-dark-600 rounded-lg divide-y divide-dark-700">
                {clientesResultado.items.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setClienteId(String(c.id))
                      setClienteNome(c.razaoSocial)
                      setBuscaCliente('')
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-dark-700 ${String(c.id) === clienteId ? 'bg-dark-700 text-gold-400' : 'text-dark-200'}`}
                  >
                    {c.razaoSocial}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCadastroRapidoAberto(true)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gold-400 hover:bg-dark-700 flex items-center gap-1.5"
                >
                  <UserPlus size={13} /> Não achou? Cadastrar cliente novo
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Produto" value={modeloMaquina} onChange={(e) => setModeloMaquina(e.target.value)} placeholder="Modelo da máquina/peça" />
            <Input label="Nº de série" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} />
          </div>

          <Textarea label="Observações (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />

          <Button className="w-full" loading={criarMut.isPending} onClick={registrar}>
            Registrar pra Análise
          </Button>
        </div>
      </Modal>

      <CadastroRapidoClienteModal
        open={cadastroRapidoAberto}
        onClose={() => setCadastroRapidoAberto(false)}
        onCriado={(cliente) => {
          setClienteId(String(cliente.id))
          setClienteNome(cliente.razaoSocial)
          setBuscaCliente('')
          setCadastroRapidoAberto(false)
        }}
      />
    </div>
  )
}
