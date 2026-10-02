import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input, Textarea } from '../components/ui/Input'
import GarantiasBoard from '../components/GarantiasBoard'
import GarantiasDetail from './GarantiasDetail'
import { TIPO_ATENDIMENTO_VALUES, TIPO_ATENDIMENTO_LABELS, type TipoAtendimento } from '../lib/garantiasShared'

export default function GarantiasKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/garantias' : '/vendedor/garantias'
  const { id } = useParams()
  const navigate = useNavigate()

  const [comRetorno, setComRetorno] = usePersistedState<'1' | '0'>('garantiasKanban:comRetorno', '1')
  const [modalAberto, setModalAberto] = useState(false)
  const [busca, setBusca] = usePersistedState('garantiasKanban:busca', '')

  const [pedidoId, setPedidoId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [tipoAtendimento, setTipoAtendimento] = useState<TipoAtendimento>('maquina_completa')
  const [comRetornoNovo, setComRetornoNovo] = useState(true)
  const [descricaoDefeito, setDescricaoDefeito] = useState('')
  const [modeloMaquina, setModeloMaquina] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [tecnicoNome, setTecnicoNome] = useState('')
  const [tecnicoWhatsapp, setTecnicoWhatsapp] = useState('')

  const utils = trpc.useUtils()
  const { data: garantiasTodas, isLoading } = trpc.garantias.core.listarKanban.useQuery({ comRetorno: comRetorno === '1' })
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })
  const { data: dadosPedido } = trpc.garantias.core.obterDadosPedido.useQuery({ pedidoId: Number(pedidoId) }, { enabled: !!pedidoId && Number(pedidoId) > 0 })

  // Pedido vinculado já traz cliente/máquina — preenche sozinho em vez de
  // obrigar a buscar o cliente de novo na mão.
  useEffect(() => {
    if (!dadosPedido) return
    setClienteId(String(dadosPedido.clienteId))
    if (dadosPedido.modeloMaquina) setModeloMaquina(dadosPedido.modeloMaquina)
    if (dadosPedido.numeroSerie) setNumeroSerie(dadosPedido.numeroSerie)
  }, [dadosPedido])

  const termo = busca.trim().toLowerCase()
  const garantias = termo
    ? (garantiasTodas ?? []).filter((g) => String(g.id).includes(termo) || g.cliente?.razaoSocial.toLowerCase().includes(termo) || g.cliente?.codigo?.toLowerCase().includes(termo))
    : garantiasTodas

  function resetForm() {
    setPedidoId('')
    setClienteId('')
    setBuscaCliente('')
    setTipoAtendimento('maquina_completa')
    setComRetornoNovo(true)
    setDescricaoDefeito('')
    setModeloMaquina('')
    setNumeroSerie('')
    setTecnicoNome('')
    setTecnicoWhatsapp('')
  }

  const criarMut = trpc.garantias.core.criar.useMutation({
    onSuccess() {
      toast.success('Processo de garantia aberto')
      setModalAberto(false)
      resetForm()
      utils.garantias.core.listarKanban.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const ehTecnico = tipoAtendimento === 'peca_tecnico'
  const comRetornoEfetivo = tipoAtendimento === 'maquina_completa' || tipoAtendimento === 'peca_com_retorno' ? true : tipoAtendimento === 'peca_sem_retorno' ? false : comRetornoNovo

  function abrirProcesso() {
    if (!clienteId) return toast.error('Escolha o cliente')
    if (!descricaoDefeito.trim()) return toast.error('Descreva o defeito')
    if (ehTecnico && !tecnicoNome.trim()) return toast.error('Informe o nome do técnico autorizado')
    criarMut.mutate({
      pedidoId: pedidoId ? Number(pedidoId) : undefined,
      clienteId: Number(clienteId),
      tipoAtendimento,
      comRetorno: comRetornoEfetivo,
      descricaoDefeito,
      modeloMaquina: modeloMaquina || undefined,
      numeroSerie: numeroSerie || undefined,
      tecnicoNome: ehTecnico ? tecnicoNome : undefined,
      tecnicoWhatsapp: ehTecnico ? tecnicoWhatsapp : undefined,
    })
  }

  if (id) return <GarantiasDetail garantiaId={Number(id)} onClose={() => navigate(basePath)} />

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-xl text-dark-50 font-bold">Garantias</h1>
        <Button size="sm" onClick={() => setModalAberto(true)}>
          <Plus size={14} className="mr-1" /> Abrir processo
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex rounded-lg border border-dark-600 overflow-hidden">
          <button
            onClick={() => setComRetorno('1')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${comRetorno === '1' ? 'bg-gold-600 text-dark-950' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
          >
            Com retorno
          </button>
          <button
            onClick={() => setComRetorno('0')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${comRetorno === '0' ? 'bg-gold-600 text-dark-950' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}
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

      {isLoading ? <p className="text-dark-400 text-sm">Carregando...</p> : <GarantiasBoard garantias={garantias ?? []} comRetorno={comRetorno === '1'} basePath={basePath} />}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Abrir processo de garantia" size="md">
        <div className="p-5 space-y-4">
          <Input label="Nº do Pedido (opcional — se vinculado)" type="number" value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} placeholder="Ex: 57" />
          {dadosPedido && (
            <p className="text-xs text-dark-400 -mt-2">
              Pedido de <span className="text-dark-200">{dadosPedido.clienteNome}</span>
              {dadosPedido.modeloMaquina ? ` — ${dadosPedido.modeloMaquina}` : ''}
            </p>
          )}

          {!pedidoId && (
            <div>
              <Input label="Buscar cliente" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} placeholder="Nome ou código..." />
              {clientesResultado && buscaCliente.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-y-auto border border-dark-600 rounded-lg divide-y divide-dark-700">
                  {clientesResultado.items.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setClienteId(String(c.id))
                        setBuscaCliente(c.razaoSocial)
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-dark-700 ${String(c.id) === clienteId ? 'bg-dark-700 text-gold-400' : 'text-dark-200'}`}
                    >
                      {c.razaoSocial}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Select
            label="Tipo de atendimento"
            value={tipoAtendimento}
            onChange={(e) => setTipoAtendimento(e.target.value as TipoAtendimento)}
            options={TIPO_ATENDIMENTO_VALUES.map((v) => ({ value: v, label: TIPO_ATENDIMENTO_LABELS[v] }))}
          />

          {ehTecnico && (
            <label className="flex items-center gap-2 text-sm text-dark-200">
              <input type="checkbox" checked={comRetornoNovo} onChange={(e) => setComRetornoNovo(e.target.checked)} /> Tem retorno do item danificado à Odin
            </label>
          )}

          {ehTecnico && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Nome do técnico autorizado" value={tecnicoNome} onChange={(e) => setTecnicoNome(e.target.value)} />
              <Input label="WhatsApp do técnico" value={tecnicoWhatsapp} onChange={(e) => setTecnicoWhatsapp(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input label="Modelo da máquina" value={modeloMaquina} onChange={(e) => setModeloMaquina(e.target.value)} />
            <Input label="Nº de série" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} />
          </div>

          <Textarea label="Descrição do defeito" value={descricaoDefeito} onChange={(e) => setDescricaoDefeito(e.target.value)} />

          <Button className="w-full" loading={criarMut.isPending} onClick={abrirProcesso}>
            Abrir processo
          </Button>
        </div>
      </Modal>
    </div>
  )
}
