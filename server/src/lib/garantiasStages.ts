// Sequência de etapas do módulo de Garantias (Odin Compressores) — mesmo
// espírito de ordensStages.ts: a sequência muda conforme o processo tem ou
// não retorno do item danificado pra Odin. "NF de devolução" e
// "Recebimento na Odin"/"Oficina" só existem quando `comRetorno` é true —
// sem retorno, o processo termina assim que o envio é confirmado.

export const TIPO_ATENDIMENTO_VALUES = ['maquina_completa', 'peca_com_retorno', 'peca_sem_retorno', 'peca_tecnico'] as const
export type TipoAtendimento = (typeof TIPO_ATENDIMENTO_VALUES)[number]

export const STAGE_SEQUENCE_COM_RETORNO = [
  'aberto',
  'nf_devolucao',
  'preparacao_novo_item',
  'nf_saida',
  'envio',
  'rastreamento',
  'retorno_item_danificado',
  'recebido_odin',
  'oficina',
  'encerrado',
] as const

export const STAGE_SEQUENCE_SEM_RETORNO = ['aberto', 'preparacao_novo_item', 'nf_saida', 'envio', 'rastreamento', 'encerrado'] as const

export type Stage = (typeof STAGE_SEQUENCE_COM_RETORNO)[number] | (typeof STAGE_SEQUENCE_SEM_RETORNO)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  aberto: 'Abertura',
  nf_devolucao: 'NF de Devolução',
  preparacao_novo_item: 'Preparação do Novo Item',
  nf_saida: 'NF de Saída',
  envio: 'Envio',
  rastreamento: 'Rastreamento',
  retorno_item_danificado: 'Retorno do Item Danificado',
  recebido_odin: 'Recebimento na Odin',
  oficina: 'Oficina',
  encerrado: 'Encerrado',
}

// "Máquina completa" e "peça com retorno" sempre têm retorno; "peça sem
// retorno" nunca tem; "peça ao técnico" é escolha de quem abre o processo
// (pode terminar dos dois jeitos, conforme a peça avaliada tiver ou não
// conserto).
export function comRetornoPadrao(tipo: TipoAtendimento): boolean | null {
  if (tipo === 'maquina_completa' || tipo === 'peca_com_retorno') return true
  if (tipo === 'peca_sem_retorno') return false
  return null // peca_tecnico — exige escolha explícita
}

export function destinoEnvioPadrao(tipo: TipoAtendimento): 'cliente' | 'tecnico' {
  return tipo === 'peca_tecnico' ? 'tecnico' : 'cliente'
}

export function getStageSequence(comRetorno: boolean): readonly Stage[] {
  return comRetorno ? STAGE_SEQUENCE_COM_RETORNO : STAGE_SEQUENCE_SEM_RETORNO
}

export function isStageValido(stage: string, comRetorno: boolean): stage is Stage {
  return (getStageSequence(comRetorno) as readonly string[]).includes(stage)
}

export function getNextStage(stage: string, comRetorno: boolean): Stage | null {
  const seq = getStageSequence(comRetorno)
  const idx = seq.indexOf(stage as Stage)
  if (idx === -1 || idx === seq.length - 1) return null
  return seq[idx + 1]
}
