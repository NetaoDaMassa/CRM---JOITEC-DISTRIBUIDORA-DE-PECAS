import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Textarea } from './ui/Input'
import ClientePicker from './ClientePicker'

// Registra 1 pedido de alteração de boleto (mudar vencimento/valor) — só um
// log pra não perder o pedido do cliente, sem precisar linkar num boleto
// específico (às vezes o boleto nem existe ainda no sistema).
export default function PedidoAlteracaoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [descricao, setDescricao] = useState('')

  const criarMut = trpc.boletos.pedidosCriar.useMutation({
    onSuccess() {
      toast.success('Pedido registrado')
      utils.boletos.pedidosListar.invalidate()
      setCliente(null)
      setDescricao('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function handleSalvar() {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!descricao.trim()) return toast.error('Descreva o que foi pedido')
    criarMut.mutate({ clienteId: cliente.id, descricao: descricao.trim() })
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo pedido de alteração">
      <div className="space-y-4">
        <ClientePicker label="Cliente" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />
        <Textarea
          label="O que foi pedido"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={3}
          placeholder="Ex: pediu pra mudar o vencimento do boleto 142/3 pra dia 10"
        />
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
