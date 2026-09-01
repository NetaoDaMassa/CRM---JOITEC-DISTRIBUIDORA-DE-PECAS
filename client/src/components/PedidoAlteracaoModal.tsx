import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'
import Select from './ui/Select'
import ClientePicker from './ClientePicker'

const TIPO_ALTERACAO = [
  { value: 'data', label: 'Alteração de data de vencimento' },
  { value: 'valor', label: 'Alteração de valor' },
  { value: 'cancelamento', label: 'Boleto cancelado' },
]

// Registra 1 pedido de alteração de boleto (mudar vencimento/valor/cancelar)
// — planilha do dia a dia, pedido do João 2026-09-01: cliente ou vendedor
// pede, fica registrado aqui até o Financeiro executar de fato, sem
// precisar linkar num boleto específico (às vezes o boleto nem existe ainda
// no sistema, só o número que o cliente informou por telefone).
export default function PedidoAlteracaoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [numeroBoleto, setNumeroBoleto] = useState('')
  const [valor, setValor] = useState('')
  const [tipoAlteracao, setTipoAlteracao] = useState('')
  const [descricao, setDescricao] = useState('')

  const criarMut = trpc.boletos.pedidosCriar.useMutation({
    onSuccess() {
      toast.success('Pedido registrado')
      utils.boletos.pedidosListar.invalidate()
      setCliente(null)
      setNumeroBoleto('')
      setValor('')
      setTipoAlteracao('')
      setDescricao('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function handleSalvar() {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!tipoAlteracao) return toast.error('Escolha o que foi pedido')
    criarMut.mutate({
      clienteId: cliente.id,
      numeroBoleto: numeroBoleto.trim() || undefined,
      valor: valor ? Number(valor.replace(',', '.')) : undefined,
      tipoAlteracao: tipoAlteracao as 'data' | 'valor' | 'cancelamento',
      descricao: descricao.trim() || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo pedido de alteração">
      <div className="space-y-4">
        <ClientePicker label="Cliente" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nº do boleto" value={numeroBoleto} onChange={(e) => setNumeroBoleto(e.target.value)} placeholder="Opcional" />
          <Input label="Valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Opcional" />
        </div>
        <Select label="O que foi pedido" value={tipoAlteracao} onChange={(e) => setTipoAlteracao(e.target.value)} placeholder="Selecione..." options={TIPO_ALTERACAO} />
        <Textarea label="Observações" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Detalhe aqui, se precisar (opcional)" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} loading={criarMut.isPending}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
