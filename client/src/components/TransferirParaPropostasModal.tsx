import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'

// Lead "Ganho" da Odin Compressores vira Proposta (não Carteira — essa
// empresa não usa) — diferente da "Nova Proposta" comum (só exige nome),
// aqui o vendedor é obrigado a já dizer o que está sendo proposto antes
// de transferir. Dali pra frente segue o funil normal de Propostas.
export default function TransferirParaPropostasModal({
  open,
  onClose,
  leadId,
  telefoneSugerido,
}: {
  open: boolean
  onClose: () => void
  leadId: number
  telefoneSugerido: string
}) {
  const utils = trpc.useUtils()
  const [produtosDescricao, setProdutosDescricao] = useState('')
  const [clienteWhatsapp, setClienteWhatsapp] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('')
  const [observacoes, setObservacoes] = useState('')

  useEffect(() => {
    if (open) setClienteWhatsapp(telefoneSugerido)
  }, [open, telefoneSugerido])

  const mut = trpc.leads.transferirParaPropostas.useMutation({
    onSuccess() {
      toast.success('Proposta criada')
      utils.leads.get.invalidate({ id: leadId })
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!produtosDescricao.trim()) return toast.error('Descreva o que está sendo proposto')
    mut.mutate({
      leadId,
      produtosDescricao,
      clienteWhatsapp: clienteWhatsapp || undefined,
      formaPagamento: formaPagamento || undefined,
      observacoes: observacoes || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Transferir pra Propostas">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-dark-500">Diz o que está sendo proposto antes de virar um card em Propostas — o resto (PDF, negociação) segue o fluxo normal de lá.</p>
        <Input label="Produtos/Serviços *" value={produtosDescricao} onChange={(e) => setProdutosDescricao(e.target.value)} placeholder="Ex: 2x compressor OD-100" />
        <Input label="WhatsApp do cliente" value={clienteWhatsapp} onChange={(e) => setClienteWhatsapp(e.target.value)} />
        <Input label="Forma de pagamento (opcional)" value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} />
        <Textarea label="Observações (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Criar proposta
          </Button>
        </div>
      </form>
    </Modal>
  )
}
