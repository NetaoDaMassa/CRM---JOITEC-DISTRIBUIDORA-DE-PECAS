import { toUtcISO, toLocalDateKey } from './businessHours.js'

// Todo cálculo de data do negócio usa o fuso America/Sao_Paulo (UTC-3, sem
// horário de verão desde 2019), nunca o fuso do servidor.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000

export function hojeBr(): Date {
  return new Date(Date.now() - TZ_OFFSET_MS)
}

// "Agora" no mesmo formato que o SQLite usa em `default(sql\`(datetime('now'))\`)`
// — "YYYY-MM-DD HH:MM:SS", sem "T"/"Z"/milissegundos. Usar em qualquer coluna
// de data gravada manualmente em código (fora do default do schema): um
// `new Date().toISOString()" solto grava "T"/"Z" no meio da string, e como
// essas colunas são TEXT comparadas lexicograficamente (`between`, `>=`) contra
// strings no formato do SQLite, o "T" (0x54) ordena depois do espaço (0x20) —
// a linha passa a comparar como "maior" que o fim do dia e desaparece de
// qualquer filtro de intervalo de data (relatórios, "vendas hoje" etc.).
export function agoraSqlite(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

// YYYY-MM-DD de hoje no fuso do Brasil — usado pra montar os limites de
// "hoje" (00:00:00 a 23:59:59) em consultas do painel de TV.
export function hojeBrString(): string {
  return hojeBr().toISOString().slice(0, 10)
}

// YYYY-MM-DD da segunda-feira da semana atual (fuso BR) — início do
// intervalo pro ranking semanal do painel de TV/dashboard. Domingo conta
// como fim da semana anterior, não início da atual.
export function inicioSemanaBrString(): string {
  const hoje = hojeBr()
  const diaSemana = hoje.getUTCDay()
  const diasDesdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1
  const inicio = new Date(hoje)
  inicio.setUTCDate(hoje.getUTCDate() - diasDesdeSegunda)
  return inicio.toISOString().slice(0, 10)
}

// Segunda-feira da semana anterior — usada pra comparar "essa semana vs a
// passada" (quem mais evoluiu), não só o total acumulado da semana atual.
export function inicioSemanaPassadaBrString(): string {
  const inicioAtual = new Date(`${inicioSemanaBrString()}T00:00:00Z`)
  inicioAtual.setUTCDate(inicioAtual.getUTCDate() - 7)
  return inicioAtual.toISOString().slice(0, 10)
}

export function mesReferenciaAtual(): string {
  const hoje = hojeBr()
  const ano = hoje.getUTCFullYear()
  const mes = String(hoje.getUTCMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}-01`
}

// Conta dias úteis (seg-sex, sem considerar feriados) num intervalo de datas
// UTC — usado pra calcular a meta acumulada até hoje (meta mensal / dias
// úteis do mês × dias úteis já passados), pra rateio de meta não "resetar"
// todo dia: se o vendedor não bate num dia, a meta acumulada dos dias
// seguintes cresce e carrega o déficit.
function contarDiasUteis(inicio: Date, fim: Date): number {
  let total = 0
  const d = new Date(inicio)
  while (d <= fim) {
    const dia = d.getUTCDay()
    if (dia !== 0 && dia !== 6) total++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return total
}

export function diasUteisNoMes(mesReferencia: string): number {
  const [ano, mes] = mesReferencia.split('-').map(Number)
  const inicio = new Date(Date.UTC(ano, mes - 1, 1))
  const fim = new Date(Date.UTC(ano, mes, 0))
  return contarDiasUteis(inicio, fim)
}

export function diasUteisDecorridos(mesReferencia: string): number {
  const [ano, mes] = mesReferencia.split('-').map(Number)
  const inicio = new Date(Date.UTC(ano, mes - 1, 1))
  const hoje = hojeBr()
  const hojeUtc = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))
  if (hojeUtc < inicio) return 0
  return contarDiasUteis(inicio, hojeUtc)
}

export function diasDesde(dataIso: string | null): number | null {
  if (!dataIso) return null
  const dataKey = toLocalDateKey(toUtcISO(dataIso))
  const hojeKey = toLocalDateKey(new Date().toISOString())
  const data = new Date(`${dataKey}T00:00:00Z`)
  const hoje = new Date(`${hojeKey}T00:00:00Z`)
  return Math.floor((hoje.getTime() - data.getTime()) / (1000 * 60 * 60 * 24))
}
