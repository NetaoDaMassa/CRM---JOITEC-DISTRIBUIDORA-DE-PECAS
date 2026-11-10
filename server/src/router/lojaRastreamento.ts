import crypto from 'node:crypto'
import { z } from 'zod'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { router, featureProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, leads, leadTrackingVisitors, lojaEventos } from '../db/schema.js'
import { getConfigTexto, setConfig } from '../lib/configuracoes.js'
import { itensDe, lerMetadata, pedidoDe, rotuloEventoLoja } from '../lib/lojaResumo.js'

// Tela "Loja virtual" — comportamento dos visitantes da loja nova (pedido do
// João, 2026-11-03), a partir dos eventos que a loja manda em lote
// (routes/lojaEventos.ts). Agrega no servidor; período em dias de Brasília.
const FEATURE = 'loja_rastreamento'

const inicioDia = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString().replace('T', ' ').slice(0, 19)
const fimDia = (d: string) => new Date(`${d}T23:59:59-03:00`).toISOString().replace('T', ' ').slice(0, 19)
const ms = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`)

function dominio(ref: string | null): string | null {
  if (!ref) return null
  try {
    return new URL(ref).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Origem da sessão: UTM; sem UTM, o site de onde veio; sem nada, "Direto".
function origemDe(e: { utmSource: string | null; utmMedium: string | null; referrer: string | null }, dominioLoja: string | null): string {
  if (e.utmSource) return `${e.utmSource}${e.utmMedium ? ` / ${e.utmMedium}` : ''}`
  const d = dominio(e.referrer)
  if (!d || d === dominioLoja) return 'Direto'
  if (/google\./.test(d)) return 'Google (orgânico)'
  if (/facebook|instagram|fb\./.test(d)) return 'Facebook / Instagram'
  if (/mercadolivre|mercadolibre/.test(d)) return 'Mercado Livre'
  return d
}

export const lojaRastreamentoRouter = router({
  // Chave de assinatura da empresa ativa: superAdmin gera e copia pra loja.
  chave: superAdminProcedure.query(async ({ ctx }) => {
    const e = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    return { slug: e?.slug ?? '', configurada: !!(e && (await getConfigTexto(`loja_tracking_secret_${e.slug}`))) }
  }),

  // Gera (ou troca) a chave — devolvida UMA vez, pra colar na loja.
  gerarChave: superAdminProcedure.mutation(async ({ ctx }) => {
    const e = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    if (!e) throw new Error('Empresa não encontrada')
    const chave = crypto.randomBytes(32).toString('hex')
    await setConfig(`loja_tracking_secret_${e.slug}`, chave)
    return { chave, slug: e.slug }
  }),

  resumo: featureProcedure(FEATURE)
    .input(z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const eventos = await db
        .select({
          visitorUid: lojaEventos.visitorUid,
          visitorId: lojaEventos.visitorId,
          sessionId: lojaEventos.sessionId,
          tipo: lojaEventos.eventType,
          quando: lojaEventos.ocorreuEm,
          pagePath: lojaEventos.pagePath,
          pageTitle: lojaEventos.pageTitle,
          pageUrl: lojaEventos.pageUrl,
          referrer: lojaEventos.referrer,
          utmSource: lojaEventos.utmSource,
          utmMedium: lojaEventos.utmMedium,
          sku: lojaEventos.produtoSku,
          produto: lojaEventos.produtoNome,
          valor: lojaEventos.valor,
          duracaoMs: lojaEventos.duracaoMs,
          engajadoMs: lojaEventos.engajadoMs,
          elemento: lojaEventos.elemento,
          metadata: lojaEventos.metadata,
        })
        .from(lojaEventos)
        .where(and(eq(lojaEventos.empresaId, ctx.empresaId), gte(lojaEventos.ocorreuEm, inicioDia(input.de)), lte(lojaEventos.ocorreuEm, fimDia(input.ate))))
        .orderBy(lojaEventos.ocorreuEm)

      const dominioLoja = dominio(eventos.find((e) => e.pageUrl)?.pageUrl ?? null)
      const visitantes = new Set(eventos.map((e) => e.visitorUid))
      const de = (tipo: string) => eventos.filter((e) => e.tipo === tipo)
      const visitantesCom = (tipo: string) => new Set(de(tipo).map((e) => e.visitorUid)).size
      const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

      // Sessões: sem session_id, junta o visitante por dia.
      const sessoes = new Map<string, typeof eventos>()
      for (const e of eventos) {
        const k = e.sessionId ?? `${e.visitorUid}:${e.quando.slice(0, 10)}`
        sessoes.set(k, [...(sessoes.get(k) ?? []), e])
      }
      const duracoesSessao: number[] = []
      const paginasPorSessao: number[] = []
      const saidas = new Map<string, number>()
      const porOrigem = new Map<string, { origem: string; sessoes: number; visitantes: Set<string>; carrinho: number; compras: number; valor: number; leads: Set<number> }>()
      for (const lista of sessoes.values()) {
        const fim = lista[lista.length - 1]
        const fimMs = fim.tipo === 'page_leave' && fim.duracaoMs ? ms(fim.quando) : ms(fim.quando)
        duracoesSessao.push(Math.max(0, fimMs - ms(lista[0].quando)) + (fim.tipo === 'page_leave' ? 0 : 0))
        paginasPorSessao.push(lista.filter((e) => e.tipo === 'page_view').length)
        const ultimaPagina = [...lista].reverse().find((e) => e.pagePath)?.pagePath
        if (ultimaPagina) saidas.set(ultimaPagina, (saidas.get(ultimaPagina) ?? 0) + 1)
        const origem = origemDe(lista[0], dominioLoja)
        const o = porOrigem.get(origem) ?? { origem, sessoes: 0, visitantes: new Set<string>(), carrinho: 0, compras: 0, valor: 0, leads: new Set<number>() }
        o.sessoes++
        o.visitantes.add(lista[0].visitorUid)
        if (lista.some((e) => e.tipo === 'add_to_cart')) o.carrinho++
        for (const c of lista.filter((e) => e.tipo === 'purchase')) {
          o.compras++
          o.valor += c.valor ?? 0
        }
        porOrigem.set(origem, o)
      }

      // Visitantes que viraram lead (telefone) e estiveram no período.
      const idsVisitante = [...new Set(eventos.map((e) => e.visitorId).filter((x): x is number => !!x))]
      const comLead = idsVisitante.length
        ? await db
            .select({ id: leadTrackingVisitors.id, uid: leadTrackingVisitors.visitorUid, leadId: leadTrackingVisitors.leadId, nome: leads.name, telefone: leads.phone, ddd: leads.ddd })
            .from(leadTrackingVisitors)
            .innerJoin(leads, eq(leads.id, leadTrackingVisitors.leadId))
            .where(inArray(leadTrackingVisitors.id, idsVisitante.slice(0, 5000)))
        : []
      const leadPorUid = new Map(comLead.map((c) => [c.uid, c]))
      for (const lista of sessoes.values()) {
        const l = leadPorUid.get(lista[0].visitorUid)
        if (l?.leadId) porOrigem.get(origemDe(lista[0], dominioLoja))?.leads.add(l.leadId)
      }

      // Produtos
      const produtos = new Map<string, { sku: string; nome: string; vistas: number; visitantes: Set<string>; cliques: number; carrinho: number; compras: number; engajado: number[] }>()
      for (const e of eventos) {
        if (!e.sku) continue
        const p = produtos.get(e.sku) ?? { sku: e.sku, nome: e.produto ?? e.sku, vistas: 0, visitantes: new Set<string>(), cliques: 0, carrinho: 0, compras: 0, engajado: [] }
        if (e.produto) p.nome = e.produto
        if (e.tipo === 'product_view') {
          p.vistas++
          p.visitantes.add(e.visitorUid)
        }
        if (e.tipo === 'click') p.cliques++
        if (e.tipo === 'add_to_cart') p.carrinho++
        if (e.tipo === 'purchase') p.compras++
        if (e.tipo === 'page_leave' && e.engajadoMs) p.engajado.push(e.engajadoMs)
        produtos.set(e.sku, p)
      }

      // Páginas
      const paginas = new Map<string, { path: string; titulo: string | null; views: number; engajado: number[]; duracao: number[] }>()
      for (const e of eventos) {
        if (!e.pagePath || (e.tipo !== 'page_view' && e.tipo !== 'page_leave')) continue
        const p = paginas.get(e.pagePath) ?? { path: e.pagePath, titulo: e.pageTitle, views: 0, engajado: [], duracao: [] }
        if (e.tipo === 'page_view') p.views++
        if (e.tipo === 'page_leave') {
          if (e.engajadoMs) p.engajado.push(e.engajadoMs)
          if (e.duracaoMs) p.duracao.push(e.duracaoMs)
        }
        if (!p.titulo && e.pageTitle) p.titulo = e.pageTitle
        paginas.set(e.pagePath, p)
      }

      // Cliques (botão + produto)
      const cliques = new Map<string, { elemento: string; produto: string | null; cliques: number; visitantes: Set<string> }>()
      for (const e of de('click')) {
        const k = `${e.elemento ?? '(sem nome)'}|${e.sku ?? ''}`
        const c = cliques.get(k) ?? { elemento: e.elemento ?? '(sem nome)', produto: e.produto, cliques: 0, visitantes: new Set<string>() }
        c.cliques++
        c.visitantes.add(e.visitorUid)
        cliques.set(k, c)
      }

      // Por dia
      const porDia = new Map<string, { dia: string; visitantes: Set<string>; views: number; compras: number }>()
      for (const e of eventos) {
        const dia = new Date(ms(e.quando) - 3 * 3600_000).toISOString().slice(0, 10)
        const d = porDia.get(dia) ?? { dia, visitantes: new Set<string>(), views: 0, compras: 0 }
        d.visitantes.add(e.visitorUid)
        if (e.tipo === 'page_view') d.views++
        if (e.tipo === 'purchase') d.compras++
        porDia.set(dia, d)
      }

      // Carrinhos abandonados e pedidos — a lista que o vendedor usa pra ligar.
      const nomeLead = new Map(comLead.map((c) => [c.uid, { leadId: c.leadId!, nome: c.nome, telefone: c.telefone ? `(${c.ddd}) ${c.telefone}` : null }]))
      const metaDe = new Map<(typeof eventos)[number], Record<string, unknown>>()
      const meta = (e: (typeof eventos)[number]) => {
        if (!metaDe.has(e)) metaDe.set(e, lerMetadata(e.metadata))
        return metaDe.get(e)!
      }
      const contatoDe = (m: Record<string, unknown>) => {
        const c = (m.contact && typeof m.contact === 'object' ? m.contact : {}) as Record<string, unknown>
        return { nome: typeof c.name === 'string' ? c.name : null, email: typeof c.email === 'string' ? c.email : null }
      }
      const compraram = new Set(de('purchase').map((e) => e.visitorUid))
      const carrinhos = de('cart_abandoned')
        .filter((e) => meta(e).store_event !== 'payment_failed' && (!meta(e).stage || meta(e).stage === 1))
        .map((e) => {
          const m = meta(e)
          return {
            quando: e.quando,
            valor: e.valor,
            itens: itensDe(m),
            link: typeof m.recovery_url === 'string' ? m.recovery_url : null,
            lead: nomeLead.get(e.visitorUid) ?? null,
            email: contatoDe(m).email,
            comprouDepois: compraram.has(e.visitorUid) && de('purchase').some((p) => p.visitorUid === e.visitorUid && p.quando > e.quando),
          }
        })
        .sort((a, b) => b.quando.localeCompare(a.quando))
        .slice(0, 60)
      const pedidosMap = new Map<string, { numero: string; quando: string; situacao: string; total: number | null; pagamento: string | null; cidade: string | null; itens: ReturnType<typeof itensDe>; lead: ReturnType<typeof nomeLead.get> | null }>()
      for (const e of eventos) {
        if (!['begin_checkout', 'purchase', 'cart_abandoned'].includes(e.tipo)) continue
        const m = meta(e)
        const p = pedidoDe(m)
        if (!p?.numero) continue
        const situacao = e.tipo === 'purchase' ? 'Pago' : m.store_event === 'payment_failed' ? 'Pagamento não concluído' : 'Aguardando pagamento'
        const atual = pedidosMap.get(p.numero)
        if (atual && atual.situacao === 'Pago') continue
        pedidosMap.set(p.numero, {
          numero: p.numero,
          quando: atual?.quando ?? e.quando,
          situacao,
          total: p.total ?? e.valor,
          pagamento: p.pagamento ? `${p.pagamento}${p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x` : ''}` : null,
          cidade: p.cidade ? `${p.cidade}/${p.uf ?? ''}` : null,
          itens: p.itens,
          lead: nomeLead.get(e.visitorUid) ?? null,
        })
      }
      const pedidos = [...pedidosMap.values()].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 60)

      // Buscas: a loja manda enquanto a pessoa digita; conta só o termo mais completo de cada sessão.
      const termosPorSessao = new Map<string, Set<string>>()
      for (const e of de('search')) {
        const t = meta(e).search_term
        if (typeof t !== 'string' || t.trim().length < 2) continue
        const k = e.sessionId ?? e.visitorUid
        termosPorSessao.set(k, (termosPorSessao.get(k) ?? new Set()).add(t.trim().toLowerCase()))
      }
      const buscasCont = new Map<string, number>()
      for (const termos of termosPorSessao.values()) {
        const lista = [...termos]
        for (const t of lista.filter((t) => !lista.some((o) => o !== t && o.startsWith(t)))) buscasCont.set(t, (buscasCont.get(t) ?? 0) + 1)
      }
      const buscas = [...buscasCont.entries()].map(([termo, vezes]) => ({ termo, vezes })).sort((a, b) => b.vezes - a.vezes).slice(0, 30)

      // Últimas ações (sem "saiu da página", que é ruído)
      const recentes = eventos
        .filter((e) => e.tipo !== 'page_leave')
        .slice(-40)
        .reverse()
        .map((e) => ({
          quando: e.quando,
          tipo: (meta(e).store_event as string) || e.tipo,
          rotulo: rotuloEventoLoja(e.tipo, meta(e)),
          produto: e.produto,
          pagina: e.pageTitle ?? e.pagePath,
          valor: e.valor,
          visitante: e.visitorUid.slice(-5),
          lead: nomeLead.get(e.visitorUid) ?? null,
        }))
      const agoraMs = Date.now()
      const naLojaAgora = new Set(eventos.filter((e) => agoraMs - ms(e.quando) < 5 * 60_000).map((e) => e.visitorUid)).size

      const ultimoPorUid = new Map<string, string>()
      for (const e of eventos) ultimoPorUid.set(e.visitorUid, e.quando)
      return {
        totais: {
          visitantes: visitantes.size,
          sessoes: sessoes.size,
          paginasVistas: de('page_view').length,
          tempoMedioPaginaMs: media(de('page_leave').map((e) => e.engajadoMs ?? e.duracaoMs ?? 0).filter((x) => x > 0)),
          tempoMedioSessaoMs: media(duracoesSessao),
          paginasPorSessao: media(paginasPorSessao),
          leads: new Set(comLead.map((c) => c.leadId)).size,
          compras: de('purchase').length,
          valorCompras: de('purchase').reduce((s, e) => s + (e.valor ?? 0), 0),
          carrinhosAbandonados: carrinhos.length,
          valorCarrinhosAbandonados: carrinhos.filter((c) => !c.comprouDepois).reduce((s, c) => s + (c.valor ?? 0), 0),
          pedidosFeitos: pedidosMap.size,
          naLojaAgora,
        },
        carrinhos,
        pedidos,
        buscas,
        recentes,
        funil: [
          { etapa: 'Visitaram a loja', visitantes: visitantes.size },
          { etapa: 'Viram um produto', visitantes: visitantesCom('product_view') },
          { etapa: 'Puseram no carrinho', visitantes: visitantesCom('add_to_cart') },
          { etapa: 'Deixaram o contato', visitantes: new Set([...de('lead'), ...de('signup'), ...de('begin_checkout')].map((e) => e.visitorUid)).size },
          { etapa: 'Fizeram pedido', visitantes: visitantesCom('begin_checkout') },
          { etapa: 'Compraram', visitantes: visitantesCom('purchase') },
        ],
        produtos: [...produtos.values()]
          .map((p) => ({ sku: p.sku, nome: p.nome, vistas: p.vistas, visitantes: p.visitantes.size, cliques: p.cliques, carrinho: p.carrinho, compras: p.compras, engajadoMedioMs: media(p.engajado) }))
          .sort((a, b) => b.vistas - a.vistas || b.cliques - a.cliques)
          .slice(0, 50),
        paginas: [...paginas.values()]
          .map((p) => ({ path: p.path, titulo: p.titulo, views: p.views, engajadoMedioMs: media(p.engajado), duracaoMediaMs: media(p.duracao), saidas: saidas.get(p.path) ?? 0 }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 50),
        origens: [...porOrigem.values()]
          .map((o) => ({ origem: o.origem, sessoes: o.sessoes, visitantes: o.visitantes.size, carrinho: o.carrinho, compras: o.compras, valor: o.valor, leads: o.leads.size }))
          .sort((a, b) => b.sessoes - a.sessoes),
        cliques: [...cliques.values()]
          .map((c) => ({ elemento: c.elemento, produto: c.produto, cliques: c.cliques, visitantes: c.visitantes.size }))
          .sort((a, b) => b.cliques - a.cliques)
          .slice(0, 40),
        porDia: [...porDia.values()].map((d) => ({ dia: d.dia, visitantes: d.visitantes.size, views: d.views, compras: d.compras })).sort((a, b) => a.dia.localeCompare(b.dia)),
        identificados: comLead
          .map((c) => ({ leadId: c.leadId!, nome: c.nome, telefone: c.telefone ? `(${c.ddd}) ${c.telefone}` : null, ultimaVisita: ultimoPorUid.get(c.uid) ?? null, eventos: eventos.filter((e) => e.visitorUid === c.uid).length }))
          .sort((a, b) => (b.ultimaVisita ?? '').localeCompare(a.ultimaVisita ?? ''))
          .slice(0, 50),
      }
    }),
})
