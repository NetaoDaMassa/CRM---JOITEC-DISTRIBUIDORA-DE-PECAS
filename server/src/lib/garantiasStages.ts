// Sequência de etapas do módulo de Garantias (Odin Compressores) — mesmo
// espírito de ordensStages.ts: a sequência muda conforme o processo tem ou
// não retorno do item danificado pra Odin. "NF de devolução" e
// "Recebimento na Odin"/"Oficina" só existem quando `comRetorno` é true —
// sem retorno, o processo termina assim que o envio é confirmado.

export const TIPO_ATENDIMENTO_VALUES = ['maquina_completa', 'peca_com_retorno', 'peca_sem_retorno', 'peca_tecnico'] as const
export type TipoAtendimento = (typeof TIPO_ATENDIMENTO_VALUES)[number]

// "NF de Saída", "Envio" e "Rastreamento" viraram 1 etapa só ("Saída") —
// pedido do João, 2026-10-05: eram 3 colunas no Kanban pra uma coisa só na
// prática. Os campos de cada uma continuam existindo à parte no banco
// (nfSaidaNumero/envioTransportadora/rastreioObservacao etc.), só a TELA e
// a etapa do processo que juntaram — ver EtapaCampos em GarantiasDetail.tsx.
// "Análise" é a etapa de triagem, ANTES de tudo — nasce aí todo processo
// novo (leve: só cliente/produto/observações), sem escolher tipo de
// atendimento ainda. Só sai dali de dois jeitos: "Abrir processo de
// garantia" (escolhe tipo de atendimento, decide comRetorno, avança pra
// 'aberto') ou "Finalizar sem necessidade de garantia" (pula direto pra
// 'encerrado'). Por isso tipoAtendimento/comRetorno nascem nulos (ver
// schema.ts) — só a ação de abrir processo de verdade os preenche. Pedido
// do João, 2026-10-06.
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

// `comRetorno` ainda null (processo em 'analise', antes de decidir) — as
// duas sequências começam igual ('analise' → 'aberto'), então tanto faz
// qual retorna; só importa de verdade depois que comRetorno é definido.
export function getStageSequence(comRetorno: boolean | null): readonly Stage[] {
  return comRetorno ? STAGE_SEQUENCE_COM_RETORNO : STAGE_SEQUENCE_SEM_RETORNO
}

export function isStageValido(stage: string, comRetorno: boolean | null): stage is Stage {
  return (getStageSequence(comRetorno) as readonly string[]).includes(stage)
}

export function getNextStage(stage: string, comRetorno: boolean | null): Stage | null {
  const seq = getStageSequence(comRetorno)
  const idx = seq.indexOf(stage as Stage)
  if (idx === -1 || idx === seq.length - 1) return null
  return seq[idx + 1]
}
