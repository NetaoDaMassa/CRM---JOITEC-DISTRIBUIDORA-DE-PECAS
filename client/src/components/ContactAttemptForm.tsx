import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from './ui/Button'
import { Input } from './ui/Input'
import Select from './ui/Select'
import { isTerminalStatus } from '../lib/utils'
import { CHANNEL_OPTIONS, RESULT_OPTIONS } from '../lib/contactAttempts'

interface ContactAttemptFormProps {
  leadId: number
  lead: any
}

export default function ContactAttemptForm({ leadId, lead }: ContactAttemptFormProps) {
  const utils = trpc.useUtils()
  const [channel, setChannel] = useState('')
  const [result, setResult] = useState('')
  const [nextActionAt, setNextActionAt] = useState('')

  const mut = trpc.leads.addContactAttempt.useMutation({
    onSuccess() {
      toast.success('Tentativa registrada')
      utils.leads.get.invalidate({ id: leadId })
      setChannel('')
      setResult('')
      setNextActionAt('')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const nextActionRequired = !isTerminalStatus(lead.status) && !lead.nextContactAt

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-gold-400 font-semibold">Registrar Tentativa de Contato</h2>
        <span className="text-xs text-dark-400">{lead.attemptCount ?? 0}/3 tentativas</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Canal"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          options={CHANNEL_OPTIONS}
          placeholder="Selecione..."
        />
        <Select
          label="Resultado"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          options={RESULT_OPTIONS}
          placeholder="Selecione..."
        />
      </div>
      <Input
        label={`Próxima ação${nextActionRequired ? '' : ' (opcional)'}`}
        type="datetime-local"
        value={nextActionAt}
        onChange={(e) => setNextActionAt(e.target.value)}
      />
      <Button
        size="sm"
        loading={mut.isPending}
        disabled={!channel || !result || (nextActionRequired && !nextActionAt)}
        onClick={() =>
          mut.mutate({
            leadId,
            channel: channel as any,
            result: result as any,
            nextActionAt: nextActionAt || null,
          })
        }
      >
        Salvar Tentativa
      </Button>
    </div>
  )
}
