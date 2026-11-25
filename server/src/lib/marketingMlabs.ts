// Marketing: números de todas as redes (Facebook, TikTok, YouTube, LinkedIn,
// Pinterest, Google, Threads e também Instagram) vindos da mLabs — João,
// 2026-11-23. A mLabs não tem API pública, então quem lê é um robô do Claude
// (conector da mLabs) 1x por dia, que manda o pacote para
// POST /api/marketing/mlabs com o cabeçalho x-chave = MKT_MLABS_CHAVE.
// O super admin também pode colar o pacote em Marketing → Conexões.
import crypto from 'crypto'
import { z } from 'zod'
import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { mktAnalises, mktRedesPosts, mktRedesResumo } from '../db/schema.js'
import { marca } from './marketingIa.js'

const TZ = 'America/Sao_Paulo'
export const REDES = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'google', 'threads', 'outro'] as const

const num = z.number().nullable().optional()
const int = z.number().nullable().optional().transform((v) => (v == null || !Number.isFinite(v) ? null : Math.round(v)))
const rede = z.string().transform((r) => (REDES as readonly string[]).includes(r) ? r : 'outro')

export const PacoteMlabs = z.object({
  empresaId: z.number().int().refine((n) => !!marca(n), 'Empresa inválida'),
  periodo: z.object({ inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  coletadoEm: z.string().optional(),
  redes: z.array(z.object({
    rede, nome: z.string().nullable().optional(), seguidores: int, ganhoPeriodo: int, crescimentoPct: num,
    posts: int, reels: int, viewsMediaReel: num, engajamentoPct: num,
  })).max(30),
  posts: z.array(z.object({
    id: z.string().min(1).max(200), rede, data: z.string().min(10), tipo: z.string().nullable().optional(),
    texto: z.string().nullable().optional(), link: z.string().nullable().optional(),
    views: int, alcance: int, curtidas: int, comentarios: int, compartilhamentos: int, salvos: int,
  })).max(3000),
  melhoresHorarios: z.array(z.object({ rede, dia: z.string(), horarios: z.array(z.string()).max(24) })).max(100).optional(),
})
export type PacoteMlabs = z.infer<typeof PacoteMlabs>

function diaBR(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: TZ })
}

export async function importarMlabs(bruto: unknown) {
  const p = PacoteMlabs.parse(bruto)
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  for (const r of p.redes) {
    const v = {
      nome: r.nome ?? null, seguidores: r.seguidores, ganhoPeriodo: r.ganhoPeriodo, crescimentoPct: r.crescimentoPct ?? null,
      posts: r.posts, reels: r.reels, viewsMediaReel: r.viewsMediaReel ?? null, engajamentoPct: r.engajamentoPct ?? null,
      periodoInicio: p.periodo.inicio, periodoFim: p.periodo.fim,
    }
    await db.insert(mktRedesResumo).values({ empresaId: p.empresaId, rede: r.rede, data: hoje, ...v })
      .onConflictDoUpdate({ target: [mktRedesResumo.empresaId, mktRedesResumo.rede, mktRedesResumo.data], set: v })
  }
  for (const x of p.posts) {
    const v = {
      empresaId: p.empresaId, rede: x.rede, publicadoEm: x.data, data: diaBR(x.data), tipo: x.tipo ?? null,
      texto: (x.texto ?? '').replace(/\s+/g, ' ').slice(0, 300), link: x.link ?? null,
      views: x.views, alcance: x.alcance, curtidas: x.curtidas, comentarios: x.comentarios, compartilhamentos: x.compartilhamentos, salvos: x.salvos,
      updatedAt: sql`(datetime('now'))`,
    }
    // id da mLabs pode repetir entre redes — prefixa com a rede.
    const id = `${x.rede}:${x.id}`.slice(0, 240)
    // O mesmo post pode chegar com outro id (robô x importação manual):
    // reconhece pelo link ou pela data/hora de publicação na mesma rede.
    await db.delete(mktRedesPosts).where(and(eq(mktRedesPosts.empresaId, p.empresaId), eq(mktRedesPosts.rede, x.rede), ne(mktRedesPosts.id, id),
      x.link ? or(eq(mktRedesPosts.link, x.link), eq(mktRedesPosts.publicadoEm, x.data)) : eq(mktRedesPosts.publicadoEm, x.data)))
    await db.insert(mktRedesPosts).values({ id, ...v }).onConflictDoUpdate({ target: mktRedesPosts.id, set: v })
  }
  if (p.melhoresHorarios?.length) {
    const chave = `mlabs-horarios-${p.empresaId}`
    const v = { empresaId: p.empresaId, tipo: 'mlabs_horarios', texto: '', dados: JSON.stringify(p.melhoresHorarios), createdAt: sql`(datetime('now'))` }
    await db.insert(mktAnalises).values({ chave, ...v }).onConflictDoUpdate({ target: mktAnalises.chave, set: v })
  }
  const ultimo = { em: new Date().toISOString(), redes: p.redes.length, posts: p.posts.length }
  await db.insert(mktAnalises).values({ chave: `mlabs-ultimo-${p.empresaId}`, empresaId: p.empresaId, tipo: 'mlabs_ultimo', texto: '', dados: JSON.stringify(ultimo) })
    .onConflictDoUpdate({ target: mktAnalises.chave, set: { dados: JSON.stringify(ultimo), createdAt: sql`(datetime('now'))` } })
  return { empresaId: p.empresaId, ...ultimo }
}

// Para a aba Empresa: último resumo por rede + posts do período + melhores horários.
export async function redesDaEmpresa(empresaId: number, dias = 30) {
  const de = new Date(Date.now() - dias * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
  const resumos = await db.select().from(mktRedesResumo).where(eq(mktRedesResumo.empresaId, empresaId)).orderBy(desc(mktRedesResumo.data))
  const porRede: Record<string, typeof resumos[number]> = {}
  for (const r of resumos) porRede[r.rede] ||= r
  const posts = await db.select().from(mktRedesPosts).where(and(eq(mktRedesPosts.empresaId, empresaId), gte(mktRedesPosts.data, de))).orderBy(desc(mktRedesPosts.data))
  const extra = await db.select().from(mktAnalises).where(eq(mktAnalises.empresaId, empresaId))
  const ler = (chave: string) => { try { return JSON.parse(extra.find((a) => a.chave === chave)?.dados || 'null') } catch { return null } }
  return {
    redes: Object.values(porRede),
    historico: resumos.filter((r) => r.seguidores != null).map((r) => ({ rede: r.rede, data: r.data, seguidores: r.seguidores })),
    posts,
    melhoresHorarios: (ler(`mlabs-horarios-${empresaId}`) || []) as { rede: string; dia: string; horarios: string[] }[],
    ultimo: ler(`mlabs-ultimo-${empresaId}`) as { em: string; redes: number; posts: number } | null,
    // Seguidores digitados pela equipe (YouTube, Google, Pinterest…): só valem quando a mLabs não manda o número.
    manual: (ler(`seg-manual-${empresaId}`) || {}) as Record<string, { seguidores: number; em: string; por: string }>,
  }
}

// João, 2026-11-25: a mLabs não entrega seguidores de algumas redes; a equipe digita.
export async function salvarSeguidoresManual(empresaId: number, rede: string, seguidores: number | null, por: string) {
  const chave = `seg-manual-${empresaId}`
  const atual = await db.select().from(mktAnalises).where(eq(mktAnalises.chave, chave))
  let mapa: Record<string, unknown> = {}
  try { mapa = JSON.parse(atual[0]?.dados || '{}') || {} } catch { mapa = {} }
  if (seguidores == null) delete mapa[rede]
  else mapa[rede] = { seguidores, em: new Date().toISOString(), por }
  const dados = JSON.stringify(mapa)
  await db.insert(mktAnalises).values({ chave, empresaId, tipo: 'seg_manual', texto: '', dados })
    .onConflictDoUpdate({ target: mktAnalises.chave, set: { dados, createdAt: sql`(datetime('now'))` } })
  return mapa
}

export function chaveMlabsValida(recebida: string | undefined) {
  const certa = process.env.MKT_MLABS_CHAVE || ''
  if (!certa || !recebida) return false
  const a = Buffer.from(certa), b = Buffer.from(recebida)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
