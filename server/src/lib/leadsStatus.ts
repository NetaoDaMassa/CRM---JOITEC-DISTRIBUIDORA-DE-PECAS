// Regras da etapa (status) do funil de Leads — portado de
// /Users/weslley/Documents/odin-tubos-crm--master/server/src/lib/status.ts,
// sem alteração de comportamento.

export const STATUS_VALUES = [
  'novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado', 'consumidor_final',
] as const

export type LeadStatus = (typeof STATUS_VALUES)[number]

export const STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  qualificado: 'Qualificado',
  em_negociacao: 'Em Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
  desqualificado: 'Desqualificado',
  consumidor_final: 'Consumidor Final / Repassado',
}

export const TERMINAL_STATUSES: LeadStatus[] = ['ganho', 'perdido', 'desqualificado', 'consumidor_final']

// Etapa restrita a empresas específicas (por slug) — igual ao sistema de
// origem: só Odin Tubos e Joitec usam "Consumidor Final / Repassado" pra
// separar leads fora do funil normal de revenda.
export const COMPANY_RESTRICTED_STATUSES: Partial<Record<LeadStatus, string[]>> = {
  consumidor_final: ['odin-tubos', 'joitec'],
}

export function isStatusAllowedForCompany(status: LeadStatus, empresaSlug: string): boolean {
  const allowedSlugs = COMPANY_RESTRICTED_STATUSES[status]
  return !allowedSlugs || allowedSlugs.includes(empresaSlug)
}

export function isTerminalStatus(status: string): status is LeadStatus {
  return (TERMINAL_STATUSES as string[]).includes(status)
}

// Um lead fechado (ganho/perdido/desqualificado/consumidor_final) conta no
// mês em que foi fechado, não no mês em que entrou no CRM — senão um lead
// criado em julho e ganho em agosto nunca aparece no filtro "agosto". Leads
// ainda ativos continuam contando pela data de criação.
export function getLeadEffectiveDate(lead: { status: string; createdAt: string; statusChangedAt: string | null }): string {
  if (isTerminalStatus(lead.status) && lead.statusChangedAt) return lead.statusChangedAt
  return lead.createdAt
}

export const SEGMENT_VALUES = ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'] as const
export const CHANNEL_VALUES = ['ligacao', 'whatsapp', 'email'] as const
export const RESULT_VALUES = ['sem_resposta', 'nao_atendeu', 'reagendou', 'recusou', 'avancou'] as const
export const PAYMENT_METHOD_VALUES = ['avista', 'boleto', 'boleto_entrada', 'cartao_credito'] as const
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number]
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  avista: 'À Vista',
  boleto: 'Boleto',
  boleto_entrada: 'Boleto + Entrada',
  cartao_credito: 'Cartão de Crédito',
}

export type StatusFieldKey =
  | 'codSap'
  | 'orderValue'
  | 'finalOrderValue'
  | 'paymentMethod'
  | 'lossReason'
  | 'disqualifyReason'
  | 'finalConsumerReason'

export const STATUS_FIELD_LABELS: Record<StatusFieldKey, string> = {
  codSap: 'Código SAP',
  orderValue: 'Valor do Pedido',
  finalOrderValue: 'Valor Final do Pedido',
  paymentMethod: 'Forma de Pagamento',
  lossReason: 'Motivo da Perda',
  disqualifyReason: 'Motivo da Desqualificação',
  finalConsumerReason: 'Motivo (Consumidor Final / Repassado)',
}

export const REQUIRED_FIELDS_BY_STATUS: Record<LeadStatus, StatusFieldKey[]> = {
  novo: [],
  abordagem: [],
  qualificado: [],
  em_negociacao: ['codSap'],
  ganho: ['finalOrderValue', 'paymentMethod'],
  perdido: ['lossReason'],
  desqualificado: ['disqualifyReason'],
  consumidor_final: ['finalConsumerReason'],
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
