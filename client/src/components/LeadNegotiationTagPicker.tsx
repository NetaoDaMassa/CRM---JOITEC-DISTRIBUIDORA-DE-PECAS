import { trpc } from '../lib/trpc'
import toast from 'react-hot-toast'

const OPCOES: { value: 'vermelho' | 'amarelo' | null; label: string; classe: string }[] = [
  { value: null, label: 'Sem tag', classe: 'bg-dark-700 text-dark-300 border-dark-600' },
  { value: 'amarelo', label: '🟡 Atenção', classe: 'bg-amber-900/30 text-amber-300 border-amber-700/50' },
  { value: 'vermelho', label: '🔴 Risco', classe: 'bg-red-900/30 text-red-300 border-red-700/50' },
]

// Marcador visual livre pro vendedor/admin sinalizar risco na negociação —
// não afeta nenhuma regra, é só um aviso visual no Kanban/lista.
export default function LeadNegotiationTagPicker({ leadId, tag }: { leadId: number; tag: string | null }) {
  const utils = trpc.useUtils()
  const mut = trpc.leads.setNegotiationTag.useMutation({
    onSuccess() {
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {OPCOES.map((op) => (
        <button
          key={op.label}
          type="button"
          disabled={mut.isPending}
          onClick={() => mut.mutate({ id: leadId, tag: op.value })}
          className={`text-xs px-2 py-1 rounded-full border transition-all ${op.classe} ${
            tag === op.value ? 'ring-1 ring-offset-1 ring-offset-dark-800 ring-current' : 'opacity-60 hover:opacity-100'
          }`}
        >
          {op.label}
        </button>
      ))}
    </div>
  )
}
