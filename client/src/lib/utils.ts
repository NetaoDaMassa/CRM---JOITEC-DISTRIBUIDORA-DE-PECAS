import { format, formatDistanceToNow, intervalToDuration } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// O SQLite grava os timestamps padrão (`datetime('now')`) como "YYYY-MM-DD HH:MM:SS"
// (UTC, sem sufixo de fuso). Sem o "Z", o navegador interpreta a string como hora local
// do computador do usuário, deslocando a exibição pelo fuso local. Normalizamos para ISO
// UTC explícito antes de parsear — mesma correção já aplicada no backend (businessHours.ts).
function toUtcDate(date: string | Date): Date {
  if (date instanceof Date) return date
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(date)) return new Date(date)
  return new Date(date.replace(' ', 'T') + 'Z')
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(toUtcDate(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(toUtcDate(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return formatDistanceToNow(toUtcDate(date), { addSuffix: true, locale: ptBR })
}

// Usado no painel de TV (bloco 10) pro "tempo de venda ao vivo".
export function formatElapsed(from: string | Date, to?: string | Date | null): string {
  const start = toUtcDate(from)
  const end = to ? toUtcDate(to) : new Date()
  const duration = intervalToDuration({ start, end })
  const parts: string[] = []
  if (duration.days) parts.push(`${duration.days}d`)
  if (duration.hours) parts.push(`${duration.hours}h`)
  if (!duration.days && duration.minutes) parts.push(`${duration.minutes}min`)
  return parts.length ? parts.join(' ') : 'menos de 1min'
}

// YYYY-MM-DD de hoje no fuso do Brasil — usado como valor padrão de filtros
// de data (input type="date" espera exatamente esse formato).
export function hojeBrString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function primeiroDiaMesString(): string {
  return hojeBrString().slice(0, 8) + '01'
}

export function downloadBase64Excel(base64: string, filename: string) {
  const byteCharacters = atob(base64)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
