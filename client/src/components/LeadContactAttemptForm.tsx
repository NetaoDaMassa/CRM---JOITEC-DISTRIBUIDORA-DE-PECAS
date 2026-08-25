import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input } from './ui/Input'
import { LEAD_CHANNEL_VALUES, LEAD_CHANNEL_LABELS, LEAD_RESULT_VALUES, LEAD_RESULT_LABELS } from '../lib/leadsShared'

// Registra uma tentativa de contato (ligação/whatsapp/email) — leads ativos
// exigem uma data de próximo contato (a do próprio lead já serve, só pede
// aqui se ainda não tiver nenhuma).
export default function LeadContactAttemptForm({ leadId, hasNextContact }: { leadId: number; hasNextContact: boolean }) {
  const utils = trpc.useUtils()
  const [channel, setChannel] = useState<(typeof LEAD_CHANNEL_VALUES)[number]>('whatsapp')
  const [result, setResult] = useState<(typeof LEAD_RESULT_VALUES)[number]>('sem_resposta')
  const [nextActionAt, setNextActionAt] = useState('')

  const mut = trpc.leads.addContactAttempt.useMutation({
    onSuccess() {
      toast.success('Tentativa registrada')
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
      setNextActionAt('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mut.mutate({ leadId, channel, result, nextActionAt: nextActionAt || undefined })
      }}
      className="bg-dark-900/60 rounded-xl p-3 space-y-2"
    >
      <p className="text-xs font-semibold text-dark-300">Registrar tentativa de contato</p>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={channel}
          onChange={(e) => setChannel(e.target.value as any)}
          options={LEAD_CHANNEL_VALUES.map((c) => ({ value: c, label: LEAD_CHANNEL_LABELS[c] }))}
        />
        <Select
          value={result}
          onChange={(e) => setResult(e.target.value as any)}
          options={LEAD_RESULT_VALUES.map((r) => ({ value: r, label: LEAD_RESULT_LABELS[r] }))}
        />
      </div>
      {!hasNextContact && (
        <Input
          label="Próximo contato"
          type="datetime-local"
          value={nextActionAt}
          onChange={(e) => setNextActionAt(e.target.value)}
        />
      )}
      <Button type="submit" size="sm" className="w-full" loading={mut.isPending}>
        Registrar
      </Button>
    </form>
  )
}
