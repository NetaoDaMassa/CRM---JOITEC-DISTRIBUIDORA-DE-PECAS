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

// Mesmas cores por etapa do Kanban original (odincrm.duckdns.org,
// STAGE_COLORS em types/index.ts) — badge/borda pro nosso tema escuro,
// mais o "dot" sólido igual ao indicador da coluna de lá.
export const STAGE_COLORS: Record<Stage, string> = {
  cadastro: 'text-gray-400 bg-gray-700/30 border-gray-600/50',
  liberacao_financeira: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  pedido: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  cotacao_frete: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
  preparacao: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  frete_finalizado: 'text-sky-400 bg-sky-900/20 border-sky-700/40',
  faturamento: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  conferencia: 'text-indigo-400 bg-indigo-900/20 border-indigo-700/40',
  coleta: 'text-pink-400 bg-pink-900/20 border-pink-700/40',
  rastreio: 'text-slate-400 bg-slate-700/30 border-slate-600/50',
  qualidade: 'text-teal-400 bg-teal-900/20 border-teal-700/40',
  concluido: 'text-green-400 bg-green-900/20 border-green-700/40',
  pos_venda: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/50',
}

export const STAGE_DOT_COLORS: Record<Stage, string> = {
  cadastro: 'bg-gray-500',
  liberacao_financeira: 'bg-yellow-500',
  pedido: 'bg-blue-500',
  cotacao_frete: 'bg-cyan-500',
  preparacao: 'bg-orange-500',
  frete_finalizado: 'bg-sky-600',
  faturamento: 'bg-purple-500',
  conferencia: 'bg-indigo-500',
  coleta: 'bg-pink-500',
  rastreio: 'bg-slate-500',
  qualidade: 'bg-teal-500',
  concluido: 'bg-green-500',
  pos_venda: 'bg-emerald-700',
}

// Prioridade de despacho (etapa "Pedido") — mesma config de cor/prazo do
// KanbanCard.tsx original.
export const PRIORIDADE_CONFIG: Record<string, { barra: string; badge: string; label: string; labelPeca?: string }> = {
  urgente: { barra: 'bg-red-500', badge: 'text-red-400 bg-red-900/30 border-red-700/40', label: '🔴 Urgente · 48h', labelPeca: '🔴 Urgente · 24h' },
  lead: { barra: 'bg-yellow-400', badge: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40', label: '🟡 Lead · 3 dias' },
  normal: { barra: 'bg-green-500', badge: 'text-green-400 bg-green-900/30 border-green-700/40', label: '🟢 Normal · 7 dias', labelPeca: '🟢 Normal · 48h' },
  direto: { barra: 'bg-purple-500', badge: 'text-purple-400 bg-purple-900/30 border-purple-700/40', label: '🟣 Direto · sem processo' },
}
