// Roteiro do dia (vendedores externos da Odin Compressores) — pedido do
// João, 2026-10-22. Tudo aqui é GRÁTIS de propósito (ele escolheu testar sem
// Google): o caminho é calculado no próprio CRM pela distância em linha reta
// entre os pontos, e o endereço vira ponto no mapa pelo OpenStreetMap
// (Nominatim). Se um dia ligarem o Google, troca só `geocodificar` e
// `otimizarOrdem` — o resto não muda.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { roteiros, users, visitas, empresas } from '../db/schema.js'
import { agoraSqlite, ehDiaNaoUtil, hojeBr, hojeBrString } from './dataBr.js'
import { getConfigNumero, getConfigTexto, setConfig } from './configuracoes.js'
import { notificarGestores } from './propostasGates.js'
import { notifications } from '../db/schema.js'

export const SLUG_ROTEIRO = 'odin-compressores'

export type Ponto = { lat: number; lng: number }

export function distanciaM(a: Ponto, b: Ponto): number {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Rua não é linha reta — 1,3 é o fator médio usado pra estimar o km real a
// partir da distância em linha reta em área urbana.
const FATOR_RUA = 1.3
const VELOCIDADE_KMH = 35
const MIN_POR_VISITA = 40
const MIN_POR_PROSPECCAO = 25 // por empresa prevista na área

// Melhor ordem saindo de casa e voltando pra casa: vizinho mais próximo +
// 2-opt (desfaz cruzamentos). Pra 5–15 paradas fica praticamente igual ao
// ótimo. Parada sem localização vai pro fim, na ordem em que estava.
export function otimizarOrdem<T extends { lat: number | null; lng: number | null }>(casa: Ponto | null, paradas: T[]): T[] {
  const comPonto = paradas.filter((p) => p.lat != null && p.lng != null) as (T & Ponto)[]
  const semPonto = paradas.filter((p) => p.lat == null || p.lng == null)
  if (comPonto.length < 2) return [...comPonto, ...semPonto]

  const inicio: Ponto = casa ?? comPonto[0]
  const restantes = [...comPonto]
  const rota: (T & Ponto)[] = []
  let atual = inicio
  while (restantes.length) {
    let melhor = 0
    for (let i = 1; i < restantes.length; i++) if (distanciaM(atual, restantes[i]) < distanciaM(atual, restantes[melhor])) melhor = i
    atual = restantes.splice(melhor, 1)[0]
    rota.push(atual as T & Ponto)
  }

  // 2-opt no circuito casa → rota → casa
  const custo = (r: Ponto[]) => {
    let d = casa ? distanciaM(casa, r[0]) + distanciaM(r[r.length - 1], casa) : 0
    for (let i = 0; i < r.length - 1; i++) d += distanciaM(r[i], r[i + 1])
    return d
  }
  let melhorou = true
  let voltas = 0
  while (melhorou && voltas++ < 50) {
    melhorou = false
    for (let i = 0; i < rota.length - 1; i++) {
      for (let k = i + 1; k < rota.length; k++) {
        const nova = [...rota.slice(0, i), ...rota.slice(i, k + 1).reverse(), ...rota.slice(k + 1)]
        if (custo(nova) + 1 < custo(rota)) {
          rota.splice(0, rota.length, ...nova)
          melhorou = true
        }
      }
    }
  }
  return [...rota, ...semPonto]
}

// Horário previsto de chegada em cada parada + km total (estimativa).
export function estimarRoteiro(
  casa: Ponto | null,
  paradas: { lat: number | null; lng: number | null; tipo: string; quantidadePrevista: number | null }[],
  horaSaida: string,
): { kmTotal: number; chegadas: (string | null)[]; horaVolta: string | null } {
  const [h, m] = horaSaida.split(':').map(Number)
  let minutos = (h || 8) * 60 + (m || 0)
  let metros = 0
  let anterior: Ponto | null = casa
  const chegadas: (string | null)[] = []
  const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`
  for (const p of paradas) {
    if (p.lat == null || p.lng == null) {
      chegadas.push(null)
      continue
    }
    if (anterior) {
      const d = distanciaM(anterior, p as Ponto) * FATOR_RUA
      metros += d
      minutos += (d / 1000 / VELOCIDADE_KMH) * 60
    }
    chegadas.push(hhmm(minutos))
    minutos += p.tipo === 'prospeccao' ? MIN_POR_PROSPECCAO * Math.max(1, p.quantidadePrevista ?? 4) : MIN_POR_VISITA
    anterior = p as Ponto
  }
  let horaVolta: string | null = null
  if (casa && anterior && anterior !== casa) {
    const d = distanciaM(anterior, casa) * FATOR_RUA
    metros += d
    minutos += (d / 1000 / VELOCIDADE_KMH) * 60
    horaVolta = hhmm(minutos)
  }
  return { kmTotal: Math.round(metros / 100) / 10, chegadas, horaVolta }
}

// ── Endereço → ponto no mapa (OpenStreetMap / Nominatim, grátis) ─────────
// Regra de uso do Nominatim: no máximo 1 consulta por segundo e um
// User-Agent identificando o sistema. Fila simples + cache em memória (o
// resultado também fica gravado na parada, então só busca de novo se o
// endereço for outro).
const cacheGeo = new Map<string, { lat: number; lng: number } | null>()
let filaGeo: Promise<unknown> = Promise.resolve()

async function consultarNominatim(q: string): Promise<Ponto | null> {
  const chave = q.toLowerCase().trim()
  if (cacheGeo.has(chave)) return cacheGeo.get(chave) ?? null
  const tarefa = filaGeo.then(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`
      const resp = await fetch(url, { headers: { 'User-Agent': 'JoitecCRM/1.0 (joitec-crm.duckdns.org)', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(8000) })
      if (!resp.ok) return null
      const json = (await resp.json()) as { lat: string; lon: string }[]
      const r = json[0] ? { lat: Number(json[0].lat), lng: Number(json[0].lon) } : null
      cacheGeo.set(chave, r)
      return r
    } catch {
      return null
    } finally {
      await new Promise((ok) => setTimeout(ok, 1100))
    }
  })
  filaGeo = tarefa
  return tarefa
}

export async function geocodificar(endereco: string | null, cidade: string | null): Promise<{ ponto: Ponto; fonte: 'endereco' | 'cidade' } | null> {
  const end = (endereco ?? '').trim()
  const cid = (cidade ?? '').trim()
  if (end) {
    const r = await consultarNominatim(cid && !end.toLowerCase().includes(cid.toLowerCase()) ? `${end}, ${cid}` : end)
    if (r) return { ponto: r, fonte: 'endereco' }
  }
  if (cid) {
    const r = await consultarNominatim(cid)
    if (r) return { ponto: r, fonte: 'cidade' }
  }
  return null
}

// O jeito mais preciso de saber onde fica uma empresa é o GPS de um
// check-in que alguém da equipe já fez lá (≈800 visitas da Odin têm GPS).
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\/?a)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function localizacaoPorVisitas(empresaId: number, nomes: string[]): Promise<Map<string, Ponto & { endereco: string | null }>> {
  const alvo = new Set(nomes.map(normalizarNome).filter(Boolean))
  const res = new Map<string, Ponto & { endereco: string | null }>()
  if (!alvo.size) return res
  const linhas = await db
    .select({ nome: sql<string>`coalesce(nullif(${visitas.nomeEmpresa}, ''), ${visitas.clienteNome})`, lat: visitas.latCheckin, lng: visitas.lngCheckin, endereco: visitas.endereco })
    .from(visitas)
    .where(and(eq(visitas.empresaId, empresaId), sql`${visitas.latCheckin} is not null`))
    .orderBy(sql`${visitas.id} desc`)
  for (const l of linhas) {
    const n = normalizarNome(l.nome ?? '')
    if (alvo.has(n) && !res.has(n) && l.lat != null && l.lng != null) res.set(n, { lat: l.lat, lng: l.lng, endereco: l.endereco })
  }
  return res
}

// ── Configuração (por empresa, tabela `configuracoes`) ───────────────────
export type ConfigRoteiro = {
  travaDesde: string | null // YYYY-MM-DD — trava vale a partir desse dia; null = desligada
  horaLimite: string // até que horas da véspera o roteiro tem que ser enviado
  autoAprovarHora: string | null // roteiro enviado e não analisado vira aprovado nesse horário do dia; null = nunca
  minParadas: number
  // Fase de teste (pedido do João, 2026-10-22): só esses vendedores usam o
  // Roteiro. Lista vazia = ninguém (os outros seguem registrando visita como
  // sempre, sem aba e sem trava).
  participantes: number[]
}

export async function configRoteiro(empresaId: number): Promise<ConfigRoteiro> {
  const [trava, limite, auto, min, part] = await Promise.all([
    getConfigTexto(`roteiro_trava_desde_${empresaId}`),
    getConfigTexto(`roteiro_hora_limite_${empresaId}`),
    getConfigTexto(`roteiro_auto_aprovar_hora_${empresaId}`),
    getConfigNumero(`roteiro_min_paradas_${empresaId}`, 0),
    getConfigTexto(`roteiro_participantes_${empresaId}`),
  ])
  return {
    travaDesde: trava || null,
    horaLimite: limite || '18:00',
    autoAprovarHora: auto === null ? '08:00' : auto || null,
    minParadas: min,
    participantes: (part ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
  }
}

export function participa(conf: ConfigRoteiro, userId: number): boolean {
  return conf.participantes.includes(userId)
}

export function travaAtiva(conf: ConfigRoteiro, data: string): boolean {
  return !!conf.travaDesde && data >= conf.travaDesde
}

// "HH:MM" de agora no Brasil.
export function horaBrAgora(): string {
  return hojeBr().toISOString().slice(11, 16)
}

// Próximo dia útil depois de `data` (sexta → segunda, pula feriado).
export function proximoDiaUtil(data: string): string {
  const d = new Date(`${data}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (ehDiaNaoUtil(d))
  return d.toISOString().slice(0, 10)
}

// Roteiro enviado que o gestor não analisou até o horário configurado do
// próprio dia vira aprovado sozinho — pra vendedor não ficar parado
// esperando (recomendação aceita pelo João). Roda no agendador e também
// antes de cada consulta (não depende do cron ter rodado).
export async function aplicarAprovacaoAutomatica(empresaId: number): Promise<number> {
  const conf = await configRoteiro(empresaId)
  if (!conf.autoAprovarHora) return 0
  const hoje = hojeBrString()
  const agora = horaBrAgora()
  const pendentes = await db.query.roteiros.findMany({ where: and(eq(roteiros.empresaId, empresaId), eq(roteiros.status, 'enviado')) })
  let n = 0
  for (const r of pendentes) {
    // Só vale pra roteiro enviado ANTES do horário (na véspera, ou cedo no
    // dia). Enviado já depois do horário, no próprio dia, espera o gestor —
    // senão a aprovação automática viraria aprovação instantânea.
    const limiteUtc = new Date(Date.parse(`${r.data}T${conf.autoAprovarHora}:00Z`) + 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19)
    if (!r.enviadoEm || r.enviadoEm >= limiteUtc) continue
    if (r.data < hoje || (r.data === hoje && agora >= conf.autoAprovarHora)) {
      await db.update(roteiros).set({ status: 'aprovado', aprovadoEm: agoraSqlite(), aprovacaoAutomatica: true, updatedAt: agoraSqlite() }).where(eq(roteiros.id, r.id))
      await db.insert(notifications).values({ vendedorId: r.vendedorId, title: 'Roteiro liberado', message: `Seu roteiro de ${r.data.split('-').reverse().join('/')} foi aprovado automaticamente (o gestor não analisou até ${conf.autoAprovarHora}).`, type: 'info' })
      n++
    }
  }
  return n
}

// Vendedores que estão no teste do Roteiro (ver `participantes`).
export async function vendedoresExternos(empresaId: number) {
  const { participantes } = await configRoteiro(empresaId)
  if (!participantes.length) return []
  return db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), inArray(users.id, participantes)),
    columns: { id: true, name: true, casaEndereco: true, casaLat: true, casaLng: true },
    orderBy: (u, { asc }) => [asc(u.name)],
  })
}

// Alerta das 18h (horário limite): avisa o gestor de quem ainda não enviou
// o roteiro do próximo dia útil. Uma vez por dia por empresa (marcado em
// `configuracoes`, pra não repetir quando o servidor reinicia num deploy).
export async function alertarRoteirosNaoEnviados(): Promise<void> {
  const hoje = hojeBrString()
  if (ehDiaNaoUtil(new Date(`${hoje}T12:00:00Z`))) return
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_ROTEIRO) })
  if (!empresa) return
  const conf = await configRoteiro(empresa.id)
  const amanha = proximoDiaUtil(hoje)
  if (!travaAtiva(conf, amanha)) return
  if (horaBrAgora() < conf.horaLimite || (await getConfigTexto(`roteiro_alerta_enviado_${empresa.id}`)) === hoje) return
  await setConfig(`roteiro_alerta_enviado_${empresa.id}`, hoje)

  const vendedores = await vendedoresExternos(empresa.id)
  if (!vendedores.length) return
  const enviados = await db.query.roteiros.findMany({
    where: and(eq(roteiros.empresaId, empresa.id), eq(roteiros.data, amanha), inArray(roteiros.status, ['enviado', 'aprovado'])),
    columns: { vendedorId: true },
  })
  const ok = new Set(enviados.map((r) => r.vendedorId))
  const faltando = vendedores.filter((v) => !ok.has(v.id))
  if (!faltando.length) return
  const dataBr = amanha.split('-').reverse().join('/')
  await notificarGestores(empresa.id, `Roteiro de ${dataBr} não enviado`, `${faltando.map((v) => v.name).join(', ')} ainda não enviou o roteiro (prazo ${conf.horaLimite}).`, 'warning')
  for (const v of faltando) {
    await db.insert(notifications).values({ vendedorId: v.id, title: 'Envie seu roteiro', message: `O prazo para enviar o roteiro de ${dataBr} era ${conf.horaLimite}. Sem roteiro aprovado não dá para registrar visitas.`, type: 'warning' })
  }
}

export async function rodarRoteiroAgendado(): Promise<void> {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_ROTEIRO) })
  if (!empresa) return
  const n = await aplicarAprovacaoAutomatica(empresa.id)
  if (n > 0) console.log(`[roteiro] ${n} roteiro(s) aprovado(s) automaticamente`)
  await alertarRoteirosNaoEnviados()
}
