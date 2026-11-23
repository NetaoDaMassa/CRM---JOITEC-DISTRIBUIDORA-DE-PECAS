// Módulo Marketing — planejamento de conteúdo das 5 marcas, revisão de
// roteiros por IA, persona/SWOT, metas semanais e Instagram via Meta.
// Pedido do João, 2026-11-20 ("constroi tudo isso para dentro do CRM").
// Acesso: feature 'marketing' (só quem o João liberar em Permissões).
// Conexão com a Meta (token): só super admin.
import { z } from 'zod'
import crypto from 'crypto'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { mktPlanos, mktPecas, mktIdeias, mktAnalises, mktPerfis, mktIgContas, mktIgMidias, mktIgComentarios, mktIgConversas, mktIgSeguidores, mktConcorrentesFotos } from '../db/schema.js'
import { getConfigNumero, setConfig } from '../lib/configuracoes.js'
import { MARCAS, marca, montarPedido, chamarClaude, aplicarResposta, type TipoPedido } from '../lib/marketingIa.js'
import { PILARES_PADRAO, checklistPadrao } from '../lib/marketingFluxo.js'
import { redesDaEmpresa, importarMlabs } from '../lib/marketingMlabs.js'
import { listarContasDoToken, vincularConta, desvincularConta, salvarTokenSistema, tokenSistema, temTokenProprio, sincronizarEmpresa, sincronizarConcorrentes, hojeBR } from '../lib/marketingMeta.js'

const FEATURE = 'marketing'
const proc = featureProcedure(FEATURE)
const marcaId = z.number().int().refine((n) => !!marca(n), 'Marca inválida')
const mesStr = z.string().regex(/^\d{4}-\d{2}$/)

function j<T>(s: string | null | undefined, padrao: T): T {
  try { return s ? (JSON.parse(s) as T) : padrao } catch { return padrao }
}
function agoraSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}
function fimMes(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`
}
function planoId(empresaId: number, mes: string) {
  return `${empresaId}-${mes}`
}
function pecaSaida(p: typeof mktPecas.$inferSelect) {
  return { ...p, canais: j<string[]>(p.canais, []), analise: j<any>(p.analise, null), checklist: j<{ t: string; ok: boolean }[]>(p.checklist, []) }
}

const pecaCampos = z.object({
  data: z.string().nullable().optional(),
  hora: z.string().nullable().optional(),
  tipo: z.enum(['Vídeo', 'Post']).optional(),
  pilar: z.string().nullable().optional(),
  titulo: z.string().max(500).optional(),
  gancho: z.string().max(1000).optional(),
  cta: z.string().max(500).optional(),
  canais: z.array(z.string()).optional(),
  status: z.string().max(40).optional(),
  roteiro: z.string().max(20000).optional(),
  legenda: z.string().max(5000).optional(),
  obs: z.string().max(3000).optional(),
  responsavelId: z.number().int().nullable().optional(),
  checklist: z.array(z.object({ t: z.string().max(200), ok: z.boolean() })).max(30).optional(),
  linkMidia: z.string().max(2000).optional(),
})

const tipoPedido = z.enum(['revisao', 'criar', 'reescrever', 'instagram', 'mes', 'directs', 'ideias', 'persona'])
const paramsPedido = z.object({ pecaIds: z.array(z.string()).max(8).optional(), pecaId: z.string().optional(), empresaId: z.number().int().optional(), mes: mesStr.optional() })

export const marketingModuloRouter = router({
  marcas: proc.query(async () => {
    const contas = await db.select().from(mktIgContas)
    return MARCAS.map((m) => {
      const c = contas.find((x) => x.empresaId === m.empresaId)
      return { empresaId: m.empresaId, nome: m.nome, instagram: c ? { username: c.username, ultimoSync: c.ultimoSync, ultimoErro: c.ultimoErro } : null }
    })
  }),

  // ---------- planos ----------
  planos: proc.query(async () => {
    const rows = await db.select().from(mktPlanos).orderBy(desc(mktPlanos.mes))
    return rows.map((p) => ({ id: p.id, empresaId: p.empresaId, mes: p.mes, dados: j<any>(p.dados, {}), updatedAt: p.updatedAt }))
  }),
  criarPlano: proc.input(z.object({ empresaId: marcaId, mes: mesStr, copiarDe: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const id = planoId(input.empresaId, input.mes)
    const ja = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, id) })
    if (ja) throw new TRPCError({ code: 'CONFLICT', message: 'Esse plano já existe.' })
    let dados: any = { objetivo: '', mensagem: '', pilares: PILARES_PADRAO, semanas: [], metas: [], funcionou: [], travou: [], diagnostico: [], recomendacoes: [] }
    if (input.copiarDe) {
      const base = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, input.copiarDe) })
      const b = j<any>(base?.dados, {})
      dados = { ...dados, pilares: b.pilares || PILARES_PADRAO, metas: (b.metas || []).map((g: any) => ({ nome: g.nome || '', atual: g.meta || g.atual || '', meta: '' })) }
    }
    await db.insert(mktPlanos).values({ id, empresaId: input.empresaId, mes: input.mes, dados: JSON.stringify(dados), atualizadoPor: ctx.user.id })
    return { id }
  }),
  salvarPlano: proc.input(z.object({ id: z.string(), dados: z.record(z.any()) })).mutation(async ({ ctx, input }) => {
    const r = await db.update(mktPlanos).set({ dados: JSON.stringify(input.dados), atualizadoPor: ctx.user.id, updatedAt: agoraSql() }).where(eq(mktPlanos.id, input.id)).returning({ id: mktPlanos.id })
    if (!r.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plano não encontrado.' })
    return { ok: true }
  }),

  // ---------- peças ----------
  pecas: proc.input(z.object({ mes: mesStr.optional(), planoId: z.string().optional() })).query(async ({ input }) => {
    const conds = []
    if (input.planoId) conds.push(eq(mktPecas.planoId, input.planoId))
    if (input.mes) conds.push(gte(mktPecas.data, `${input.mes}-01`), lte(mktPecas.data, fimMes(input.mes)))
    const rows = await db.select().from(mktPecas).where(conds.length ? and(...conds) : undefined)
    // Peças sem data também aparecem no plano delas
    let semData: typeof rows = []
    if (input.mes && !input.planoId) {
      const planos = await db.select({ id: mktPlanos.id }).from(mktPlanos).where(eq(mktPlanos.mes, input.mes))
      if (planos.length) semData = (await db.select().from(mktPecas).where(inArray(mktPecas.planoId, planos.map((p) => p.id)))).filter((p) => !p.data)
    }
    return [...rows, ...semData].map(pecaSaida)
  }),
  criarPeca: proc.input(pecaCampos.extend({ planoId: z.string() })).mutation(async ({ input }) => {
    const pl = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, input.planoId) })
    if (!pl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plano não encontrado.' })
    const id = crypto.randomUUID()
    const { canais, checklist, planoId: _p, ...resto } = input
    await db.insert(mktPecas).values({ id, empresaId: pl.empresaId, planoId: pl.id, ...resto, canais: JSON.stringify(canais || []), checklist: JSON.stringify(checklist || checklistPadrao(input.tipo || 'Vídeo')) })
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, id) })
    return pecaSaida(p!)
  }),
  salvarPeca: proc.input(pecaCampos.extend({ id: z.string() })).mutation(async ({ input }) => {
    const { id, canais, checklist, ...resto } = input
    const set: Record<string, unknown> = { ...resto, updatedAt: agoraSql() }
    if (canais) set.canais = JSON.stringify(canais)
    if (checklist) set.checklist = JSON.stringify(checklist)
    const r = await db.update(mktPecas).set(set).where(eq(mktPecas.id, id)).returning({ id: mktPecas.id })
    if (!r.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    return { ok: true }
  }),
  excluirPeca: proc.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await db.delete(mktPecas).where(eq(mktPecas.id, input.id))
    return { ok: true }
  }),
  aprovarPecas: proc.input(z.object({ ids: z.array(z.string()).min(1).max(300) })).mutation(async ({ ctx, input }) => {
    await db.update(mktPecas).set({ status: 'Gravação', aprovadoEm: agoraSql(), aprovadoPor: ctx.user.id, updatedAt: agoraSql() }).where(inArray(mktPecas.id, input.ids))
    return { aprovadas: input.ids.length }
  }),

  // ---------- metas ----------
  metas: proc.query(async () => ({ videos: await getConfigNumero('mkt_meta_videos_semana', 3), posts: await getConfigNumero('mkt_meta_posts_semana', 2) })),
  salvarMetas: proc.input(z.object({ videos: z.number().int().min(0).max(30), posts: z.number().int().min(0).max(30) })).mutation(async ({ input }) => {
    await setConfig('mkt_meta_videos_semana', input.videos)
    await setConfig('mkt_meta_posts_semana', input.posts)
    return { ok: true }
  }),

  // ---------- persona / SWOT / concorrentes ----------
  perfil: proc.input(z.object({ empresaId: marcaId })).query(async ({ input }) => {
    const p = await db.query.mktPerfis.findFirst({ where: eq(mktPerfis.empresaId, input.empresaId) })
    return { personas: j<any[]>(p?.personas, []), swot: { forcas: [], fraquezas: [], oportunidades: [], ameacas: [], ...j<any>(p?.swot, {}) }, concorrentes: j<any[]>(p?.concorrentes, []) }
  }),
  salvarPerfil: proc.input(z.object({ empresaId: marcaId, personas: z.array(z.record(z.string())).max(6), swot: z.record(z.array(z.string())), concorrentes: z.array(z.object({ handle: z.string(), obs: z.string().optional() })).max(20) })).mutation(async ({ input }) => {
    const v = { personas: JSON.stringify(input.personas), swot: JSON.stringify(input.swot), concorrentes: JSON.stringify(input.concorrentes.map((c) => ({ handle: c.handle.replace(/^@/, '').trim(), obs: c.obs || '' }))), updatedAt: agoraSql() }
    await db.insert(mktPerfis).values({ empresaId: input.empresaId, ...v }).onConflictDoUpdate({ target: mktPerfis.empresaId, set: v })
    return { ok: true }
  }),

  // ---------- brainstorm ----------
  ideias: proc.input(z.object({ empresaId: marcaId })).query(async ({ input }) => db.select().from(mktIdeias).where(eq(mktIdeias.empresaId, input.empresaId)).orderBy(desc(mktIdeias.createdAt))),
  criarIdeia: proc.input(z.object({ empresaId: marcaId, url: z.string().max(1000), nota: z.string().max(2000) })).mutation(async ({ ctx, input }) => {
    await db.insert(mktIdeias).values({ ...input, autorId: ctx.user.id })
    return { ok: true }
  }),
  atualizarIdeia: proc.input(z.object({ id: z.number().int(), status: z.enum(['nova', 'usada', 'arquivada']), usadaEm: z.string().optional() })).mutation(async ({ input }) => {
    await db.update(mktIdeias).set({ status: input.status, usadaEm: input.usadaEm ?? null }).where(eq(mktIdeias.id, input.id))
    return { ok: true }
  }),
  excluirIdeia: proc.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    await db.delete(mktIdeias).where(eq(mktIdeias.id, input.id))
    return { ok: true }
  }),

  analises: proc.input(z.object({ empresaId: marcaId })).query(async ({ input }) => {
    const rows = await db.select().from(mktAnalises).where(eq(mktAnalises.empresaId, input.empresaId))
    return rows.map((r) => ({ ...r, dados: j<any>(r.dados, null) }))
  }),

  // ---------- Instagram (dados guardados pela sincronização) ----------
  igMes: proc.input(z.object({ mes: mesStr })).query(async ({ input }) => {
    const rows = await db.select({ id: mktIgMidias.id, empresaId: mktIgMidias.empresaId, tipo: mktIgMidias.tipo, data: mktIgMidias.data, permalink: mktIgMidias.permalink, legenda: mktIgMidias.legenda, views: mktIgMidias.views, alcance: mktIgMidias.alcance, curtidas: mktIgMidias.curtidas, comentarios: mktIgMidias.comentarios, compartilhamentos: mktIgMidias.compartilhamentos, salvos: mktIgMidias.salvos })
      .from(mktIgMidias).where(and(gte(mktIgMidias.data, `${input.mes}-01`), lte(mktIgMidias.data, fimMes(input.mes))))
    return rows.map((r) => ({ ...r, legenda: r.legenda.slice(0, 220) }))
  }),
  igEmpresa: proc.input(z.object({ empresaId: marcaId, mes: mesStr })).query(async ({ input }) => {
    const e = input.empresaId
    const de90 = new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const conta = await db.query.mktIgContas.findFirst({ where: eq(mktIgContas.empresaId, e) })
    const midias = await db.select().from(mktIgMidias).where(and(eq(mktIgMidias.empresaId, e), gte(mktIgMidias.data, de90)))
    const seguidores = await db.select().from(mktIgSeguidores).where(and(eq(mktIgSeguidores.empresaId, e), gte(mktIgSeguidores.data, de90))).orderBy(mktIgSeguidores.data)
    const comentarios = await db.select().from(mktIgComentarios).where(and(eq(mktIgComentarios.empresaId, e), gte(mktIgComentarios.publicadoEm, `${input.mes}-01`), lte(mktIgComentarios.publicadoEm, `${fimMes(input.mes)} 23:59:59`), eq(mktIgComentarios.daMarca, false))).orderBy(desc(mktIgComentarios.publicadoEm)).limit(300)
    const conversas = await db.select().from(mktIgConversas).where(and(eq(mktIgConversas.empresaId, e), gte(mktIgConversas.ultimaEm, `${input.mes}-01`), lte(mktIgConversas.ultimaEm, `${fimMes(input.mes)} 23:59:59`))).orderBy(desc(mktIgConversas.ultimaEm))
    const semResposta = await db.select().from(mktIgConversas).where(and(eq(mktIgConversas.empresaId, e), eq(mktIgConversas.ultimaDoCliente, true))).orderBy(desc(mktIgConversas.ultimaEm)).limit(50)
    const fotos = await db.select().from(mktConcorrentesFotos).where(eq(mktConcorrentesFotos.empresaId, e)).orderBy(desc(mktConcorrentesFotos.data)).limit(200)
    const concorrentes: Record<string, any> = {}
    for (const f of fotos) {
      const c = (concorrentes[f.handle] ||= { handle: f.handle, atual: null, anterior: null })
      if (!c.atual) c.atual = { ...f, midias: j<any[]>(f.midias, []) }
      else if (!c.anterior && f.data <= new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA')) c.anterior = { data: f.data, seguidores: f.seguidores, posts: f.posts }
    }
    const legendaPorMidia = Object.fromEntries(midias.map((m) => [m.id, { legenda: m.legenda.slice(0, 80), link: m.permalink }]))
    return {
      conta: conta ? { username: conta.username, ultimoSync: conta.ultimoSync, ultimoErro: conta.ultimoErro } : null,
      midias: midias.map((m) => ({ ...m, legenda: m.legenda.slice(0, 220) })),
      seguidores,
      comentarios: comentarios.map((c) => ({ ...c, post: legendaPorMidia[c.midiaId] || null })),
      conversas: conversas.map((c) => ({ ...c, mensagens: j<any[]>(c.mensagens, []) })),
      semResposta: semResposta.map((c) => ({ ...c, mensagens: j<any[]>(c.mensagens, []) })),
      concorrentes: Object.values(concorrentes),
    }
  }),
  // Todas as redes (mLabs, 1x por dia) — aba Empresa.
  redesEmpresa: proc.input(z.object({ empresaId: marcaId, dias: z.number().int().min(7).max(120).default(30) })).query(({ input }) => redesDaEmpresa(input.empresaId, input.dias)),
  // Super admin cola o pacote da mLabs à mão (mesmo formato do robô).
  importarMlabs: superAdminProcedure.input(z.object({ json: z.string().max(5_000_000) })).mutation(async ({ input }) => {
    let bruto: unknown
    try { bruto = JSON.parse(input.json) } catch { throw new TRPCError({ code: 'BAD_REQUEST', message: 'Não é um JSON válido.' }) }
    try {
      const pacotes = Array.isArray(bruto) ? bruto : [bruto]
      const r = []
      for (const p of pacotes) r.push(await importarMlabs(p))
      return r
    } catch (e) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message.slice(0, 500) })
    }
  }),
  sincronizar: proc.input(z.object({ empresaId: marcaId })).mutation(async ({ input }) => {
    try {
      const r = await sincronizarEmpresa(input.empresaId)
      await sincronizarConcorrentes(input.empresaId, true)
      return r
    } catch (e) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message })
    }
  }),

  // ---------- conexão com a Meta (super admin) ----------
  conexoes: superAdminProcedure.query(async () => {
    const contas = await db.select().from(mktIgContas)
    const tokens: Record<number, boolean> = {}
    for (const m of MARCAS) tokens[m.empresaId] = await temTokenProprio(m.empresaId)
    return { temToken: !!(await tokenSistema()), tokens, contas: contas.map(({ pageToken: _t, ...c }) => c), hoje: hojeBR() }
  }),
  // Salva a chave da marca, testa e, se ela enxerga um Instagram só, já liga.
  salvarToken: superAdminProcedure.input(z.object({ empresaId: marcaId, token: z.string().min(20).max(2000) })).mutation(async ({ input }) => {
    await salvarTokenSistema(input.token, input.empresaId)
    try {
      const contas = await listarContasDoToken(input.empresaId)
      let ligada: string | null = null
      if (contas.length === 1) {
        await vincularConta(input.empresaId, contas[0].pageId)
        ligada = contas[0].username
      }
      return { contas, ligada }
    } catch (e) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message })
    }
  }),
  contasDisponiveis: superAdminProcedure.input(z.object({ empresaId: marcaId })).query(async ({ input }) => {
    try { return await listarContasDoToken(input.empresaId) } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
  vincular: superAdminProcedure.input(z.object({ empresaId: marcaId, pageId: z.string() })).mutation(async ({ input }) => {
    try { await vincularConta(input.empresaId, input.pageId); return { ok: true } } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
  desvincular: superAdminProcedure.input(z.object({ empresaId: marcaId })).mutation(async ({ input }) => {
    await desvincularConta(input.empresaId)
    return { ok: true }
  }),

  // Importa os planos/peças exportados do painel do claude.ai (Mapa
  // Estratégico). Não apaga nada: plano que já existe é mantido e só as
  // peças que ainda não existem entram.
  importarPainel: superAdminProcedure.input(z.object({ planos: z.array(z.record(z.any())).max(200), pecas: z.array(z.record(z.any())).max(5000) })).mutation(async ({ ctx, input }) => {
    const porNome = (n: string) => {
      const s = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      if (s.includes('compretec')) return 6
      if (s.includes('joitec')) return 1
      if (s.includes('tubos')) return 2
      if (s.includes('automacao')) return 3
      if (s.includes('compressores')) return 4
      return null
    }
    const mapaPlano: Record<string, string> = {}
    let planosNovos = 0, pecasNovas = 0
    for (const p of input.planos) {
      const empresaId = porNome(p.empresa)
      const mes = String(p.mes || '')
      if (!empresaId || !/^\d{4}-\d{2}$/.test(mes)) continue
      const id = planoId(empresaId, mes)
      mapaPlano[String(p._id)] = id
      const ja = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, id) })
      if (ja) continue
      const { _id, empresa: _e, mes: _m, atualizado: _a, ...dados } = p
      await db.insert(mktPlanos).values({ id, empresaId, mes, dados: JSON.stringify(dados), atualizadoPor: ctx.user.id })
      planosNovos++
    }
    for (const x of input.pecas) {
      const pid = mapaPlano[String(x.plano)]
      const empresaId = porNome(x.empresa)
      if (!pid || !empresaId) continue
      const id = String(x._id || crypto.randomUUID())
      const ja = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, id) })
      if (ja) continue
      await db.insert(mktPecas).values({
        id, empresaId, planoId: pid, data: x.data || null, hora: x.hora || null, tipo: x.tipo === 'Post' ? 'Post' : 'Vídeo', pilar: x.pilar || null,
        titulo: String(x.titulo || ''), gancho: String(x.gancho || ''), cta: String(x.cta || ''), canais: JSON.stringify(Array.isArray(x.canais) ? x.canais : []),
        status: String(x.status || 'Ideia'), roteiro: String(x.roteiro || ''), legenda: String(x.legenda || ''), obs: String(x.obs || ''), analise: x.analise ? JSON.stringify(x.analise) : null,
      })
      pecasNovas++
    }
    return { planosNovos, pecasNovas }
  }),

  // ---------- IA: 2 jeitos ----------
  iaDisponivel: proc.query(() => ({ temChave: !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY) })),
  iaPedido: proc.input(z.object({ tipo: tipoPedido, params: paramsPedido })).mutation(async ({ input }) => {
    try { return await montarPedido(input.tipo as TipoPedido, input.params) } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
  iaExecutar: proc.input(z.object({ tipo: tipoPedido, params: paramsPedido })).mutation(async ({ ctx, input }) => {
    try {
      const { prompt } = await montarPedido(input.tipo as TipoPedido, input.params)
      const texto = await chamarClaude(prompt)
      return await aplicarResposta(input.tipo as TipoPedido, input.params, texto, ctx.user.id)
    } catch (e) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message })
    }
  }),
  iaAplicar: proc.input(z.object({ tipo: tipoPedido, params: paramsPedido, resposta: z.string().max(200000) })).mutation(async ({ ctx, input }) => {
    try { return await aplicarResposta(input.tipo as TipoPedido, input.params, input.resposta, ctx.user.id) } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
})
