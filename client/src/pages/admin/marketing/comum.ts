// Utilitários do Módulo Marketing (datas, semanas, cores de pilar).
export const TZ = 'America/Sao_Paulo'
export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// Etapas do quadro (João, 2026-11-23). Produção = gravação + edição.
export const STATUS = ['Ideia', 'Roteiro', 'Aprovação do roteiro', 'Produção', 'Aprovação final', 'Agendado na mLabs'] as const
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
// Tempo desde uma data do banco (UTC): "3d", "5h", "agora".
export function tempoDesde(s?: string | null, ate?: string | null) {
  if (!s) return ''
  const t = (x: string) => new Date(x.includes('T') ? x : x.replace(' ', 'T') + 'Z').getTime()
  const ms = (ate ? t(ate) : Date.now()) - t(s)
  const h = Math.floor(ms / 3600000)
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60000))}min`
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24 && d < 3 ? ` ${h % 24}h` : ''}`
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

// ---- Parte 2 (quadro, pedidos, aprovação) ----
export const STATUS_DEMANDA = ['Novo', 'Aprovado', 'Produção', 'Entregue', 'Recusado'] as const
const FINAL = ['Agendado na mLabs']
export function atrasada(p: { data: string | null; status: string }) {
  return !!p.data && p.data < hojeBR() && !FINAL.includes(p.status)
}
// Dias sem ninguém mexer (só conta peça que ainda não foi agendada).
export function diasParada(p: { updatedAt?: string; status: string }) {
  if (!p.updatedAt || FINAL.includes(p.status)) return 0
  const d = new Date(p.updatedAt.replace(' ', 'T') + 'Z').getTime()
  return Math.floor((Date.now() - d) / 86400000)
}
export function iniciais(nome?: string | null) {
  return (nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('')
}
export function nomeCurtoMarca(nome: string) {
  return nome.replace('Odin Automação Pneumática', 'Odin Automação').replace('Odin Tubos e Conexões', 'Odin Tubos').replace('Joitec Distribuidora', 'Joitec')
}

// ---- Parte 3 (anexos, revisores, base de conhecimento) ----
export type Anexo = { arquivoId: number; nome: string; path: string; tipo: string; tamanho: number; em: string; por: string }

// Sobe o arquivo cru (mesma rota de Arquivos/Mídia); quem grava na pasta é o tRPC.
export async function subirArquivo(file: File): Promise<{ path: string; nome: string; tipo: string; tamanho: number }> {
  const token = localStorage.getItem('odin_token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/upload/marketing-arquivo', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar o arquivo')
  return { path: data.path, nome: data.nome, tipo: data.tipo || file.type, tamanho: data.tamanho || file.size }
}

// Lê o texto do arquivo no navegador para a IA: PDF (pdfjs), texto puro.
export async function extrairTexto(file: File): Promise<string | null> {
  const nome = file.name.toLowerCase()
  if (file.type.startsWith('text/') || /\.(txt|md|csv|json)$/.test(nome)) return (await file.text()).slice(0, 200000)
  if (file.type === 'application/pdf' || nome.endsWith('.pdf')) {
    const [pdfjsLib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs?url')])
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    const partes: string[] = []
    for (let i = 1; i <= Math.min(pdf.numPages, 150); i++) {
      const pg = await pdf.getPage(i)
      const c = await pg.getTextContent()
      partes.push(c.items.map((it: any) => ('str' in it ? it.str : '') + (it.hasEOL ? '\n' : ' ')).join(''))
    }
    return partes.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200000)
  }
  return null
}

export function tamanhoArq(b: number) {
  return b > 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
}

// Cor de cada revisor (pela ordem da lista em Conexões).
export const CORES_REVISOR = [
  { fundo: 'rgba(234,179,8,.22)', texto: '#fde047', nome: 'amarelo' },
  { fundo: 'rgba(236,72,153,.22)', texto: '#f9a8d4', nome: 'rosa' },
  { fundo: 'rgba(6,182,212,.22)', texto: '#67e8f9', nome: 'azul' },
  { fundo: 'rgba(34,197,94,.22)', texto: '#86efac', nome: 'verde' },
  { fundo: 'rgba(168,85,247,.22)', texto: '#d8b4fe', nome: 'roxo' },
]

// "Quem escreveu cada palavra": compara versão a versão (LCS por palavra) e
// marca o que cada revisor acrescentou. Texto do autor original fica sem cor.
export type Trecho = { t: string; autor: string | null }
function tokens(s: string) {
  return s.split(/(\s+)/).filter((x) => x !== '')
}
function lcsMap(a: string[], b: string[]): (number | null)[] {
  const n = a.length, m = b.length
  if (n * m > 9_000_000) return b.map(() => null)
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const map: (number | null)[] = b.map(() => null)
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { map[j] = i; i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return map
}
export function autoria(versoes: { roteiro: string; autorNome: string; revisor: boolean }[], atual: string): Trecho[] {
  if (!versoes.length) return [{ t: atual, autor: null }]
  let toks = tokens(versoes[0].roteiro)
  let dono: (string | null)[] = toks.map(() => null)
  const passos = [...versoes.slice(1), ...(versoes[versoes.length - 1].roteiro !== atual ? [{ roteiro: atual, autorNome: '', revisor: false }] : [])]
  for (const v of passos) {
    const novo = tokens(v.roteiro)
    const map = lcsMap(toks, novo)
    dono = novo.map((tk, j) => (map[j] !== null ? dono[map[j]!] : /^\s+$/.test(tk) ? null : v.revisor ? v.autorNome : null))
    toks = novo
  }
  const out: Trecho[] = []
  toks.forEach((t, i) => {
    const a = /^\s+$/.test(t) && out.length ? out[out.length - 1].autor : dono[i]
    if (out.length && out[out.length - 1].autor === a) out[out.length - 1].t += t
    else out.push({ t, autor: a })
  })
  return out
}
