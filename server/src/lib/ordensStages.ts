// Regras de etapa do módulo de Ordens (pós-venda Odin Compressores) —
// portado do comportamento real do odincrm.duckdns.org (FastAPI,
// app/services/order_service.py). Duas sequências diferentes conforme
// `orderType`: "máquina" passa por liberação financeira/cotação de
// frete/conferência, "peça" é um fluxo mais enxuto que nem passa por
// cadastro/liberação financeira.

export const ORDER_TYPE_VALUES = ['maquina', 'peca'] as const
export type OrderType = (typeof ORDER_TYPE_VALUES)[number]

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

export function isStageValidForOrderType(stage: string, orderType: OrderType): stage is Stage {
  return (getStageSequence(orderType) as readonly string[]).includes(stage)
}

export function getNextStage(stage: string, orderType: OrderType): Stage | null {
  const seq = getStageSequence(orderType)
  const idx = seq.indexOf(stage as Stage)
  if (idx === -1 || idx === seq.length - 1) return null
  return seq[idx + 1]
}

// "preparação" não é uma etapa visível no Kanban pra pedido "máquina" (é
// pré-requisito da transição cotação_frete → frete_finalizado, checado em
// checkPreparacaoAprovada em ordensGates.ts) — a aba de Preparação/Máquinas
// fica sempre acessível no detalhe do pedido nesse caso, não presa a uma
// coluna do board.
export function isPreparacaoStageVisivel(orderType: OrderType): boolean {
  return orderType === 'peca'
}

// Etapas de confirmação que ficam "pra trás" quando um gestor pula pra uma
// etapa anterior via mover() — usado por resetConfirmacoes em
// ordensGates.ts pra saber quais tabelas re-zerar quando o índice da etapa
// alvo é menor que o atual.
export const CONFIRMATION_RESET_ORDER: Stage[] = ['frete_finalizado', 'faturamento', 'conferencia', 'coleta']
