import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from './Input'
import Button from './Button'
import { LigarButton, WhatsappButton } from './ContatoButtons'

// Gerencia os telefones extras de um cliente (além do WhatsApp principal) —
// pedido do João pra vendedor conseguir cadastrar mais de um número por
// cliente. Reaproveitado tanto na ficha do cliente quanto no card do Kanban.
export default function TelefonesExtras({
  clienteId,
  telefones,
  onChanged,
}: {
  clienteId: number
  telefones: { id: number; numero: string; rotulo?: string | null }[]
  onChanged: () => void
}) {
  const [adicionando, setAdicionando] = useState(false)
  const [numero, setNumero] = useState('')
  const [rotulo, setRotulo] = useState('')

  const adicionarMut = trpc.telefones.adicionar.useMutation({
    onSuccess() {
      toast.success('Telefone adicionado')
      setNumero('')
      setRotulo('')
      setAdicionando(false)
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirMut = trpc.telefones.excluir.useMutation({
    onSuccess() {
      toast.success('Telefone removido')
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="space-y-2">
      <label className="text-xs text-dark-400 block">Outros telefones</label>
      {telefones.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-sm text-dark-200">
          <LigarButton telefone={t.numero} size="sm" />
          <WhatsappButton telefone={t.numero} clienteId={clienteId} size="sm" />
          <span>
            {t.numero}
            {t.rotulo ? ` (${t.rotulo})` : ''}
          </span>
          <button
            type="button"
            onClick={() => excluirMut.mutate({ id: t.id })}
            className="text-red-400 hover:text-red-300 text-xs ml-auto"
          >
            Remover
          </button>
        </div>
      ))}

      {adicionando ? (
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-center">
          <Input placeholder="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
          <Input placeholder="Rótulo (opcional)" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
          <Button
            type="button"
            size="sm"
            loading={adicionarMut.isPending}
            onClick={() => {
              if (!numero.trim()) return toast.error('Informe o número')
              adicionarMut.mutate({ clienteId, numero: numero.trim(), rotulo: rotulo.trim() || undefined })
            }}
          >
            Salvar
          </Button>
          <button type="button" onClick={() => setAdicionando(false)} className="text-xs text-dark-400 hover:underline">
            Cancelar
          </button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setAdicionando(true)}>
          + Adicionar telefone
        </Button>
      )}
    </div>
  )
}
