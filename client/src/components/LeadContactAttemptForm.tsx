import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input } from './ui/Input'
import { LEAD_CHANNEL_VALUES, LEAD_CHANNEL_LABELS, LEAD_RESULT_VALUES, LEAD_RESULT_LABELS } from '../lib/leadsShared'

// Registra uma tentativa de contato (ligação/whatsapp/email) — leads ativos
// exigem uma data de próximo contato. A do próprio lead serve enquanto não
// venceu; se já venceu (lead ATRASADO), pede a nova aqui — antes o campo
// sumia sempre que existia qualquer data, e o lead continuava atrasado
// mesmo depois de atendido (João, 2026-10-20).
function hojeLocalYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function LeadContactAttemptForm({ leadId, proximoContato, encerrado }: { leadId: number; proximoContato: string | null; encerrado?: boolean }) {
  const vencido = !encerrado && !!proximoContato && proximoContato.slice(0, 10) < hojeLocalYmd()
  const pedirData = !encerrado && (!proximoContato || vencido)
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
        if (vencido && !nextActionAt) {
          toast.error('O próximo contato já venceu — escolha a nova data pra tirar o lead do atraso')
          return
        }
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
      {pedirData && (
        <>
          {vencido && (
            <p className="text-[11px] text-red-400">⚠️ O próximo contato venceu — marque a nova data pra tirar o lead do atraso.</p>
          )}
          <Input
            label={vencido ? 'Novo próximo contato *' : 'Próximo contato'}
            type="datetime-local"
            value={nextActionAt}
            onChange={(e) => setNextActionAt(e.target.value)}
          />
        </>
      )}
      <Button type="submit" size="sm" className="w-full" loading={mut.isPending}>
        Registrar
      </Button>
    </form>
  )
}
