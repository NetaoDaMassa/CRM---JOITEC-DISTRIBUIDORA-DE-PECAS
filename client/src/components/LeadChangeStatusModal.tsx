import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import { dispararConfete } from './ui/Visual'
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
  initialStatus,
  empresaSlug,
  open,
  onClose,
  codSapAtual,
  propostaId,
  repasseVendedorIdAtual,
}: {
  leadId: number
  currentStatus: string
  // Etapa pré-selecionada ao abrir (ex: clicou direto num pill da lista de
  // etapas na Ficha do Lead) — sem isso, abre sempre na etapa atual.
  initialStatus?: string
  empresaSlug: string | undefined
  open: boolean
  onClose: () => void
  // Pré-preenche o Código SAP (ex: lead que volta pra Em Negociação já tinha).
  codSapAtual?: string | null
  // Lead da Odin Compressores já transferido pra Propostas — a proposta
  // acompanha a mudança de etapa (ver sincronizarPropostaDoLead no server).
  propostaId?: number | null
  repasseVendedorIdAtual?: number | null
}) {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState<LeadStatus>((initialStatus ?? currentStatus) as LeadStatus)

  useEffect(() => {
    if (open) setStatus((initialStatus ?? currentStatus) as LeadStatus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStatus, currentStatus])
  const [nextContactAt, setNextContactAt] = useState('')
  const [codSap, setCodSap] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [finalOrderValue, setFinalOrderValue] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [disqualifyReason, setDisqualifyReason] = useState('')
  const [finalConsumerReason, setFinalConsumerReason] = useState('')
  const [repasseVendedorId, setRepasseVendedorId] = useState('')

  useEffect(() => {
    if (!open) return
    setCodSap(codSapAtual ?? '')
    setRepasseVendedorId(repasseVendedorIdAtual ? String(repasseVendedorIdAtual) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Repasse Comercial: lista os vendedores externos (equipe "visitas" da
  // Odin Compressores — Usuários → Equipe). Se ninguém estiver marcado como
  // externo, mostra todo mundo pra não travar.
  const { data: usuarios } = trpc.users.vendors.useQuery(undefined, { enabled: open && empresaSlug === 'odin-compressores' })
  const externos = (usuarios ?? []).filter((u) => u.canalVenda === 'visitas')
  const opcoesRepasse = (externos.length ? externos : usuarios ?? []).map((u) => ({ value: String(u.id), label: u.name }))

  const mut = trpc.leads.changeStatus.useMutation({
    onSuccess(_r, vars) {
      if (vars.status === 'ganho') dispararConfete()
      toast.success('Etapa atualizada')
      utils.leads.get.invalidate({ id: leadId })
      utils.leads.list.invalidate()
      utils.leads.todayQueue.invalidate()
      utils.propostas.listar.invalidate()
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
      repasseVendedorId: status === 'repasse_comercial' && repasseVendedorId ? Number(repasseVendedorId) : undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Mudar etapa" size="md">
      <form onSubmit={submit} className="space-y-4">
        <Select
          label="Nova etapa"
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          options={LEAD_STATUS_VALUES.filter(
            (s) => s !== 'novo_consumidor_final' && isLeadStatusAllowedForEmpresa(s, empresaSlug) && !(propostaId && s === 'ganho'),
          ).map((s) => ({
            value: s,
            label: LEAD_STATUS_LABELS[s],
          }))}
        />

        {status === 'repasse_comercial' && (
          <div>
            <Select
              label="Vendedor externo que vai visitar *"
              value={repasseVendedorId}
              onChange={(e) => setRepasseVendedorId(e.target.value)}
              placeholder="Selecione..."
              options={opcoesRepasse}
            />
            <p className="text-xs text-dark-500 mt-1">O lead continua seu; fica registrado pra qual externo foi (visita + comissão dividida).</p>
          </div>
        )}

        {!terminal && (
          <div>
            <Input
              label="Próximo contato *"
              type="datetime-local"
              value={nextContactAt}
              onChange={(e) => setNextContactAt(e.target.value)}
            />
            <AtalhosProximoContato onEscolher={setNextContactAt} />
          </div>
        )}

        {propostaId && status !== currentStatus && (
          <p className="text-xs rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-dark-300">
            {status === 'em_negociacao'
              ? `A Proposta #${propostaId} volta pra Negociação.`
              : status === 'perdido' || status === 'desqualificado'
                ? `A Proposta #${propostaId} vai junto pra Perdida, com o mesmo motivo.`
                : `A Proposta #${propostaId} sai da negociação ativa e vai pra "Chamar depois", com retorno na data do próximo contato.`}
          </p>
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

// Atalhos pro próximo contato — cada cliente pede um ritmo (5 dias, 1 mês, 2
// meses...). Marca às 9h e pula sábado/domingo pra segunda (o servidor não
// aceita fim de semana). Pedido do João, 2026-11-11.
const ATALHOS: { rotulo: string; dias?: number; meses?: number }[] = [
  { rotulo: '+5 dias', dias: 5 },
  { rotulo: '+15 dias', dias: 15 },
  { rotulo: '+1 mês', meses: 1 },
  { rotulo: '+2 meses', meses: 2 },
  { rotulo: '+3 meses', meses: 3 },
]
function AtalhosProximoContato({ onEscolher }: { onEscolher: (v: string) => void }) {
  function escolher(a: (typeof ATALHOS)[number]) {
    const d = new Date()
    if (a.dias) d.setDate(d.getDate() + a.dias)
    if (a.meses) d.setMonth(d.getMonth() + a.meses)
    if (d.getDay() === 6) d.setDate(d.getDate() + 2)
    if (d.getDay() === 0) d.setDate(d.getDate() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    onEscolher(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`)
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {ATALHOS.map((a) => (
        <button
          key={a.rotulo}
          type="button"
          onClick={() => escolher(a)}
          className="text-[11px] px-2 py-0.5 rounded-full border border-dark-600 text-dark-300 hover:text-dark-100 hover:bg-dark-700"
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  )
}
