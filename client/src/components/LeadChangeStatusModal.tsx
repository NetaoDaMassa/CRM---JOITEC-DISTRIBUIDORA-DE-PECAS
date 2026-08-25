import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import {
  LEAD_STATUS_VALUES,
  LEAD_STATUS_LABELS,
  LEAD_REQUIRED_FIELDS_BY_STATUS,
  LEAD_PAYMENT_METHOD_VALUES,
  LEAD_PAYMENT_METHOD_LABELS,
  isLeadTerminalStatus,
  isLeadStatusAllowedForEmpresa,
  type LeadStatus,
} from '../lib/leadsShared'

// Muda a etapa do lead — pede só os campos obrigatórios daquela etapa
// (server valida de novo via superRefine, isso aqui é só UX pra não deixar
// o vendedor descobrir o campo faltando só depois de tentar salvar).
export default function LeadChangeStatusModal({
  leadId,
  currentStatus,
  empresaSlug,
  open,
  onClose,
}: {
  leadId: number
  currentStatus: string
  empresaSlug: string | undefined
  open: boolean
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState<LeadStatus>(currentStatus as LeadStatus)
  const [nextContactAt, setNextContactAt] = useState('')
  const [codSap, setCodSap] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [finalOrderValue, setFinalOrderValue] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [disqualifyReason, setDisqualifyReason] = useState('')
  const [finalConsumerReason, setFinalConsumerReason] = useState('')

  const mut = trpc.leads.changeStatus.useMutation({
    onSuccess() {
      toast.success('Etapa atualizada')
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
      utils.leads.todayQueue.invalidate()
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const required = new Set(LEAD_REQUIRED_FIELDS_BY_STATUS[status])
  const terminal = isLeadTerminalStatus(status)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    mut.mutate({
      id: leadId,
      status,
      nextContactAt: terminal ? undefined : nextContactAt || undefined,
      codSap: required.has('codSap') ? codSap : undefined,
      orderValue: required.has('orderValue') ? Number(orderValue) : undefined,
      finalOrderValue: required.has('finalOrderValue') ? Number(finalOrderValue) : undefined,
      paymentMethod: required.has('paymentMethod') ? (paymentMethod as any) : undefined,
      lossReason: required.has('lossReason') ? lossReason : undefined,
      disqualifyReason: required.has('disqualifyReason') ? disqualifyReason : undefined,
      finalConsumerReason: required.has('finalConsumerReason') ? finalConsumerReason : undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Mudar etapa" size="md">
      <form onSubmit={submit} className="space-y-4">
        <Select
          label="Nova etapa"
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          options={LEAD_STATUS_VALUES.filter((s) => isLeadStatusAllowedForEmpresa(s, empresaSlug)).map((s) => ({
            value: s,
            label: LEAD_STATUS_LABELS[s],
          }))}
        />

        {!terminal && (
          <Input
            label="Próximo contato *"
            type="datetime-local"
            value={nextContactAt}
            onChange={(e) => setNextContactAt(e.target.value)}
          />
        )}

        {required.has('codSap') && (
          <Input label="Código SAP *" value={codSap} onChange={(e) => setCodSap(e.target.value)} />
        )}
        {required.has('orderValue') && (
          <Input label="Valor do pedido *" type="number" step="0.01" value={orderValue} onChange={(e) => setOrderValue(e.target.value)} />
        )}
        {required.has('finalOrderValue') && (
          <Input
            label="Valor final do pedido *"
            type="number"
            step="0.01"
            value={finalOrderValue}
            onChange={(e) => setFinalOrderValue(e.target.value)}
          />
        )}
        {required.has('paymentMethod') && (
          <Select
            label="Forma de pagamento *"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="Selecione..."
            options={LEAD_PAYMENT_METHOD_VALUES.map((p) => ({ value: p, label: LEAD_PAYMENT_METHOD_LABELS[p] }))}
          />
        )}
        {required.has('lossReason') && (
          <Textarea label="Motivo da perda *" value={lossReason} onChange={(e) => setLossReason(e.target.value)} rows={2} />
        )}
        {required.has('disqualifyReason') && (
          <Textarea
            label="Motivo da desqualificação *"
            value={disqualifyReason}
            onChange={(e) => setDisqualifyReason(e.target.value)}
            rows={2}
          />
        )}
        {required.has('finalConsumerReason') && (
          <Textarea
            label="Motivo (Consumidor Final / Repassado) *"
            value={finalConsumerReason}
            onChange={(e) => setFinalConsumerReason(e.target.value)}
            rows={2}
          />
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={mut.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  )
}
