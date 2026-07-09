export const STATUS_VALUES = [
  'novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado',
] as const

export type LeadStatus = (typeof STATUS_VALUES)[number]

export const STATUS_ORDER: LeadStatus[] = [...STATUS_VALUES]

export const STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  qualificado: 'Qualificado',
  em_negociacao: 'Em Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
  desqualificado: 'Desqualificado',
}

export const TERMINAL_STATUSES: LeadStatus[] = ['ganho', 'perdido', 'desqualificado']

export function isTerminalStatus(status: string): status is LeadStatus {
  return (TERMINAL_STATUSES as string[]).includes(status)
}

export const PAYMENT_METHOD_VALUES = ['avista', 'boleto', 'boleto_entrada'] as const

export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  avista: 'À Vista',
  boleto: 'Boleto',
  boleto_entrada: 'Boleto + Entrada',
}

export type StatusFieldKey =
  | 'codSap'
  | 'orderValue'
  | 'finalOrderValue'
  | 'paymentMethod'
  | 'lossReason'
  | 'disqualifyReason'

export const REQUIRED_FIELDS_BY_STATUS: Record<LeadStatus, StatusFieldKey[]> = {
  novo: [],
  abordagem: [],
  qualificado: [],
  em_negociacao: ['codSap', 'orderValue'],
  ganho: ['finalOrderValue', 'paymentMethod'],
  perdido: ['lossReason'],
  desqualificado: ['disqualifyReason'],
}

export function getMissingRequiredFields(
  toStatus: LeadStatus,
  payload: Partial<Record<StatusFieldKey, unknown>>
): StatusFieldKey[] {
  return REQUIRED_FIELDS_BY_STATUS[toStatus].filter((key) => {
    const value = payload[key]
    return value === undefined || value === null || value === ''
  })
}
