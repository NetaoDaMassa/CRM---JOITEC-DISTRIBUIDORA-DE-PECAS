// Constantes de UI do módulo de Leads — cópia client-side dos enums de
// server/src/lib/leadsStatus.ts (mesmo padrão já usado em FunilBoard.tsx:
// mapas de label pequenos ficam duplicados no client, não importados do
// server em runtime — só tipos vêm de @server, ver client/src/lib/trpc.ts).

export const LEAD_STATUS_VALUES = [
  'novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado', 'consumidor_final',
] as const
export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  qualificado: 'Qualificado',
  em_negociacao: 'Em Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
  desqualificado: 'Desqualificado',
  consumidor_final: 'Consumidor Final / Repassado',
}

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  novo: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  abordagem: 'text-gold-400 bg-gold-900/20 border-gold-700/40',
  qualificado: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  em_negociacao: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  ganho: 'text-green-400 bg-green-900/20 border-green-700/40',
  perdido: 'text-red-400 bg-red-900/20 border-red-700/40',
  desqualificado: 'text-dark-400 bg-dark-700/50 border-dark-600',
  consumidor_final: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
}

export const LEAD_TERMINAL_STATUSES: LeadStatus[] = ['ganho', 'perdido', 'desqualificado', 'consumidor_final']
export function isLeadTerminalStatus(status: string): boolean {
  return (LEAD_TERMINAL_STATUSES as string[]).includes(status)
}

// Igual a COMPANY_RESTRICTED_STATUSES no server — só Odin Tubos e Joitec têm
// a etapa "Consumidor Final / Repassado".
export function isLeadStatusAllowedForEmpresa(status: LeadStatus, empresaSlug: string | undefined): boolean {
  if (status !== 'consumidor_final') return true
  return empresaSlug === 'odin-tubos' || empresaSlug === 'joitec'
}

export const LEAD_SEGMENT_VALUES = ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'] as const
export const LEAD_SEGMENT_LABELS: Record<string, string> = {
  assistente_tecnico: 'Assistente Técnico',
  instalador: 'Instalador',
  revendedor_lojista: 'Revendedor/Lojista',
  outros: 'Outros',
}

export const LEAD_CHANNEL_VALUES = ['ligacao', 'whatsapp', 'email'] as const
export const LEAD_CHANNEL_LABELS: Record<string, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail' }

export const LEAD_RESULT_VALUES = ['sem_resposta', 'nao_atendeu', 'reagendou', 'recusou', 'avancou'] as const
export const LEAD_RESULT_LABELS: Record<string, string> = {
  sem_resposta: 'Sem resposta',
  nao_atendeu: 'Não atendeu',
  reagendou: 'Reagendou',
  recusou: 'Recusou',
  avancou: 'Avançou',
}

export const LEAD_PAYMENT_METHOD_VALUES = ['avista', 'boleto', 'boleto_entrada', 'cartao_credito'] as const
export const LEAD_PAYMENT_METHOD_LABELS: Record<string, string> = {
  avista: 'À Vista',
  boleto: 'Boleto',
  boleto_entrada: 'Boleto + Entrada',
  cartao_credito: 'Cartão de Crédito',
}

export type LeadStatusFieldKey =
  | 'codSap' | 'orderValue' | 'finalOrderValue' | 'paymentMethod' | 'lossReason' | 'disqualifyReason' | 'finalConsumerReason'

export const LEAD_REQUIRED_FIELDS_BY_STATUS: Record<LeadStatus, LeadStatusFieldKey[]> = {
  novo: [],
  abordagem: [],
  qualificado: [],
  em_negociacao: ['codSap', 'orderValue'],
  ganho: ['finalOrderValue', 'paymentMethod'],
  perdido: ['lossReason'],
  desqualificado: ['disqualifyReason'],
  consumidor_final: ['finalConsumerReason'],
}

export function leadNegotiationTagLabel(tag: string | null): string | null {
  if (tag === 'vermelho') return '🔴 Risco'
  if (tag === 'amarelo') return '🟡 Atenção'
  return null
}
