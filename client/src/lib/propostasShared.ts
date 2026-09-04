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

// Dot sólido da coluna — mesmas cores do STAGE_COLUMNS do odincrm original
// (Propostas.tsx: bg-blue-500/bg-yellow-500/bg-green-500/bg-red-500/bg-orange-500).
export const PROPOSTA_STAGE_DOT_COLORS: Record<PropostaStage, string> = {
  proposta: 'bg-blue-500',
  negociacao: 'bg-yellow-500',
  fechado: 'bg-green-500',
  perdido: 'bg-red-500',
  chamar_depois: 'bg-orange-500',
  convertido: 'bg-cyan-500',
}

// Caminho normal (botão "avançar") — perdido/chamar_depois/convertido só
// por ação explícita, não por avanço linear.
export const PROPOSTA_STAGE_NEXT: Partial<Record<PropostaStage, PropostaStage>> = {
  proposta: 'negociacao',
  negociacao: 'fechado',
}

// Botão "Voltar" — só aparece pro gestor (admin), pra corrigir um card que
// avançou/foi marcado errado sem precisar abrir o histórico. De perdido e
// chamar_depois, volta pra "Proposta" (reativa o negócio).
export const PROPOSTA_STAGE_PREV: Partial<Record<PropostaStage, PropostaStage>> = {
  negociacao: 'proposta',
  fechado: 'negociacao',
  perdido: 'proposta',
  chamar_depois: 'proposta',
}

export function isOverdue(dateStr: string): boolean {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
