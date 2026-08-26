import { useState } from 'react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'
import ClientePicker from './ClientePicker'

// Formulário de criação compartilhado entre Cartório e RC — mesma forma
// (cliente, valor opcional, data de envio, observações), só muda o título
// e pra onde a mutation manda o registro.
export default function NegociacaoStatusModal({
  open,
  onClose,
  titulo,
  onCriar,
  criando,
}: {
  open: boolean
  onClose: () => void
  titulo: string
  onCriar: (input: { clienteId: number; valor?: number; enviadoEm: string; observacoes?: string }) => void
  criando: boolean
}) {
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [valor, setValor] = useState('')
  const [enviadoEm, setEnviadoEm] = useState('')
  const [observacoes, setObservacoes] = useState('')

  function handleSalvar() {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!enviadoEm) return toast.error('Informe a data de envio')
    const valorNumero = valor ? Number(valor.replace(',', '.')) : undefined
    onCriar({ clienteId: cliente.id, valor: valorNumero, enviadoEm, observacoes: observacoes || undefined })
    setCliente(null)
    setValor('')
    setEnviadoEm('')
    setObservacoes('')
  }

  return (
    <Modal open={open} onClose={onClose} title={titulo}>
      <div className="space-y-4">
        <ClientePicker label="Cliente" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor (opcional)" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
          <Input label="Enviado em" type="date" value={enviadoEm} onChange={(e) => setEnviadoEm(e.target.value)} />
        </div>
        <Textarea label="Observações" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} placeholder="Opcional" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} loading={criando}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
