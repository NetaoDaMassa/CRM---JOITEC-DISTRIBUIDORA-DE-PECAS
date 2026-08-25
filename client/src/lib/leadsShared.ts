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

// Cor de fundo do card no Kanban quando o lead tem uma tag de negociação —
// prioridade mais alta que "atrasado"/"anexo pendente" na borda do card.
export const LEAD_NEGOTIATION_TAG_CARD_CLASSES: Record<string, string> = {
  vermelho: 'border-red-500/60',
  amarelo: 'border-yellow-500/60',
}

// Urgência do próximo contato — mesma lógica visual do sistema de origem
// (KanbanBoard.tsx: getContactUrgency), reaproveitada no Kanban, na Lista e
// na Ficha do Lead. `null` pra etapa terminal (não faz sentido cobrar
// próximo contato de um lead já fechado).
export function getLeadContactUrgency(nextContactAt: string, status: string) {
  if (isLeadTerminalStatus(status)) return null
  const d = new Date(nextContactAt)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDias = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDias < 0) {
    return { label: 'ATRASADO', classes: 'bg-red-500/15 text-red-400 border border-red-500/30', dot: 'bg-red-500', atrasado: true }
  }
  if (diffDias === 0) {
    return { label: 'HOJE', classes: 'bg-orange-500/15 text-orange-400 border border-orange-500/30', dot: 'bg-orange-500', atrasado: false }
  }
  if (diffDias === 1) {
    return { label: 'AMANHÃ', classes: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30', dot: 'bg-yellow-500', atrasado: false }
  }
  return { label: null, classes: 'bg-gold-500/10 text-gold-500 border border-gold-500/20', dot: 'bg-gold-500', atrasado: false }
}

// `leads.phone` foi salvo de forma inconsistente por vários pontos de
// entrada ao longo do tempo (formulário público do site, "colar contato" e
// digitação manual): parte dos leads guarda só o número local (DDD fica
// isolado na coluna `ddd`), parte já veio com o DDD embutido no próprio
// `phone`. Essas duas funções juntam ddd+phone sem duplicar o DDD quando ele
// já está lá — usadas tanto pra exibir o telefone quanto pra montar o link
// do WhatsApp/discador, que precisam do número completo.
export function leadTelefoneCompleto(ddd: number, phone: string): string {
  const digitosPhone = phone.replace(/\D/g, '')
  const dddStr = String(ddd)
  if (digitosPhone.length >= 10 && digitosPhone.startsWith(dddStr)) return digitosPhone
  return `${dddStr}${digitosPhone}`
}

export function leadTelefoneFormatado(ddd: number, phone: string): string {
  const completo = leadTelefoneCompleto(ddd, phone)
  const local = completo.slice(String(ddd).length)
  if (local.length === 9) return `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
  if (local.length === 8) return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`
  return `(${ddd}) ${phone}`
}

export const LEAD_CLOSING_LABELS: Record<string, string> = {
  ganho: 'Ganho em',
  perdido: 'Perdido em',
  desqualificado: 'Desqualificado em',
  consumidor_final: 'Repassado em',
}
