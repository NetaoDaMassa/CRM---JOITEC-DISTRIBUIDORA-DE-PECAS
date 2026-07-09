import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'
import Select from './ui/Select'
import { STATUS_LABELS, isTerminalStatus } from '../lib/utils'
import {
  STATUS_REQUIRED_FIELDS,
  getMissingRequiredFields,
  type StatusFieldKey,
} from '../lib/statusFields'

interface ChangeStatusModalProps {
  open: boolean
  onClose: () => void
  lead: any
  targetStatus: string
}

type FieldValues = Partial<Record<StatusFieldKey, string>>

export default function ChangeStatusModal({ open, onClose, lead, targetStatus }: ChangeStatusModalProps) {
  const utils = trpc.useUtils()
  const [values, setValues] = useState<FieldValues>({})
  const [nextContactAt, setNextContactAt] = useState('')

  const terminal = isTerminalStatus(targetStatus)
  const fields = STATUS_REQUIRED_FIELDS[targetStatus] ?? []

  useEffect(() => {
    if (!open) return
    setValues({})
    const currentNextContact = lead?.nextContactAt
    const isFuture = currentNextContact && new Date(currentNextContact).getTime() > Date.now()
    setNextContactAt(isFuture ? new Date(currentNextContact).toISOString().slice(0, 16) : '')
  }, [open, lead])

  const changeStatusMut = trpc.leads.changeStatus.useMutation({
    onSuccess() {
      toast.success('Status atualizado')
      utils.leads.get.invalidate({ id: lead.id })
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const missing = getMissingRequiredFields(targetStatus, values)
  const missingNextContact = !terminal && !nextContactAt
  const attemptsMissing = targetStatus === 'desqualificado' && (lead?.attemptCount ?? 0) < 3
  const canConfirm = missing.length === 0 && !missingNextContact && !attemptsMissing

  function handleConfirm() {
    changeStatusMut.mutate({
      id: lead.id,
      status: targetStatus as any,
      nextContactAt: terminal ? null : nextContactAt || null,
      codSap: values.codSap,
      orderValue: values.orderValue ? Number(values.orderValue) : undefined,
      finalOrderValue: values.finalOrderValue ? Number(values.finalOrderValue) : undefined,
      paymentMethod: values.paymentMethod as any,
      lossReason: values.lossReason,
      disqualifyReason: values.disqualifyReason,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Mudar etapa para "${STATUS_LABELS[targetStatus]}"`} size="sm">
      <div className="space-y-4">
        {fields.map((field) => {
          const value = values[field.key] ?? ''
          const onChange = (v: string) => setValues((prev) => ({ ...prev, [field.key]: v }))

          if (field.kind === 'select') {
            return (
              <Select
                key={field.key}
                label={field.label}
                options={field.options ?? []}
                placeholder="Selecione..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
              />
            )
          }
          if (field.kind === 'textarea') {
            return (
              <Textarea
                key={field.key}
                label={field.label}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={3}
              />
            )
          }
          return (
            <Input
              key={field.key}
              label={field.label}
              type={field.kind === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )
        })}

        {!terminal && (
          <Input
            label="Próximo contato"
            type="datetime-local"
            value={nextContactAt}
            onChange={(e) => setNextContactAt(e.target.value)}
          />
        )}

        {(missing.length > 0 || missingNextContact) && (
          <p className="text-xs text-red-400">
            Preencha todos os campos obrigatórios para confirmar a mudança de etapa.
          </p>
        )}

        {attemptsMissing && (
          <p className="text-xs text-red-400">
            Faltam {3 - (lead?.attemptCount ?? 0)} tentativa(s) de contato para desqualificar este lead (mínimo 3, em datas diferentes).
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={!canConfirm}
            loading={changeStatusMut.isPending}
            onClick={handleConfirm}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
