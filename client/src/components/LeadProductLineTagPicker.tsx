import { trpc } from '../lib/trpc'
import toast from 'react-hot-toast'

// Etiqueta de linha de produto — só Odin Tubos e Conexões usa (ver
// LeadDetail.tsx, gate por empresaSlug). Diferente de LeadNegotiationTagPicker:
// aqui as duas opções são independentes (um lead pode ter as duas marcadas).
export default function LeadProductLineTagPicker({
  leadId,
  pprVerde,
  outrasLinhas,
}: {
  leadId: number
  pprVerde: boolean
  outrasLinhas: boolean
}) {
  const utils = trpc.useUtils()
  const mut = trpc.leads.setProductLineTags.useMutation({
    onSuccess() {
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function toggle(campo: 'pprVerde' | 'outrasLinhas') {
    mut.mutate({
      id: leadId,
      pprVerde: campo === 'pprVerde' ? !pprVerde : pprVerde,
      outrasLinhas: campo === 'outrasLinhas' ? !outrasLinhas : outrasLinhas,
    })
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={mut.isPending}
        onClick={() => toggle('pprVerde')}
        className={`text-xs px-2 py-1 rounded-full border transition-all bg-emerald-900/30 text-emerald-300 border-emerald-700/50 ${
          pprVerde ? 'ring-1 ring-offset-1 ring-offset-dark-800 ring-current' : 'opacity-60 hover:opacity-100'
        }`}
      >
        🌿 PPR Verde
      </button>
      <button
        type="button"
        disabled={mut.isPending}
        onClick={() => toggle('outrasLinhas')}
        className={`text-xs px-2 py-1 rounded-full border transition-all bg-teal-900/30 text-teal-300 border-teal-700/50 ${
          outrasLinhas ? 'ring-1 ring-offset-1 ring-offset-dark-800 ring-current' : 'opacity-60 hover:opacity-100'
        }`}
      >
        📦 Outras Linhas
      </button>
    </div>
  )
}
