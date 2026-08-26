import { useState } from 'react'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import OrdensBoard from '../components/OrdensBoard'
import { ORDER_TYPE_VALUES, ORDER_TYPE_LABELS, type OrderType } from '../lib/ordensShared'

export default function OrdensKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/ordens' : '/vendedor/ordens'

  const [orderType, setOrderType] = useState<OrderType>('maquina')
  const [modalAberto, setModalAberto] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [novoOrderType, setNovoOrderType] = useState<OrderType>('maquina')

  const utils = trpc.useUtils()
  const { data: ordens, isLoading } = trpc.ordens.core.listarKanban.useQuery({ orderType })
  const { data: clientesResultado } = trpc.clientes.list.useQuery({ q: buscaCliente, pagina: 1 }, { enabled: buscaCliente.trim().length >= 2 })

  const criarMut = trpc.ordens.core.criar.useMutation({
    onSuccess() {
      toast.success('Pedido criado')
      setModalAberto(false)
      setClienteId('')
      setBuscaCliente('')
      utils.ordens.core.listarKanban.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Pedidos</h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-dark-800 border border-dark-600 rounded-lg p-1">
            {ORDER_TYPE_VALUES.map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${orderType === t ? 'bg-gold-600 text-dark-950 font-semibold' : 'text-dark-300 hover:text-dark-100'}`}
              >
                {ORDER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setModalAberto(true)}>
            <Plus size={14} className="mr-1" /> Novo Pedido
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <OrdensBoard ordens={ordens ?? []} orderType={orderType} basePath={basePath} />
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Novo Pedido" size="sm">
        <div className="p-5 space-y-4">
          <Select
            label="Tipo de pedido"
            value={novoOrderType}
            onChange={(e) => setNovoOrderType(e.target.value as OrderType)}
            options={ORDER_TYPE_VALUES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))}
          />
          <div>
            <Input label="Buscar cliente" value={buscaCliente} onChange={(e) => { setBuscaCliente(e.target.value); setClienteId('') }} placeholder="Nome ou código..." />
            {clientesResultado && clientesResultado.items.length > 0 && !clienteId && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-dark-600 rounded-lg bg-dark-800">
                {clientesResultado.items.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-700"
                    onClick={() => { setClienteId(String(c.id)); setBuscaCliente(c.razaoSocial) }}
                  >
                    {c.razaoSocial}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            className="w-full"
            disabled={!clienteId || criarMut.isPending}
            loading={criarMut.isPending}
            onClick={() => criarMut.mutate({ clienteId: Number(clienteId), orderType: novoOrderType })}
          >
            Criar pedido
          </Button>
        </div>
      </Modal>
    </div>
  )
}
