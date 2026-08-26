// Constantes de UI do módulo de Ordens — cópia client-side dos enums de
// server/src/lib/ordensStages.ts (mesmo padrão de client/src/lib/leadsShared.ts:
// mapas pequenos ficam duplicados no client, não importados do server em
// runtime).

export const ORDER_TYPE_VALUES = ['maquina', 'peca'] as const
export type OrderType = (typeof ORDER_TYPE_VALUES)[number]

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  maquina: 'Máquina',
  peca: 'Peça',
}

export const STAGE_SEQUENCE_MAQUINA = [
  'cadastro',
  'liberacao_financeira',
  'pedido',
  'cotacao_frete',
  'frete_finalizado',
  'faturamento',
  'conferencia',
  'coleta',
  'rastreio',
  'qualidade',
  'concluido',
  'pos_venda',
] as const

export const STAGE_SEQUENCE_PECA = ['pedido', 'preparacao', 'frete_finalizado', 'faturamento', 'coleta', 'rastreio', 'concluido', 'pos_venda'] as const

export type Stage = (typeof STAGE_SEQUENCE_MAQUINA)[number] | (typeof STAGE_SEQUENCE_PECA)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  cadastro: 'Cadastro',
  liberacao_financeira: 'Liberação Financeira',
  pedido: 'Pedido',
  cotacao_frete: 'Cotação de Frete',
  preparacao: 'Preparação',
  frete_finalizado: 'Frete Finalizado',
  faturamento: 'Faturamento',
  conferencia: 'Conferência',
  coleta: 'Coleta',
  rastreio: 'Rastreio',
  qualidade: 'Qualidade',
  concluido: 'Concluído',
  pos_venda: 'Feedback/Finalizado',
}

export function getStageSequence(orderType: OrderType): readonly Stage[] {
  return orderType === 'maquina' ? STAGE_SEQUENCE_MAQUINA : STAGE_SEQUENCE_PECA
}

export const STAGE_COLORS: Record<Stage, string> = {
  cadastro: 'text-dark-400 bg-dark-700/50 border-dark-600',
  liberacao_financeira: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  pedido: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  cotacao_frete: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  preparacao: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  frete_finalizado: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
  faturamento: 'text-gold-400 bg-gold-900/20 border-gold-700/40',
  conferencia: 'text-teal-400 bg-teal-900/20 border-teal-700/40',
  coleta: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  rastreio: 'text-indigo-400 bg-indigo-900/20 border-indigo-700/40',
  qualidade: 'text-pink-400 bg-pink-900/20 border-pink-700/40',
  concluido: 'text-green-400 bg-green-900/20 border-green-700/40',
  pos_venda: 'text-green-500 bg-green-900/30 border-green-700/50',
}
