// Constantes de UI do módulo de Garantias — cópia client-side dos enums de
// server/src/lib/garantiasStages.ts (mesmo padrão de ordensShared.ts).

export const TIPO_ATENDIMENTO_VALUES = ['maquina_completa', 'peca_com_retorno', 'peca_sem_retorno', 'peca_tecnico'] as const
export type TipoAtendimento = (typeof TIPO_ATENDIMENTO_VALUES)[number]

export const TIPO_ATENDIMENTO_LABELS: Record<TipoAtendimento, string> = {
  maquina_completa: 'Substituição de máquina completa',
  peca_com_retorno: 'Substituição de peça — com retorno do componente',
  peca_sem_retorno: 'Substituição de peça — sem retorno (descarte no local)',
  peca_tecnico: 'Substituição de peça enviada ao técnico autorizado',
}

// "NF de Saída", "Envio" e "Rastreamento" viraram 1 etapa só ("Saída") —
// pedido do João, 2026-10-05: eram 3 colunas no Kanban pra uma coisa só na
// prática. Os campos de cada uma continuam existindo à parte no banco, só
// a TELA e a etapa do processo que juntaram — ver EtapaCampos em
// GarantiasDetail.tsx.
// "Análise" é a etapa de triagem, ANTES de tudo — pedido do João,
// 2026-10-06. Ver comentário equivalente em server/garantiasStages.ts.
export const STAGE_SEQUENCE_COM_RETORNO = [
  'analise',
  'aberto',
  'nf_devolucao',
  'preparacao_novo_item',
  'saida',
  'retorno_item_danificado',
  'recebido_odin',
  'oficina',
  'encerrado',
] as const

export const STAGE_SEQUENCE_SEM_RETORNO = ['analise', 'aberto', 'preparacao_novo_item', 'saida', 'encerrado'] as const

export type Stage = (typeof STAGE_SEQUENCE_COM_RETORNO)[number] | (typeof STAGE_SEQUENCE_SEM_RETORNO)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  analise: 'Análise',
  aberto: 'Abertura',
  nf_devolucao: 'NF de Devolução',
  preparacao_novo_item: 'Preparação do Novo Item',
  saida: 'Saída',
  retorno_item_danificado: 'Retorno do Item Danificado',
  recebido_odin: 'Recebimento na Odin',
  oficina: 'Oficina',
  encerrado: 'Encerrado',
}

export const STAGE_COLORS: Record<Stage, string> = {
  analise: 'text-indigo-400 bg-indigo-900/20 border-indigo-700/40',
  aberto: 'text-gray-400 bg-gray-700/30 border-gray-600/50',
  nf_devolucao: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  preparacao_novo_item: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  saida: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  retorno_item_danificado: 'text-pink-400 bg-pink-900/20 border-pink-700/40',
  recebido_odin: 'text-purple-400 bg-purple-900/20 border-purple-700/40',
  oficina: 'text-teal-400 bg-teal-900/20 border-teal-700/40',
  encerrado: 'text-green-400 bg-green-900/20 border-green-700/40',
}

export function getStageSequence(comRetorno: boolean | null): readonly Stage[] {
  return comRetorno ? STAGE_SEQUENCE_COM_RETORNO : STAGE_SEQUENCE_SEM_RETORNO
}

export const DESTINACAO_LABELS: Record<string, string> = {
  reparo: 'Reparo',
  descarte: 'Descarte',
  retorno_estoque: 'Retorno ao estoque',
  sem_conserto: 'Sem possibilidade de conserto',
}
