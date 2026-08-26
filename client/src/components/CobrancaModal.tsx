import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import ClientePicker from './ClientePicker'

const CANAL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'email', label: 'E-mail' },
]

// Registra 1 tentativa de cobrança do dia a dia — é só um log (sem fase),
// pedido do João: "quem ela cobrou, via WhatsApp/ligação/e-mail, e o que o
// cliente retornou".
export default function CobrancaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [canal, setCanal] = useState<'whatsapp' | 'ligacao' | 'email'>('whatsapp')
  const [retorno, setRetorno] = useState('')
  const [valor, setValor] = useState('')
  const [dataVencimento, setDataVencimento] = useState('')

  const criarMut = trpc.negociacoes.cobrancaCriar.useMutation({
    onSuccess() {
      toast.success('Cobrança registrada')
      utils.negociacoes.cobrancasListar.invalidate()
      setCliente(null)
      setRetorno('')
      setValor('')
      setDataVencimento('')
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function handleSalvar() {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!retorno.trim()) return toast.error('Escreva o retorno do cliente')
    criarMut.mutate({
      clienteId: cliente.id,
      canal,
      retornoCliente: retorno.trim(),
      valor: valor ? Number(valor.replace(',', '.')) : undefined,
      dataVencimento: dataVencimento || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova cobrança">
      <div className="space-y-4">
        <ClientePicker label="Cliente" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor (opcional)" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
          <Input label="Vencimento (opcional)" type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
        </div>
        <Select label="Canal" value={canal} onChange={(e) => setCanal(e.target.value as typeof canal)} options={CANAL_OPTIONS} />
        <Textarea label="O que o cliente retornou" value={retorno} onChange={(e) => setRetorno(e.target.value)} rows={3} placeholder="Ex: disse que paga até sexta" />
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
