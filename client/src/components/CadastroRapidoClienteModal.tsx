import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input } from './ui/Input'

const REGIOES = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

export type ClienteCriadoRapido = {
  id: number
  razaoSocial: string
  codigo: string
  empresaId: number
  empresaNome: string
  vendedorId: number
  vendedorNome: string
}

// Cadastro mínimo de cliente, aberto de dentro de Negociações/Liberação de
// Crédito quando o financeiro procura um cliente e ele ainda não existe na
// base — em vez de travar o processo esperando o vendedor cadastrar depois,
// cria aqui mesmo com o básico (nome + vendedor) e já segue pro Kanban dele
// com o selo "🆕 Cadastro rápido" (ver schema.ts, clientes.cadastroRapido).
// Pedido do João, 2026-10-01.
export default function CadastroRapidoClienteModal({
  open,
  onClose,
  onCriado,
}: {
  open: boolean
  onClose: () => void
  onCriado: (cliente: ClienteCriadoRapido) => void
}) {
  const { empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: open })
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: open })

  const [razaoSocial, setRazaoSocial] = useState('')
  const [codigoSap, setCodigoSap] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState('')
  const [regiao, setRegiao] = useState('')
  const [vendedorId, setVendedorId] = useState('')

  function limpar() {
    setRazaoSocial('')
    setCodigoSap('')
    setCnpj('')
    setTelefoneWhatsapp('')
    setRegiao('')
    setVendedorId('')
  }

  const criarMut = trpc.clientes.create.useMutation({
    onSuccess(data) {
      const empresaNome = empresas?.find((e) => e.id === empresaAtivaId)?.nome ?? ''
      const vendedorNome = vendedores?.find((v) => v.id === Number(vendedorId))?.name ?? ''
      toast.success('Cliente cadastrado — já caiu no Kanban dele')
      onCriado({
        id: data.id,
        razaoSocial,
        codigo: data.codigo,
        empresaId: empresaAtivaId!,
        empresaNome,
        vendedorId: Number(vendedorId),
        vendedorNome,
      })
      limpar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function salvar() {
    if (!razaoSocial.trim()) return toast.error('Informe o nome/razão social.')
    if (!vendedorId) return toast.error('Escolha o vendedor que vai ficar com esse cliente.')
    criarMut.mutate({
      razaoSocial: razaoSocial.trim(),
      codigo: codigoSap.trim() || undefined,
      cnpj: cnpj.trim() || undefined,
      telefoneWhatsapp: telefoneWhatsapp.trim() || undefined,
      regiao: (regiao || undefined) as any,
      vendedorAtualId: Number(vendedorId),
      cadastroRapido: true,
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        limpar()
        onClose()
      }}
      title="Cadastrar cliente novo"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-xs text-dark-400">
          Só o básico, pra não travar o processo — o vendedor completa o resto depois. Esse cliente já entra na
          carteira e no Kanban do vendedor escolhido abaixo.
        </p>
        <Input label="Razão social / nome *" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} autoFocus />
        <Input
          label="Código SAP (opcional)"
          value={codigoSap}
          onChange={(e) => setCodigoSap(e.target.value)}
          placeholder="Se já souber o código..."
        />
        <Input label="CNPJ (opcional)" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="Só números" />
        <Input
          label="Telefone/WhatsApp (opcional)"
          value={telefoneWhatsapp}
          onChange={(e) => setTelefoneWhatsapp(e.target.value)}
        />
        <Select
          label="Região (opcional)"
          value={regiao}
          onChange={(e) => setRegiao(e.target.value)}
          placeholder="Se souber..."
          options={REGIOES}
        />
        <Select
          label="Vendedor *"
          value={vendedorId}
          onChange={(e) => setVendedorId(e.target.value)}
          placeholder="Escolha o vendedor..."
          options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
        />
        <Button className="w-full" loading={criarMut.isPending} onClick={salvar}>
          Cadastrar e continuar
        </Button>
      </div>
    </Modal>
  )
}
