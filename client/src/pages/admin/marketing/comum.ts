// Utilitários do Módulo Marketing (datas, semanas, cores de pilar).
export const TZ = 'America/Sao_Paulo'
export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const STATUS = ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Aprovação', 'Agendado na mLabs', 'Publicado'] as const
export const CANAIS_V = ['Reels Instagram', 'Reels Facebook', 'TikTok', 'YouTube Shorts']
export const CANAIS_P = ['Instagram', 'Facebook', 'Pinterest']
export const CANAIS = [...CANAIS_V, ...CANAIS_P, 'LinkedIn', 'Google Meu Negócio']
export const MODELO_V = 'GANCHO (0–3 s)\nFala: \nNa tela: \n\nDESENVOLVIMENTO\n1. Fala:  | Cena: \n2. Fala:  | Cena: \n3. Fala:  | Cena: \n\nTEXTO NA TELA\n- \n\nCTA FINAL\n\n\nDURAÇÃO ALVO: 30 s\nÁUDIO SUGERIDO: '
export const MODELO_P = 'TEXTO DA ARTE / LÂMINAS\n1. \n2. \n3. \n\nOBSERVAÇÕES DE DESIGN\n'

export const COR_PILAR: Record<string, string> = {
  azul: '#3b82f6', laranja: '#f97316', verde: '#22c55e', roxo: '#a855f7', amarelo: '#eab308', rosa: '#ec4899', ciano: '#06b6d4', cinza: '#94a3b8',
}
export const CORES = Object.keys(COR_PILAR)
export function corPilar(cor?: string | null) {
  return COR_PILAR[cor || ''] || COR_PILAR.cinza
}

export function hojeBR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}
export function mesAtual() {
  return hojeBR().slice(0, 7)
}
export function mesSomar(mes: string, d: number) {
  const [y, m] = mes.split('-').map(Number)
  const dt = new Date(y, m - 1 + d, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
export function mesLongo(mes: string) {
  const [y, m] = mes.split('-')
  return `${MESES_LONGO[Number(m) - 1]} de ${y}`
}
export function fimMes(mes: string) {
  const [y, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}
export type Semana = { n: number; ini: number; fim: number }
// Semanas de segunda a domingo, cortadas no mês.
export function semanasDoMes(mes: string): Semana[] {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const out: Semana[] = []
  let d = 1
  while (d <= ultimo) {
    const dow = new Date(y, m - 1, d).getDay()
    const fim = Math.min(ultimo, d + ((7 - dow) % 7))
    out.push({ n: out.length + 1, ini: d, fim })
    d = fim + 1
  }
  return out
}
export function faixaSemana(mes: string, w: Semana): [string, string] {
  return [`${mes}-${String(w.ini).padStart(2, '0')}`, `${mes}-${String(w.fim).padStart(2, '0')}`]
}
export function diasUteis(mes: string, w: Semana) {
  const [y, m] = mes.split('-').map(Number)
  let n = 0
  for (let d = w.ini; d <= w.fim; d++) {
    const dw = new Date(y, m - 1, d).getDay()
    if (dw !== 0 && dw !== 6) n++
  }
  return n
}
export function metaSemana(mes: string, w: Semana, meta: { videos: number; posts: number }) {
  const du = diasUteis(mes, w)
  const f = Math.min(1, du / 5)
  return { v: Math.ceil(meta.videos * f), p: Math.ceil(meta.posts * f), du }
}
export function estadoSemana(mes: string, w: Semana): 'passada' | 'atual' | 'futura' {
  const [a, b] = faixaSemana(mes, w)
  const h = hojeBR()
  if (h > b) return 'passada'
  if (h < a) return 'futura'
  return 'atual'
}
export function diaLabel(iso?: string | null) {
  if (!iso) return 'sem data'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${DIAS[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}
export function dataHora(s?: string | null) {
  if (!s) return ''
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  return d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
export function fmtN(n?: number | null) {
  return (Number(n) || 0).toLocaleString('pt-BR')
}
export function pct(x: number) {
  return `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
export function rotHash(p: { roteiro?: string | null; gancho?: string | null; titulo?: string | null }) {
  const s = `${p.roteiro || ''}|${p.gancho || ''}|${p.titulo || ''}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}
export function precisaAnalise(p: { roteiro: string; gancho: string; titulo: string; analise: any }) {
  return (p.roteiro || '').trim().length > 20 && (!p.analise || p.analise.hash !== rotHash(p))
}
export function emRevisao(p: { status: string }) {
  return ['Ideia', 'Roteiro'].includes(p.status || 'Ideia')
}

export const cls = {
  card: 'bg-dark-800 border border-dark-700 rounded-xl',
  input: 'bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 focus:outline-none focus:border-gold-500 w-full',
  rotulo: 'text-[11px] font-semibold uppercase tracking-wider text-dark-400',
  titulo: 'text-lg font-bold text-dark-100',
}
