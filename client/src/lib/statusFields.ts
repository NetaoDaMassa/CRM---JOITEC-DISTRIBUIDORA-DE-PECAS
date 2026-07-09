export type StatusFieldKey =
  | 'codSap'
  | 'orderValue'
  | 'finalOrderValue'
  | 'paymentMethod'
  | 'lossReason'
  | 'disqualifyReason'

export interface StatusFieldSpec {
  key: StatusFieldKey
  label: string
  kind: 'text' | 'number' | 'select' | 'textarea'
  options?: { value: string; label: string }[]
}

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'avista', label: 'À Vista' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'boleto_entrada', label: 'Boleto + Entrada' },
]

export const STATUS_REQUIRED_FIELDS: Record<string, StatusFieldSpec[]> = {
  novo: [],
  abordagem: [],
  qualificado: [],
  em_negociacao: [
    { key: 'codSap', label: 'Código SAP', kind: 'text' },
    { key: 'orderValue', label: 'Valor do Pedido', kind: 'number' },
  ],
  ganho: [
    { key: 'finalOrderValue', label: 'Valor Final do Pedido', kind: 'number' },
    { key: 'paymentMethod', label: 'Forma de Pagamento', kind: 'select', options: PAYMENT_METHOD_OPTIONS },
  ],
  perdido: [
    { key: 'lossReason', label: 'Motivo da Perda', kind: 'textarea' },
  ],
  desqualificado: [
    { key: 'disqualifyReason', label: 'Motivo da Desqualificação', kind: 'textarea' },
  ],
}

export function getMissingRequiredFields(
  toStatus: string,
  values: Partial<Record<StatusFieldKey, unknown>>
): StatusFieldKey[] {
  const fields = STATUS_REQUIRED_FIELDS[toStatus] ?? []
  return fields
    .filter((f) => {
      const value = values[f.key]
      return value === undefined || value === null || value === ''
    })
    .map((f) => f.key)
}
