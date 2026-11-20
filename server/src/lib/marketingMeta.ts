// Instagram das marcas direto da Meta (Graph API) para o Módulo Marketing.
// Pedido do João, 2026-11-20: a mLabs só funciona dentro do claude.ai, então
// o CRM lê o Instagram por conta própria — posts, views, alcance, TEXTO dos
// comentários, directs (conversas) e concorrentes (Business Discovery).
//
// Credencial: UM token de Usuário do Sistema do Gerenciador de Negócios da
// Meta (configuracoes.mkt_meta_token), com acesso às Páginas/Instagrams das
// marcas. A partir dele pegamos o token de cada Página (/me/accounts), que é
// o que lê as conversas. Permissões necessárias no token:
//   instagram_basic, instagram_manage_insights, instagram_manage_comments,
//   instagram_manage_messages, pages_show_list, pages_read_engagement,
//   pages_manage_metadata, business_management
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { mktIgContas, mktIgMidias, mktIgComentarios, mktIgConversas, mktIgSeguidores, mktConcorrentesFotos, mktPerfis } from '../db/schema.js'
import { getConfigTexto, setConfig } from './configuracoes.js'

const VERSAO = process.env.META_GRAPH_VERSION || 'v23.0'
const BASE = `https://graph.facebook.com/${VERSAO}`
const CHAVE_TOKEN = 'mkt_meta_token'

export async function tokenSistema(): Promise<string | null> {
  const t = await getConfigTexto(CHAVE_TOKEN)
  return t && t.trim() ? t.trim() : null
}
export async function salvarTokenSistema(token: string) {
  await setConfig(CHAVE_TOKEN, token.trim())
}

type GraphErro = { message?: string; code?: number; error_subcode?: number; type?: string }
export class MetaErro extends Error {
  code?: number
  constructor(e: GraphErro) {
    super(traduzirErro(e))
    this.code = e.code
  }
}
function traduzirErro(e: GraphErro): string {
  if (e.code === 190) return 'O token da Meta expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Marketing → Conexões.'
  if (e.code === 10 || e.code === 200) return `Falta permissão no token da Meta (${e.message || 'permissão'}). Confira as permissões do Usuário do Sistema.`
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return 'A Meta limitou as consultas por agora. O CRM tenta de novo na próxima hora.'
  return `Meta: ${e.message || 'erro desconhecido'}`
}

async function graph<T = any>(caminho: string, params: Record<string, string>, token: string): Promise<T> {
  const url = caminho.startsWith('http') ? caminho : `${BASE}/${caminho.replace(/^\//, '')}?${new URLSearchParams({ ...params, access_token: token })}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  const json = (await res.json().catch(() => ({}))) as any
  if (!res.ok || json.error) throw new MetaErro(json.error || { message: `HTTP ${res.status}` })
  return json as T
}
async function todasPaginas<T = any>(caminho: string, params: Record<string, string>, token: string, parar?: (item: T) => boolean, max = 10): Promise<T[]> {
  const out: T[] = []
  let r: any = await graph(caminho, params, token)
  for (let i = 0; i < max; i++) {
    const dados: T[] = r.data || []
    for (const d of dados) {
      if (parar && parar(d)) return out
      out.push(d)
    }
    const prox = r.paging?.next
    if (!prox) break
    r = await graph(prox, {}, token)
  }
  return out
}

const TZ = 'America/Sao_Paulo'
export function dataBR(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}
export function hojeBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}
function isoSql(d: Date) {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

export type ContaDisponivel = { pageId: string; pageNome: string; igUserId: string; username: string | null; seguidores: number | null }

// Páginas que o token enxerga e que têm Instagram profissional ligado.
export async function listarContasDoToken(): Promise<ContaDisponivel[]> {
  const token = await tokenSistema()
  if (!token) throw new Error('Cole primeiro o token da Meta.')
  const paginas = await todasPaginas<any>('me/accounts', { fields: 'id,name,instagram_business_account{id,username,followers_count}', limit: '100' }, token)
  return paginas
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({ pageId: p.id, pageNome: p.name, igUserId: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null, seguidores: p.instagram_business_account.followers_count ?? null }))
}

export async function vincularConta(empresaId: number, pageId: string) {
  const token = await tokenSistema()
  if (!token) throw new Error('Cole primeiro o token da Meta.')
  const paginas = await todasPaginas<any>('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' }, token)
  const p = paginas.find((x) => x.id === pageId)
  if (!p?.instagram_business_account?.id) throw new Error('Essa Página não tem Instagram profissional ligado, ou o token não tem acesso a ela.')
  const valores = { pageId: p.id, pageNome: p.name, igUserId: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null, pageToken: p.access_token ?? null, ultimoErro: null, updatedAt: isoSql(new Date()) }
  await db.insert(mktIgContas).values({ empresaId, ...valores }).onConflictDoUpdate({ target: mktIgContas.empresaId, set: valores })
}

export async function desvincularConta(empresaId: number) {
  await db.delete(mktIgContas).where(eq(mktIgContas.empresaId, empresaId))
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function insightsMidia(id: string, token: string): Promise<Record<string, number>> {
  const tentativas = ['views,reach,saved,shares,total_interactions', 'reach,saved,shares', 'reach']
  for (const metric of tentativas) {
    try {
      const r = await graph<any>(`${id}/insights`, { metric }, token)
      const out: Record<string, number> = {}
      for (const m of r.data || []) out[m.name] = num(m.values?.[0]?.value ?? m.total_value?.value)
      return out
    } catch (e) {
      if (e instanceof MetaErro && e.code === 190) throw e
    }
  }
  return {}
}

export type ResultadoSync = { empresaId: number; midias: number; comentarios: number; conversas: number; avisos: string[] }

export async function sincronizarEmpresa(empresaId: number, opts: { diasMidias?: number } = {}): Promise<ResultadoSync> {
  const conta = await db.query.mktIgContas.findFirst({ where: eq(mktIgContas.empresaId, empresaId) })
  if (!conta) throw new Error('Instagram desta marca ainda não foi ligado em Marketing → Conexões.')
  const tokenSis = await tokenSistema()
  const token = conta.pageToken || tokenSis
  if (!token) throw new Error('Token da Meta não configurado.')
  const avisos: string[] = []
  const res: ResultadoSync = { empresaId, midias: 0, comentarios: 0, conversas: 0, avisos }
  try {
    // Seguidores (foto do dia)
    const perfil = await graph<any>(conta.igUserId, { fields: 'followers_count,media_count,username' }, token)
    if (perfil.followers_count != null) {
      await db.insert(mktIgSeguidores).values({ empresaId, data: hojeBR(), seguidores: num(perfil.followers_count) })
        .onConflictDoUpdate({ target: [mktIgSeguidores.empresaId, mktIgSeguidores.data], set: { seguidores: num(perfil.followers_count) } })
    }
    // Mídias dos últimos N dias
    const dias = opts.diasMidias ?? 120
    const limite = Date.now() - dias * 864e5
    const midias = await todasPaginas<any>(`${conta.igUserId}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: '50' }, token, (m) => new Date(m.timestamp).getTime() < limite)
    const recentes = Date.now() - 45 * 864e5
    for (const m of midias) {
      const tipo = m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'Vídeo' : 'Post'
      const ins = new Date(m.timestamp).getTime() >= recentes ? await insightsMidia(m.id, token) : null
      const base = {
        empresaId, tipo, mediaType: m.media_type ?? null, permalink: m.permalink ?? null, legenda: String(m.caption || ''),
        publicadoEm: isoSql(new Date(m.timestamp)), data: dataBR(m.timestamp), curtidas: num(m.like_count), comentarios: num(m.comments_count), updatedAt: isoSql(new Date()),
      }
      const comIns = ins ? { ...base, views: num(ins.views), alcance: num(ins.reach), compartilhamentos: num(ins.shares), salvos: num(ins.saved) } : base
      await db.insert(mktIgMidias).values({ id: m.id, ...comIns }).onConflictDoUpdate({ target: mktIgMidias.id, set: comIns })
      res.midias++
    }
    // Comentários (texto) das mídias dos últimos 30 dias
    const minhas = (conta.username || perfil.username || '').toLowerCase()
    const ultimos30 = Date.now() - 30 * 864e5
    for (const m of midias.filter((x) => num(x.comments_count) > 0 && new Date(x.timestamp).getTime() >= ultimos30)) {
      try {
        const coms = await todasPaginas<any>(`${m.id}/comments`, { fields: 'id,text,username,timestamp,replies{username}', limit: '50' }, token, undefined, 4)
        for (const c of coms) {
          const usuario = String(c.username || '')
          const respondido = (c.replies?.data || []).some((r: any) => String(r.username || '').toLowerCase() === minhas)
          const v = { empresaId, midiaId: m.id, usuario, texto: String(c.text || ''), publicadoEm: isoSql(new Date(c.timestamp)), respondido, daMarca: usuario.toLowerCase() === minhas }
          await db.insert(mktIgComentarios).values({ id: c.id, ...v }).onConflictDoUpdate({ target: mktIgComentarios.id, set: v })
          res.comentarios++
        }
      } catch (e) {
        if (e instanceof MetaErro && e.code === 190) throw e
        avisos.push(`Comentários: ${(e as Error).message}`)
        break
      }
    }
    // Directs (conversas do Instagram, pela Página)
    try {
      const convs = await todasPaginas<any>(`${conta.pageId}/conversations`, { platform: 'instagram', fields: 'id,updated_time,participants,messages.limit(10){message,from,created_time}', limit: '50' }, conta.pageToken || token, (c) => new Date(c.updated_time).getTime() < Date.now() - 120 * 864e5, 6)
      for (const c of convs) {
        const msgs = (c.messages?.data || []).map((x: any) => ({ de: x.from?.id === conta.igUserId ? 'marca' : 'cliente', nome: x.from?.username || x.from?.name || null, texto: String(x.message || ''), em: x.created_time }))
        msgs.sort((a: any, b: any) => String(a.em).localeCompare(String(b.em)))
        const ultima = msgs[msgs.length - 1]
        const outro = (c.participants?.data || []).find((p: any) => p.id !== conta.igUserId)
        const v = { empresaId, contato: outro?.username || outro?.name || null, ultimaMensagem: ultima?.texto?.slice(0, 500) || '', ultimaEm: isoSql(new Date(c.updated_time)), ultimaDoCliente: ultima ? ultima.de === 'cliente' : false, mensagens: JSON.stringify(msgs.slice(-10)) }
        await db.insert(mktIgConversas).values({ id: c.id, ...v }).onConflictDoUpdate({ target: mktIgConversas.id, set: v })
        res.conversas++
      }
    } catch (e) {
      if (e instanceof MetaErro && e.code === 190) throw e
      avisos.push(`Directs: ${(e as Error).message}`)
    }
    await db.update(mktIgContas).set({ ultimoSync: isoSql(new Date()), ultimoErro: avisos.length ? avisos.join(' | ').slice(0, 900) : null }).where(eq(mktIgContas.empresaId, empresaId))
  } catch (e) {
    await db.update(mktIgContas).set({ ultimoErro: (e as Error).message.slice(0, 900) }).where(eq(mktIgContas.empresaId, empresaId))
    throw e
  }
  return res
}

// Concorrentes: Business Discovery lê qualquer conta comercial/criador pública.
export async function sincronizarConcorrentes(empresaId: number, forcar = false): Promise<number> {
  const conta = await db.query.mktIgContas.findFirst({ where: eq(mktIgContas.empresaId, empresaId) })
  const perfil = await db.query.mktPerfis.findFirst({ where: eq(mktPerfis.empresaId, empresaId) })
  const lista: { handle: string }[] = perfil ? JSON.parse(perfil.concorrentes || '[]') : []
  if (!conta || !lista.length) return 0
  const token = conta.pageToken || (await tokenSistema())
  if (!token) return 0
  const hoje = hojeBR()
  let n = 0
  for (const { handle } of lista) {
    const h = String(handle || '').replace(/^@/, '').trim()
    if (!h) continue
    if (!forcar) {
      const ja = await db.query.mktConcorrentesFotos.findFirst({ where: and(eq(mktConcorrentesFotos.empresaId, empresaId), eq(mktConcorrentesFotos.handle, h), eq(mktConcorrentesFotos.data, hoje)) })
      if (ja) continue
    }
    let v: { seguidores: number | null; posts: number | null; midias: string; erro: string | null }
    try {
      const r = await graph<any>(conta.igUserId, { fields: `business_discovery.username(${h}){followers_count,media_count,media.limit(15){caption,like_count,comments_count,permalink,timestamp,media_type,media_product_type}}` }, token)
      const bd = r.business_discovery || {}
      const midias = (bd.media?.data || []).map((m: any) => ({ legenda: String(m.caption || '').slice(0, 300), curtidas: num(m.like_count), comentarios: num(m.comments_count), link: m.permalink, data: m.timestamp ? dataBR(m.timestamp) : null, tipo: m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'Vídeo' : 'Post' }))
      v = { seguidores: bd.followers_count ?? null, posts: bd.media_count ?? null, midias: JSON.stringify(midias), erro: null }
    } catch (e) {
      v = { seguidores: null, posts: null, midias: '[]', erro: (e as Error).message.slice(0, 300) }
    }
    await db.insert(mktConcorrentesFotos).values({ empresaId, handle: h, data: hoje, ...v }).onConflictDoUpdate({ target: [mktConcorrentesFotos.empresaId, mktConcorrentesFotos.handle, mktConcorrentesFotos.data], set: v })
    n++
  }
  return n
}

// Roda de hora em hora pelo scheduler. Sem token configurado não faz nada.
export async function sincronizarTodasMarcas(): Promise<string> {
  if (!(await tokenSistema())) return ''
  const contas = await db.select().from(mktIgContas)
  const partes: string[] = []
  for (const c of contas) {
    try {
      const r = await sincronizarEmpresa(c.empresaId, { diasMidias: 60 })
      await sincronizarConcorrentes(c.empresaId)
      partes.push(`empresa ${c.empresaId}: ${r.midias} mídias, ${r.comentarios} comentários, ${r.conversas} conversas`)
    } catch (e) {
      partes.push(`empresa ${c.empresaId}: ${(e as Error).message}`)
    }
  }
  return partes.join(' · ')
}

