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
  // Pós-venda vem ANTES de Concluído pra máquina (pedido do João,
  // 2026-10-29): envia o PDF de cuidados/preventiva/garantia + pesquisa de
  // satisfação; respondida a pesquisa, o pedido vai sozinho pra Concluído,
  // que encerra o fluxo e abre o Agendamento de peças (lib/posVendaOdin.ts).
  'pos_venda',
  'concluido',
] as const

// Peça também passou a terminar em Concluído (João, 2026-10-29): o antigo
// "Concluído" (previsão de chegada) + "Feedback/Finalizado" viraram uma
// etapa só de Pós-venda, antes do Concluído.
export const STAGE_SEQUENCE_PECA = ['pedido', 'preparacao', 'frete_finalizado', 'faturamento', 'coleta', 'rastreio', 'pos_venda', 'concluido'] as const

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
  pos_venda: 'Pós-venda',
}

// Rótulo da etapa por tipo de pedido — hoje igual pros dois (peça deixou de
// ter o "Feedback/Finalizado"), mantido pra não espalhar STAGE_LABELS.
export function rotuloEtapa(stage: string, orderType: OrderType): string {
  void orderType
  return STAGE_LABELS[stage as Stage] ?? stage
}

// Última etapa de cada fluxo — o pedido "terminou" quando chega nela.
export function etapaFinal(orderType: OrderType): Stage {
  void orderType
  return 'concluido'
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
