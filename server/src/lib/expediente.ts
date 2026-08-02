import { getConfigNumero } from './configuracoes.js'
import { hojeBr } from './dataBr.js'

export interface Expediente {
  inicioHora: number
  inicioMinuto: number
  fimHora: number
  fimMinuto: number
  almocoInicioHora: number
  almocoInicioMinuto: number
  almocoFimHora: number
  almocoFimMinuto: number
}

export async function buscarExpediente(): Promise<Expediente> {
  return {
    inicioHora: await getConfigNumero('expediente_inicio_hora', 8),
    inicioMinuto: await getConfigNumero('expediente_inicio_minuto', 0),
    fimHora: await getConfigNumero('expediente_fim_hora', 17),
    fimMinuto: await getConfigNumero('expediente_fim_minuto', 48),
    almocoInicioHora: await getConfigNumero('expediente_almoco_inicio_hora', 12),
    almocoInicioMinuto: await getConfigNumero('expediente_almoco_inicio_minuto', 0),
    almocoFimHora: await getConfigNumero('expediente_almoco_fim_hora', 13),
    almocoFimMinuto: await getConfigNumero('expediente_almoco_fim_minuto', 0),
  }
}

// Seg-sex, fora do horário de almoço, entre início e fim do expediente —
// usa o horário de Brasília (mesma convenção do resto do app), não o fuso
// do servidor.
export async function dentroDoExpediente(agora: Date = hojeBr()): Promise<boolean> {
  const exp = await buscarExpediente()
  const diaSemana = agora.getUTCDay()
  if (diaSemana === 0 || diaSemana === 6) return false

  const minutosAgora = agora.getUTCHours() * 60 + agora.getUTCMinutes()
  const minutosInicio = exp.inicioHora * 60 + exp.inicioMinuto
  const minutosFim = exp.fimHora * 60 + exp.fimMinuto
  const minutosAlmocoInicio = exp.almocoInicioHora * 60 + exp.almocoInicioMinuto
  const minutosAlmocoFim = exp.almocoFimHora * 60 + exp.almocoFimMinuto

  if (minutosAgora < minutosInicio || minutosAgora >= minutosFim) return false
  if (minutosAgora >= minutosAlmocoInicio && minutosAgora < minutosAlmocoFim) return false
  return true
}

// Já passou do fim do expediente hoje? (usado pra gatilhos de "fim do dia",
// como o resumo diário — não depende de estar dentro do horário de almoço).
export async function passouDoFimDoExpediente(agora: Date = hojeBr()): Promise<boolean> {
  const exp = await buscarExpediente()
  const minutosAgora = agora.getUTCHours() * 60 + agora.getUTCMinutes()
  const minutosFim = exp.fimHora * 60 + exp.fimMinuto
  return minutosAgora >= minutosFim
}
