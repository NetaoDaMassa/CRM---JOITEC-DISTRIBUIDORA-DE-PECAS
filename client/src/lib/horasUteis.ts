// Tempo de resposta de lead em HORÁRIO DE TRABALHO (pedido do João,
// 2026-11-11): seg-sex, 08:00-12:00 e 13:00-17:48, sem feriado. Usa a MESMA
// função do servidor (relatórios, alertas de SLA, Painel de TV), pra tela e
// relatório nunca contarem diferente.
import { businessHoursElapsedMs, toUtcISO } from '@server/lib/businessHours'

function paraIso(d: string | Date): string {
  return typeof d === 'string' ? toUtcISO(d) : d.toISOString()
}

export function msUteisEntre(de: string | Date, ate?: string | Date | null): number {
  return businessHoursElapsedMs(paraIso(de), ate ? paraIso(ate) : new Date().toISOString())
}

// "2h 15min", "45min", "0min" — só conta horário de trabalho.
export function formatarTempoUtil(de: string | Date, ate?: string | Date | null): string {
  const min = Math.floor(msUteisEntre(de, ate) / 60000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  return m ? `${h}h ${m}min` : `${h}h`
}
