const TZ_OFFSET_MS = 3 * 60 * 60 * 1000 // America/Sao_Paulo (UTC-3, sem horário de verão desde 2019)
const BUSINESS_START_HOUR = 8
const BUSINESS_END_HOUR = 18
const DAY_MS = 24 * 60 * 60 * 1000

// SQLite grava `datetime('now')` como "YYYY-MM-DD HH:MM:SS" (UTC, sem sufixo de fuso).
// Sem o "Z", o Node interpretaria essa string como hora local do processo — normalizamos
// para ISO UTC explícito antes de parsear, senão o resultado sai deslocado pelo fuso local.
export function toUtcISO(raw: string): string {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return raw
  return raw.replace(' ', 'T') + 'Z'
}

function toShiftedMs(iso: string): number {
  return new Date(toUtcISO(iso)).getTime() - TZ_OFFSET_MS
}

export function businessHoursElapsedMs(fromISO: string, toISO: string = new Date().toISOString()): number {
  const from = toShiftedMs(fromISO)
  const to = toShiftedMs(toISO)
  if (from >= to) return 0

  let total = 0
  let dayStart = Math.floor(from / DAY_MS) * DAY_MS

  while (dayStart <= to) {
    const day = new Date(dayStart)
    const weekday = day.getUTCDay()

    if (weekday !== 0 && weekday !== 6) {
      const windowStart = dayStart + BUSINESS_START_HOUR * 60 * 60 * 1000
      const windowEnd = dayStart + BUSINESS_END_HOUR * 60 * 60 * 1000
      const clippedStart = Math.max(windowStart, from)
      const clippedEnd = Math.min(windowEnd, to)
      if (clippedEnd > clippedStart) total += clippedEnd - clippedStart
    }

    dayStart += DAY_MS
  }

  return total
}

export function toLocalDateKey(iso: string): string {
  const shifted = new Date(toShiftedMs(iso))
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
