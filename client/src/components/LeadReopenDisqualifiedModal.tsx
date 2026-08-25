import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Textarea } from './ui/Input'
import { LEAD_STATUS_VALUES, LEAD_STATUS_LABELS, isLeadTerminalStatus, isLeadStatusAllowedForEmpresa, type LeadStatus } from '../lib/leadsShared'

// Admin reabre um lead "Desqualificado" de volta pro funil — reatribui por
// rodízio automaticamente (ver server/src/router/leads.ts).
export default function LeadReopenDisqualifiedModal({
  leadId,
  empresaSlug,
  open,
  onClose,
  onSuccess,
}: {
  leadId: number
  empresaSlug: string | undefined
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState<LeadStatus>('novo')
  const [observation, setObservation] = useState('')

  const mut = trpc.leads.reopenDisqualified.useMutation({
    onSuccess() {
      toast.success('Lead reaberto')
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
      utils.leads.pendingDisqualificationReviews.invalidate()
      setObservation('')
      onClose()
      onSuccess?.()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const opcoesEtapa = LEAD_STATUS_VALUES.filter((s) => !isLeadTerminalStatus(s) && isLeadStatusAllowedForEmpresa(s, empresaSlug))

  return (
    <Modal open={open} onClose={onClose} title="Reabrir lead desqualificado" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!observation.trim()) return toast.error('Descreva o motivo da reabertura')
          mut.mutate({ id: leadId, status, observation })
        }}
        className="space-y-4"
      >
        <Select
          label="Reabrir para a etapa"
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          options={opcoesEtapa.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))}
        />
        <Textarea
          label="Por que está reabrindo? *"
          value={observation}
          onChange={(e) => setObservation(e.target.value)}
          rows={3}
          placeholder="Ex: cliente retornou contato, desqualificação foi engano..."
        />
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Reabrir
          </Button>
        </div>
      </form>
    </Modal>
  )
}
