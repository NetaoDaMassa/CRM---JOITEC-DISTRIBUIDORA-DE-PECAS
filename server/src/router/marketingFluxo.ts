// Módulo Marketing, parte 2 (João, 2026-11-22 — ideias tiradas de ClickUp,
// Trello, mLabs Workflow, Planable e Operand):
//  - quadro por etapa: equipe (responsáveis), comentários da peça
//  - peças da semana criadas sozinhas (3 vídeos + 2 posts por marca)
//  - link de aprovação: abre sem login, aprova ou pede ajuste pelo celular
//  - pedidos de outros setores ao marketing (qualquer pessoa logada pede)
import { z } from 'zod'
import crypto from 'crypto'
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, featureProcedure, protectedProcedure, publicProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { mktPecas, mktPecaComentarios, mktPecaVersoes, mktAprovLinks, mktDemandas, users, permissoesAdmin, solicitacoesDesign } from '../db/schema.js'
import { getConfigTexto, setConfig } from '../lib/configuracoes.js'
import { MARCAS, marca } from '../lib/marketingIa.js'
import { gerarPecasDaSemana, statusAoAprovar, statusAoPedirAjuste, garantirPlano, checklistPadrao, marcarQuemEtapa } from '../lib/marketingFluxo.js'
import { ETAPAS, erroTransicao, garantirPasta, registrarAnexo, lerAnexos, lerRevisores, salvarRevisores, podeRevisar } from '../lib/marketingParte3.js'

const proc = featureProcedure('marketing')
const TIPOS_DEMANDA = ['Arte', 'Vídeo', 'Post para rede social', 'Post de feedback / depoimento de cliente', 'Material impresso', 'Evento / feira', 'Site / loja virtual', 'Outro'] as const
const PRIORIDADES = ['Baixa', 'Normal', 'Urgente'] as const
// João, 2026-11-23: Novo → Aprovado → Produção → Entregue (entregar exige anexo).
const STATUS_DEMANDA = ['Novo', 'Aprovado', 'Produção', 'Entregue', 'Recusado'] as const
const arquivoUp = z.object({ path: z.string().max(300), nome: z.string().max(300), tipo: z.string().max(200).optional(), tamanho: z.number().optional() })

function agoraSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}
function j<T>(s: string | null | undefined, padrao: T): T {
  try { return s ? (JSON.parse(s) as T) : padrao } catch { return padrao }
}
const nomeMarca = (id: number | null) => (id ? marca(id)?.nome || '' : '')

async function linkValido(token: string) {
  const l = await db.query.mktAprovLinks.findFirst({ where: eq(mktAprovLinks.token, token) })
  if (!l || l.expiraEm < agoraSql()) throw new TRPCError({ code: 'NOT_FOUND', message: 'Link não encontrado ou vencido. Peça um link novo ao marketing.' })
  return { ...l, ids: j<string[]>(l.pecaIds, []) }
}

export const marketingFluxoRouter = router({
  // Quem pode ser responsável: quem tem a permissão Marketing + super admins.
  equipe: proc.query(async () => {
    const comPerm = await db.select({ id: permissoesAdmin.userId }).from(permissoesAdmin).where(eq(permissoesAdmin.feature, 'marketing'))
    const ids = comPerm.map((x) => x.id)
    const rows = await db.select({ id: users.id, name: users.name, fotoUrl: users.fotoUrl }).from(users)
      .where(and(eq(users.isActive, true), ids.length ? or(eq(users.superAdmin, true), inArray(users.id, ids)) : eq(users.superAdmin, true)))
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }),

  // ---------- peças da semana ----------
  autoSemana: proc.query(async () => ({ ligado: (await getConfigTexto('mkt_auto_semana')) !== '0' })),
  salvarAutoSemana: proc.input(z.object({ ligado: z.boolean() })).mutation(async ({ input }) => {
    await setConfig('mkt_auto_semana', input.ligado ? '1' : '0')
    return { ok: true }
  }),
  gerarSemana: proc.input(z.object({ segunda: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), empresaId: z.number().int().optional() })).mutation(async ({ ctx, input }) =>
    gerarPecasDaSemana({ segunda: input.segunda, userId: ctx.user.id, empresas: input.empresaId ? [input.empresaId] : undefined })),

  // ---------- comentários da peça ----------
  comentarios: proc.input(z.object({ pecaId: z.string() })).query(async ({ input }) =>
    db.select().from(mktPecaComentarios).where(eq(mktPecaComentarios.pecaId, input.pecaId)).orderBy(desc(mktPecaComentarios.id))),
  ultimosRetornos: proc.input(z.object({ pecaIds: z.array(z.string()).max(2000) })).query(async ({ input }) => {
    if (!input.pecaIds.length) return {} as Record<string, { tipo: string; texto: string; autorNome: string; createdAt: string }>
    const rows = await db.select().from(mktPecaComentarios).where(and(inArray(mktPecaComentarios.pecaId, input.pecaIds), ne(mktPecaComentarios.tipo, 'comentario'))).orderBy(desc(mktPecaComentarios.id))
    const out: Record<string, { tipo: string; texto: string; autorNome: string; createdAt: string }> = {}
    for (const r of rows) if (!out[r.pecaId]) out[r.pecaId] = { tipo: r.tipo, texto: r.texto, autorNome: r.autorNome, createdAt: r.createdAt }
    return out
  }),
  comentar: proc.input(z.object({ pecaId: z.string(), texto: z.string().trim().min(1).max(3000) })).mutation(async ({ ctx, input }) => {
    await db.insert(mktPecaComentarios).values({ pecaId: input.pecaId, tipo: 'comentario', autorId: ctx.user.id, autorNome: ctx.user.name, texto: input.texto })
    return { ok: true }
  }),

  // ---------- link de aprovação ----------
  criarLinkAprovacao: proc.input(z.object({ pecaIds: z.array(z.string()).min(1).max(100), titulo: z.string().max(200) })).mutation(async ({ ctx, input }) => {
    const token = crypto.randomBytes(18).toString('base64url')
    const expira = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    await db.insert(mktAprovLinks).values({ token, titulo: input.titulo, pecaIds: JSON.stringify(input.pecaIds), criadoPor: ctx.user.id, expiraEm: expira })
    return { token, caminho: `/aprovar/${token}` }
  }),
  aprovacaoObter: publicProcedure.input(z.object({ token: z.string().min(10).max(60) })).query(async ({ input }) => {
    const l = await linkValido(input.token)
    const pecas = l.ids.length ? await db.select().from(mktPecas).where(inArray(mktPecas.id, l.ids)) : []
    const coms = l.ids.length ? await db.select().from(mktPecaComentarios).where(inArray(mktPecaComentarios.pecaId, l.ids)).orderBy(desc(mktPecaComentarios.id)) : []
    return {
      titulo: l.titulo,
      pecas: pecas.sort((a, b) => (a.data || '').localeCompare(b.data || '')).map((p) => ({
        id: p.id, marca: nomeMarca(p.empresaId), tipo: p.tipo, data: p.data, hora: p.hora, status: p.status, titulo: p.titulo, gancho: p.gancho,
        roteiro: p.roteiro, legenda: p.legenda, cta: p.cta, linkMidia: p.linkMidia,
        historico: coms.filter((c) => c.pecaId === p.id && c.tipo !== 'comentario').slice(0, 5).map((c) => ({ tipo: c.tipo, texto: c.texto, autorNome: c.autorNome, createdAt: c.createdAt })),
      })),
    }
  }),
  aprovacaoResponder: publicProcedure.input(z.object({
    token: z.string().min(10).max(60), pecaId: z.string(), acao: z.enum(['aprovar', 'ajuste']),
    nome: z.string().trim().min(2, 'Escreva seu nome').max(80), texto: z.string().trim().max(3000),
  })).mutation(async ({ input }) => {
    const l = await linkValido(input.token)
    if (!l.ids.includes(input.pecaId)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não está neste link.' })
    if (input.acao === 'ajuste' && !input.texto) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o que precisa ajustar.' })
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    const novo = input.acao === 'aprovar' ? statusAoAprovar(p.status) : statusAoPedirAjuste(p.status)
    const set: Record<string, unknown> = { status: novo, updatedAt: agoraSql() }
    if (input.acao === 'aprovar') set.aprovadoEm = agoraSql()
    await db.update(mktPecas).set(set).where(eq(mktPecas.id, p.id))
    await marcarQuemEtapa(p.id, `${input.nome} (link)`)
    await db.insert(mktPecaComentarios).values({ pecaId: p.id, tipo: input.acao === 'aprovar' ? 'aprovado' : 'ajuste', autorNome: input.nome, texto: input.texto })
    return { status: novo }
  }),

  // ---------- pedidos ao marketing ----------
  opcoesPedido: protectedProcedure.query(() => ({ tipos: TIPOS_DEMANDA, prioridades: PRIORIDADES, marcas: MARCAS.map((m) => ({ empresaId: m.empresaId, nome: m.nome })) })),
  pedir: protectedProcedure.input(z.object({
    titulo: z.string().trim().min(3, 'Dê um título curto ao pedido').max(200), descricao: z.string().trim().min(5, 'Explique o que precisa').max(5000),
    tipo: z.enum(TIPOS_DEMANDA), prioridade: z.enum(PRIORIDADES), prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), empresaId: z.number().int().nullable(),
  })).mutation(async ({ ctx, input }) => {
    await db.insert(mktDemandas).values({ ...input, empresaId: input.empresaId && marca(input.empresaId) ? input.empresaId : null, solicitanteId: ctx.user.id })
    return { ok: true }
  }),
  meusPedidos: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.select().from(mktDemandas).where(eq(mktDemandas.solicitanteId, ctx.user.id)).orderBy(desc(mktDemandas.id)).limit(100)
    return rows.map((d) => ({ ...d, anexos: lerAnexos(d.anexos), marca: nomeMarca(d.empresaId) }))
  }),
  demandas: proc.query(async () => {
    const rows = await db.select({ d: mktDemandas, solicitante: users.name }).from(mktDemandas).leftJoin(users, eq(users.id, mktDemandas.solicitanteId)).orderBy(desc(mktDemandas.id)).limit(500)
    return rows.map((r) => ({ ...r.d, anexos: lerAnexos(r.d.anexos), solicitante: r.solicitante || '', marca: nomeMarca(r.d.empresaId) }))
  }),
  salvarDemanda: proc.input(z.object({
    id: z.number().int(), status: z.enum(STATUS_DEMANDA).optional(), responsavelId: z.number().int().nullable().optional(), prazo: z.string().nullable().optional(),
    prioridade: z.enum(PRIORIDADES).optional(), linkEntrega: z.string().max(2000).optional(), resposta: z.string().max(3000).optional(),
  })).mutation(async ({ input }) => {
    const { id, ...resto } = input
    if (resto.status === 'Entregue') {
      const d = await db.query.mktDemandas.findFirst({ where: eq(mktDemandas.id, id) })
      if (!d) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' })
      if (!lerAnexos(d.anexos).length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Para entregar, anexe o arquivo (vídeo, arte ou post) no pedido.' })
    }
    const set: Record<string, unknown> = { ...resto, updatedAt: agoraSql() }
    if (resto.status) set.concluidoEm = ['Entregue', 'Recusado'].includes(resto.status) ? agoraSql() : null
    await db.update(mktDemandas).set(set).where(eq(mktDemandas.id, id))
    return { ok: true }
  }),
  // Pedidos de arte dos vendedores (tela antiga "Solicitar Arte") que ainda
  // esperam aprovação — só o número, para aparecer na mesma fila.
  artesVendedores: proc.query(async () => {
    const pend = await db.select({ id: solicitacoesDesign.id }).from(solicitacoesDesign).where(eq(solicitacoesDesign.status, 'pendente'))
    return { pendentes: pend.length }
  }),

  // Anexo do pedido: vai para Arquivos/Mídia → Marketing → Pedidos ao marketing → #id título.
  anexarDemanda: proc.input(z.object({ id: z.number().int(), arquivo: arquivoUp })).mutation(async ({ ctx, input }) => {
    const d = await db.query.mktDemandas.findFirst({ where: eq(mktDemandas.id, input.id) })
    if (!d) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' })
    let emp = d.empresaId
    if (!emp) emp = (await db.query.users.findFirst({ where: eq(users.id, d.solicitanteId), columns: { empresaId: true } }))?.empresaId ?? 1
    const pasta = d.pastaId || (await garantirPasta(emp, ['Marketing', 'Pedidos ao marketing', `#${d.id} ${d.titulo}`], ctx.user.id))
    try {
      const a = await registrarAnexo(emp, pasta, input.arquivo, ctx.user)
      await db.update(mktDemandas).set({ anexos: JSON.stringify([...lerAnexos(d.anexos), a]), pastaId: pasta, updatedAt: agoraSql() }).where(eq(mktDemandas.id, d.id))
      return a
    } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
  removerAnexoDemanda: proc.input(z.object({ id: z.number().int(), arquivoId: z.number().int() })).mutation(async ({ input }) => {
    const d = await db.query.mktDemandas.findFirst({ where: eq(mktDemandas.id, input.id) })
    if (!d) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' })
    const anexos = lerAnexos(d.anexos).filter((a) => a.arquivoId !== input.arquivoId)
    if (d.status === 'Entregue' && !anexos.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido entregue precisa ter pelo menos um anexo.' })
    await db.update(mktDemandas).set({ anexos: JSON.stringify(anexos), updatedAt: agoraSql() }).where(eq(mktDemandas.id, d.id))
    return { ok: true }
  }),

  // ---------- anexo da peça (vídeo/arte) → Arquivos/Mídia ----------
  anexarPeca: proc.input(z.object({ pecaId: z.string(), arquivo: arquivoUp })).mutation(async ({ ctx, input }) => {
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    const dia = p.data ? `${p.data.slice(8, 10)}-${p.data.slice(5, 7)} ` : ''
    const pasta = p.pastaId || (await garantirPasta(p.empresaId, ['Marketing', `Conteúdo ${(p.data || p.planoId.split('-').slice(1).join('-')).slice(0, 7)}`, `${dia}${p.tipo} · ${p.titulo || 'sem título'}`.slice(0, 110)], ctx.user.id))
    try {
      const a = await registrarAnexo(p.empresaId, pasta, input.arquivo, ctx.user)
      await db.update(mktPecas).set({ anexos: JSON.stringify([...lerAnexos(p.anexos), a]), pastaId: pasta, updatedAt: agoraSql() }).where(eq(mktPecas.id, p.id))
      return a
    } catch (e) { throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message }) }
  }),
  removerAnexoPeca: proc.input(z.object({ pecaId: z.string(), arquivoId: z.number().int() })).mutation(async ({ input }) => {
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    const anexos = lerAnexos(p.anexos).filter((a) => a.arquivoId !== input.arquivoId)
    if (['Aprovação final', 'Agendado na mLabs'].includes(p.status) && !anexos.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Peça nessa etapa precisa ter o vídeo/arte anexado.' })
    await db.update(mktPecas).set({ anexos: JSON.stringify(anexos), updatedAt: agoraSql() }).where(eq(mktPecas.id, p.id))
    return { ok: true }
  }),

  // ---------- demanda complementar (fora do plano 3V+2P) ----------
  criarComplementar: proc.input(z.object({
    empresaId: z.number().int(), tipo: z.enum(['Vídeo', 'Post']), titulo: z.string().trim().min(3, 'Escreva o que é a demanda').max(300),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), responsavelId: z.number().int().nullable(), obs: z.string().max(3000), status: z.enum(ETAPAS),
  })).mutation(async ({ ctx, input }) => {
    if (!marca(input.empresaId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Marca inválida.' })
    if (['Aprovação final', 'Agendado na mLabs'].includes(input.status)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Comece a demanda até a etapa Produção — o anexo vem depois.' })
    const pl = await garantirPlano(input.empresaId, input.data.slice(0, 7), ctx.user.id)
    const id = crypto.randomUUID()
    await db.insert(mktPecas).values({
      id, empresaId: input.empresaId, planoId: pl.id, data: input.data, hora: '11:00', tipo: input.tipo, titulo: input.titulo, obs: input.obs, status: input.status, origem: 'complementar',
      responsavelId: input.responsavelId, canais: JSON.stringify([]), checklist: JSON.stringify(checklistPadrao(input.tipo)), updatedAt: agoraSql(),
    })
    await marcarQuemEtapa(id, ctx.user.name)
    return { id }
  }),

  // ---------- revisores e aprovações (João vídeo+post, Maria vídeo, Gaby post) ----------
  revisores: proc.query(async ({ ctx }) => {
    const lista = await lerRevisores()
    const nomes = lista.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, lista.map((r) => r.userId))) : []
    const eu = lista.find((r) => r.userId === ctx.user.id)
    return { lista: lista.map((r, i) => ({ ...r, nome: nomes.find((n) => n.id === r.userId)?.name || `#${r.userId}`, ordem: i })), eu: { video: !!eu?.video, post: !!eu?.post } }
  }),
  salvarRevisores: superAdminProcedure.input(z.object({ lista: z.array(z.object({ userId: z.number().int(), video: z.boolean(), post: z.boolean() })).max(12) })).mutation(async ({ input }) => {
    await salvarRevisores(input.lista)
    return { ok: true }
  }),
  enviarAprovacaoRoteiro: proc.input(z.object({ pecaId: z.string() })).mutation(async ({ ctx, input }) => {
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    if ((p.roteiro || '').trim().length < 20) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o roteiro antes de mandar para aprovação.' })
    await db.update(mktPecas).set({ status: 'Aprovação do roteiro', updatedAt: agoraSql() }).where(eq(mktPecas.id, p.id))
    await marcarQuemEtapa(p.id, ctx.user.name)
    await db.insert(mktPecaComentarios).values({ pecaId: p.id, tipo: 'comentario', autorId: ctx.user.id, autorNome: ctx.user.name, texto: 'Mandou o roteiro para aprovação.' })
    return { ok: true }
  }),
  versoes: proc.input(z.object({ pecaId: z.string() })).query(async ({ input }) =>
    db.select().from(mktPecaVersoes).where(eq(mktPecaVersoes.pecaId, input.pecaId)).orderBy(mktPecaVersoes.id)),
  // Revisor edita o roteiro (cada mudança fica numa versão, para pintar de
  // outra cor), aprova (libera para gravação) ou pede ajuste.
  revisarRoteiro: proc.input(z.object({ pecaId: z.string(), roteiro: z.string().max(20000).optional(), acao: z.enum(['salvar', 'aprovar', 'ajuste']), texto: z.string().max(3000).optional() })).mutation(async ({ ctx, input }) => {
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    if (!(await podeRevisar(ctx.user.id, p.tipo))) throw new TRPCError({ code: 'FORBIDDEN', message: p.tipo === 'Post' ? 'Você não revisa posts.' : 'Você não revisa vídeos.' })
    if (input.acao === 'ajuste' && !(input.texto || '').trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o que precisa ajustar.' })
    const set: Record<string, unknown> = { updatedAt: agoraSql() }
    if (input.roteiro !== undefined && input.roteiro !== p.roteiro) {
      const ult = await db.select().from(mktPecaVersoes).where(eq(mktPecaVersoes.pecaId, p.id)).orderBy(desc(mktPecaVersoes.id)).limit(1)
      // Guarda o texto de antes (de quem escreveu) se ele ainda não está nas versões.
      if (!ult.length || ult[0].roteiro !== p.roteiro) await db.insert(mktPecaVersoes).values({ pecaId: p.id, roteiro: p.roteiro, autorNome: ult.length ? 'Equipe (mudança fora da revisão)' : 'Texto original', revisor: false })
      await db.insert(mktPecaVersoes).values({ pecaId: p.id, roteiro: input.roteiro, autorId: ctx.user.id, autorNome: ctx.user.name, revisor: true })
      set.roteiro = input.roteiro
    }
    if (input.acao === 'aprovar') Object.assign(set, { status: 'Produção', roteiroAprovadoEm: agoraSql(), roteiroAprovadoPor: ctx.user.name, aprovadoEm: agoraSql(), aprovadoPor: ctx.user.id })
    if (input.acao === 'ajuste') Object.assign(set, { status: 'Roteiro', roteiroAprovadoEm: null, roteiroAprovadoPor: null })
    await db.update(mktPecas).set(set).where(eq(mktPecas.id, p.id))
    if (input.acao !== 'salvar') await marcarQuemEtapa(p.id, ctx.user.name)
    if (input.acao !== 'salvar') await db.insert(mktPecaComentarios).values({ pecaId: p.id, tipo: input.acao === 'aprovar' ? 'aprovado' : 'ajuste', autorId: ctx.user.id, autorNome: ctx.user.name, texto: input.acao === 'aprovar' ? `Roteiro aprovado — liberado para gravação.${input.texto ? ' ' + input.texto : ''}` : input.texto || '' })
    return { ok: true }
  }),
  aprovarFinal: proc.input(z.object({ pecaId: z.string(), acao: z.enum(['aprovar', 'ajuste']), texto: z.string().max(3000).optional() })).mutation(async ({ ctx, input }) => {
    const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, input.pecaId) })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Peça não encontrada.' })
    if (!(await podeRevisar(ctx.user.id, p.tipo))) throw new TRPCError({ code: 'FORBIDDEN', message: p.tipo === 'Post' ? 'Você não revisa posts.' : 'Você não revisa vídeos.' })
    if (input.acao === 'ajuste' && !(input.texto || '').trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escreva o que precisa ajustar.' })
    if (input.acao === 'aprovar') {
      if (!lerAnexos(p.anexos).length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A peça não tem o vídeo/arte anexado.' })
      await db.update(mktPecas).set({ finalAprovadoEm: agoraSql(), finalAprovadoPor: ctx.user.name, status: p.status === 'Agendado na mLabs' ? p.status : 'Aprovação final', updatedAt: agoraSql() }).where(eq(mktPecas.id, p.id))
    } else {
      await db.update(mktPecas).set({ finalAprovadoEm: null, finalAprovadoPor: null, status: 'Produção', updatedAt: agoraSql() }).where(eq(mktPecas.id, p.id))
    }
    await marcarQuemEtapa(p.id, ctx.user.name)
    await db.insert(mktPecaComentarios).values({ pecaId: p.id, tipo: input.acao === 'aprovar' ? 'aprovado' : 'ajuste', autorId: ctx.user.id, autorNome: ctx.user.name, texto: input.acao === 'aprovar' ? `Aprovação final — pode agendar na mLabs.${input.texto ? ' ' + input.texto : ''}` : input.texto || '' })
    return { ok: true }
  }),
})
