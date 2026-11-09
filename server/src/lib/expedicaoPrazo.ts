import { ehDiaNaoUtil } from './dataBr.js'

// Prazo da Expedição: 48h do picking à coleta contando SÓ dia útil (João,
// 2026-11-09: "conta o final de semana, tem que contar só o dia da semana").
// Sábado, domingo e feriado (os mesmos de dataBr.ts) não andam o relógio;
// dia útil conta as 24h, no horário de Brasília. Ex.: picking sexta 15h →
// prazo terça 15h.
export const PRAZO_HORAS_EXPEDICAO = 48

const HORA = 3600_000
const DIA = 24 * HORA
const BR = 3 * HORA // Brasília = UTC-3

// Data "BR" do instante (meia-noite UTC daquele dia de Brasília), pra usar com ehDiaNaoUtil.
const diaBr = (msUtc: number) => new Date(Math.floor((msUtc - BR) / DIA) * DIA)
// Próxima meia-noite de Brasília depois do instante (em ms UTC).
const proximaMeiaNoiteBr = (msUtc: number) => Math.floor((msUtc - BR) / DIA) * DIA + DIA + BR

// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → ms.
const ms = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`)

// Instante (ms UTC) em que vence o prazo de um pedido que entrou na fila em `inicio`.
export function prazoLimiteExpedicao(inicio: string): number {
  let t = ms(inicio)
  if (Number.isNaN(t)) return NaN
  let resta = PRAZO_HORAS_EXPEDICAO * HORA
  for (let guarda = 0; guarda < 400; guarda++) {
    const fimDoDia = proximaMeiaNoiteBr(t)
    if (ehDiaNaoUtil(diaBr(t))) {
      t = fimDoDia
      continue
    }
    if (t + resta <= fimDoDia) return t + resta
    resta -= fimDoDia - t
    t = fimDoDia
  }
  return t
}

// Horas úteis de `de` até `ate` (negativo se `ate` já passou) — o "faltam Xh"
// / "atrasado Xh" do card não conta o fim de semana.
export function horasUteisEntre(de: number, ate: number): number {
  const sinal = ate >= de ? 1 : -1
  let [a, b] = sinal > 0 ? [de, ate] : [ate, de]
  let total = 0
  for (let guarda = 0; a < b && guarda < 4000; guarda++) {
    const fimDoDia = Math.min(proximaMeiaNoiteBr(a), b)
    if (!ehDiaNaoUtil(diaBr(a))) total += fimDoDia - a
    a = fimDoDia
  }
  return (sinal * total) / HORA
}
