// Constantes de UI do funil de Propostas — cópia client-side de
// server/src/lib/propostasGates.ts, mesmo padrão de ordensShared.ts.

export const PROPOSTA_STAGE_VALUES = ['proposta', 'negociacao', 'fechado', 'perdido', 'chamar_depois', 'convertido'] as const
export type PropostaStage = (typeof PROPOSTA_STAGE_VALUES)[number]

// Colunas visíveis no board — "convertido" não aparece como coluna (é
// estado terminal, a proposta já virou um Pedido), mesmo comportamento do
// odincrm original.
export const PROPOSTA_BOARD_COLUMNS: PropostaStage[] = ['proposta', 'negociacao', 'fechado', 'perdido', 'chamar_depois']

export const PROPOSTA_STAGE_LABELS: Record<PropostaStage, string> = {
  proposta: 'Proposta',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  perdido: 'Perdidos',
  chamar_depois: 'Chamar Depois',
  convertido: 'Convertido',
}

export const PROPOSTA_STAGE_COLORS: Record<PropostaStage, string> = {
  proposta: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  negociacao: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  fechado: 'text-green-400 bg-green-900/20 border-green-700/40',
  perdido: 'text-red-400 bg-red-900/20 border-red-700/40',
  chamar_depois: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  convertido: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
}

// Caminho normal (botão "avançar") — perdido/chamar_depois/convertido só
// por ação explícita, não por avanço linear.
export const PROPOSTA_STAGE_NEXT: Partial<Record<PropostaStage, PropostaStage>> = {
  proposta: 'negociacao',
  negociacao: 'fechado',
}

export function isOverdue(dateStr: string): boolean {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
