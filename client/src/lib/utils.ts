import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
}

export function formatPhone(ddd: number, phone: string): string {
  return `(${ddd}) ${phone}`
}

export function whatsappUrl(ddd: number | string, phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '')
  const base = `https://wa.me/55${ddd}${digits}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

export const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  qualificado: 'Qualificado',
  em_negociacao: 'Em Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
  desqualificado: 'Desqualificado',
}

export const STATUS_COLORS: Record<string, string> = {
  novo: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  abordagem: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  qualificado: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  em_negociacao: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  ganho: 'bg-green-500/20 text-green-300 border-green-500/30',
  perdido: 'bg-red-500/20 text-red-300 border-red-500/30',
  desqualificado: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

export const STATUS_ORDER = [
  'novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado',
]

export const TERMINAL_STATUSES = ['ganho', 'perdido', 'desqualificado']

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export const SEGMENT_LABELS: Record<string, string> = {
  assistente_tecnico: 'Assistente Técnico',
  instalador: 'Instalador',
  revendedor_lojista: 'Revendedor/Lojista',
  outros: 'Outros',
}

export function parseLeadText(text: string): Record<string, string> {
  const result: Record<string, string> = {}

  const patterns: [string[], keyof typeof result][] = [
    [['nome', 'name'], 'name'],
    [['telefone', 'fone', 'celular', 'whatsapp', 'tel', 'phone'], 'phone'],
    [['email', 'e-mail'], 'email'],
    [['empresa', 'company', 'razão social', 'razao social', 'cnpj'], 'company'],
    [['cidade', 'city'], 'city'],
    [
      ['observação', 'observacao', 'observações', 'observacoes', 'obs', 'complemento', 'dados complementares', 'mensagem', 'comentário', 'comentario'],
      'observations',
    ],
  ]

  const lines = text.split('\n')
  for (const line of lines) {
    const [rawKey, ...valueParts] = line.split(/[:：]/)
    const key = rawKey?.trim().toLowerCase() ?? ''
    const value = valueParts.join(':').trim()
    if (!key || !value) continue

    for (const [keywords, field] of patterns) {
      if (keywords.some((kw) => key.includes(kw))) {
        result[field] = value
        break
      }
    }
  }

  // Extract DDD from phone (removendo o código do país +55, se vier junto)
  if (result.phone) {
    let digits = result.phone.replace(/\D/g, '')
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2)
    }
    if (digits.length >= 10) {
      result.ddd = digits.slice(0, 2)
      result.phone = digits.slice(2)
    }
  }

  return result
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
