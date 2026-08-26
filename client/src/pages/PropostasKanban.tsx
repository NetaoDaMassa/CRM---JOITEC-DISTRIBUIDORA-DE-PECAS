import { useState } from 'react'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import PropostasBoard from '../components/PropostasBoard'

export default function PropostasKanban() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/propostas' : '/vendedor/propostas'

  const [modalAberto, setModalAberto] = useState(false)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [produtosDescricao, setProdutosDescricao] = useState('')

  const utils = trpc.useUtils()
  const { data: propostas, isLoading } = trpc.propostas.listar.useQuery()

  const criarMut = trpc.propostas.criar.useMutation({
    onSuccess() {
      toast.success('Proposta criada')
      setModalAberto(false)
      setClienteNome('')
      setClienteWhatsapp('')
      setProdutosDescricao('')
      utils.propostas.listar.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Propostas</h1>
        <Button size="sm" onClick={() => setModalAberto(true)}>
          <Plus size={14} className="mr-1" /> Nova Proposta
        </Button>
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <PropostasBoard propostas={propostas ?? []} basePath={basePath} mostrarVendedor={isAdmin} />
      )}

      <Modal open={modalAberto} onClose={() => setModalAberto(false)} title="Nova Proposta" size="sm">
        <div className="p-5 space-y-4">
          <Input label="Nome do cliente" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
          <Input label="WhatsApp do cliente" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />
          <Input label="Produtos/Serviços" value={produtosDescricao} onChange={(e) => setProdutosDescricao(e.target.value)} />
          <Button
            className="w-full"
            disabled={!clienteNome || criarMut.isPending}
            loading={criarMut.isPending}
            onClick={() => criarMut.mutate({ clienteNome, clienteWhatsapp: clienteWhatsapp || undefined, produtosDescricao: produtosDescricao || undefined })}
          >
            Criar proposta
          </Button>
        </div>
      </Modal>
    </div>
  )
}
