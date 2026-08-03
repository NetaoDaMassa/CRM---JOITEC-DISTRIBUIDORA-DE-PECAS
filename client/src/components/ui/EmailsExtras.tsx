import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from './Input'
import Button from './Button'
import EmailButton from './EmailButton'

// Gerencia os e-mails extras de um cliente (além do e-mail principal) —
// mesma ideia do TelefonesExtras, pro vendedor conseguir cadastrar mais de
// um e-mail por cliente. Reaproveitado na ficha do cliente e no card do Kanban.
export default function EmailsExtras({
  clienteId,
  emails,
  onChanged,
}: {
  clienteId: number
  emails: { id: number; email: string; rotulo?: string | null }[]
  onChanged: () => void
}) {
  const [adicionando, setAdicionando] = useState(false)
  const [email, setEmail] = useState('')
  const [rotulo, setRotulo] = useState('')

  const adicionarMut = trpc.emails.adicionar.useMutation({
    onSuccess() {
      toast.success('E-mail adicionado')
      setEmail('')
      setRotulo('')
      setAdicionando(false)
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const excluirMut = trpc.emails.excluir.useMutation({
    onSuccess() {
      toast.success('E-mail removido')
      onChanged()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="space-y-2">
      <label className="text-xs text-dark-400 block">Outros e-mails</label>
      {emails.map((e) => (
        <div key={e.id} className="flex items-center gap-2 text-sm text-dark-200">
          <EmailButton email={e.email} size="sm" />
          <span>
            {e.email}
            {e.rotulo ? ` (${e.rotulo})` : ''}
          </span>
          <button
            type="button"
            onClick={() => excluirMut.mutate({ id: e.id })}
            className="text-red-400 hover:text-red-300 text-xs ml-auto"
          >
            Remover
          </button>
        </div>
      ))}

      {adicionando ? (
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-center">
          <Input placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Rótulo (opcional)" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
          <Button
            type="button"
            size="sm"
            loading={adicionarMut.isPending}
            onClick={() => {
              if (!email.trim()) return toast.error('Informe o e-mail')
              adicionarMut.mutate({ clienteId, email: email.trim(), rotulo: rotulo.trim() || undefined })
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
          + Adicionar e-mail
        </Button>
      )}
    </div>
  )
}
