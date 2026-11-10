import crypto from 'node:crypto'
import express from 'express'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, leadHistory, leads, leadTrackingVisitors, lojaEventos, notifications } from '../db/schema.js'
import { getConfigTexto } from '../lib/configuracoes.js'
import { findOrCreateLeadFromTrackingDetalhado } from '../lib/leadsTrackingService.js'
import { eventoQuente, lerMetadata, resumoEventoLoja } from '../lib/lojaResumo.js'

// Rastreamento da loja virtual nova (Compretec) → CRM, em lotes assinados —
// contrato combinado com a sessão da loja em 2026-11-03 (pedido do João):
//
//   POST /api/loja/eventos
//   X-Loja-Timestamp: <segundos unix>
//   X-Loja-Signature: sha256=<hex HMAC-SHA256(chave, "<timestamp>.<corpo cru>")>
//   { "company_id": "compretec-ecommerce", "events": [ ...até 500 ] }
//
// Cada evento: event_id (único, reenvio não duplica), visitor_uid
// (anonymous_id da loja), session_id, event_type, occurred_at (ISO), page_url,
// page_title, referrer, utm_source/medium/campaign, product {sku, name,
// price}, value, duration_ms, engaged_ms, element, contact {phone, email,
// name}, metadata. A chave é da empresa (config `loja_tracking_secret_<slug>`,
// gerada na tela Loja virtual → Configuração). Fica fora do express.json()
// global (index.ts) porque a assinatura é sobre o corpo cru.
export const lojaEventosRouter = express.Router()

const TIPOS = [
  'page_view',
  'page_leave',
  'click',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'begin_checkout',
  'purchase',
  'search',
  'lead',
  'form_submit',
  'signup',
  'cart_abandoned',
] as const
// Eventos em que o visitante deixou contato — viram/ligam lead no CRM.
const IDENTIFICAM = new Set(['lead', 'form_submit', 'signup', 'begin_checkout', 'purchase', 'cart_abandoned'])
const MAX_LOTE = 500
const JANELA_SEGUNDOS = 15 * 60

const txt = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const t = String(v).trim()
  return t ? t.slice(0, max) : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

function assinaturaOk(corpo: Buffer, timestamp: string | undefined, assinatura: string | undefined, chave: string): boolean {
  if (!timestamp || !assinatura) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > JANELA_SEGUNDOS) return false
  const esperada = `sha256=${crypto.createHmac('sha256', chave).update(`${timestamp}.`).update(corpo).digest('hex')}`
  const a = Buffer.from(esperada)
  const b = Buffer.from(assinatura.trim())
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function paraUtcSqlite(v: unknown): string {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  const ok = d && !Number.isNaN(d.getTime()) ? d : new Date()
  return ok.toISOString().replace('T', ' ').slice(0, 19)
}

function caminho(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname.slice(0, 300)
  } catch {
    return url.split('?')[0].slice(0, 300)
  }
}

// Pedido grande não pode virar JSON cortado no meio (antes cortava em 4000
// caracteres): tira o que é menos útil até caber.
function metadataJson(m: unknown): string | null {
  if (!m || typeof m !== 'object') return null
  let j = JSON.stringify(m)
  if (j.length <= 30000) return j
  const { items: _i, ...semItens } = m as Record<string, unknown>
  j = JSON.stringify(semItens)
  return j.length <= 30000 ? j : JSON.stringify({ store_event: (m as Record<string, unknown>).store_event ?? null, cortado: true })
}

lojaEventosRouter.post('/eventos', async (req, res) => {
  const corpo: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
  let dados: { company_id?: unknown; events?: unknown }
  try {
    dados = JSON.parse(corpo.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }
  const slug = txt(dados.company_id, 60)
  const empresa = slug ? await db.query.empresas.findFirst({ where: eq(empresas.slug, slug) }) : null
  if (!empresa) return res.status(400).json({ error: 'company_id desconhecido' })
  const chave = await getConfigTexto(`loja_tracking_secret_${empresa.slug}`)
  if (!chave) return res.status(503).json({ error: 'chave da loja ainda não foi gerada no CRM' })
  if (!assinaturaOk(corpo, req.header('x-loja-timestamp'), req.header('x-loja-signature'), chave)) {
    return res.status(401).json({ error: 'assinatura inválida ou expirada' })
  }
  const eventos = Array.isArray(dados.events) ? (dados.events as Record<string, unknown>[]) : []
  if (eventos.length > MAX_LOTE) return res.status(413).json({ error: `máximo de ${MAX_LOTE} eventos por lote` })

  const r = { recebidos: eventos.length, novos: 0, duplicados: 0, invalidos: 0, erros: [] as { index: number; error: string }[] }
  try {
    // Visitantes do lote (um upsert por visitante, não por evento).
    const uids = [...new Set(eventos.map((e) => txt(e?.visitor_uid, 120)).filter((x): x is string => !!x))]
    const existentes = uids.length
      ? await db.query.leadTrackingVisitors.findMany({ where: and(eq(leadTrackingVisitors.empresaId, empresa.id), inArray(leadTrackingVisitors.visitorUid, uids)) })
      : []
    const visitante = new Map(existentes.map((v) => [v.visitorUid, v]))
    const agora = new Date().toISOString()

    for (const [i, e] of eventos.entries()) {
      const eventId = txt(e?.event_id, 120)
      const uid = txt(e?.visitor_uid, 120)
      const tipo = txt(e?.event_type, 40)
      if (!eventId || !uid || !tipo || !(TIPOS as readonly string[]).includes(tipo)) {
        r.invalidos++
        if (r.erros.length < 20) r.erros.push({ index: i, error: !eventId || !uid ? 'event_id e visitor_uid são obrigatórios' : `event_type inválido: ${tipo}` })
        continue
      }
      const utm = { utmSource: txt(e.utm_source, 120), utmMedium: txt(e.utm_medium, 120), utmCampaign: txt(e.utm_campaign, 200) }
      let v = visitante.get(uid)
      if (!v) {
        const ins = await db.insert(leadTrackingVisitors).values({ empresaId: empresa.id, visitorUid: uid, ...utm }).onConflictDoNothing()
        v =
          (ins.rowsAffected ? await db.query.leadTrackingVisitors.findFirst({ where: eq(leadTrackingVisitors.id, Number(ins.lastInsertRowid)) }) : null) ??
          (await db.query.leadTrackingVisitors.findFirst({ where: and(eq(leadTrackingVisitors.empresaId, empresa.id), eq(leadTrackingVisitors.visitorUid, uid)) }))!
        visitante.set(uid, v)
      }
      const produto = (e.product && typeof e.product === 'object' ? e.product : {}) as Record<string, unknown>
      const pageUrl = txt(e.page_url, 600)
      const ins = await db
        .insert(lojaEventos)
        .values({
          empresaId: empresa.id,
          eventId,
          visitorId: v.id,
          visitorUid: uid,
          sessionId: txt(e.session_id, 120),
          eventType: tipo,
          ocorreuEm: paraUtcSqlite(e.occurred_at),
          pageUrl,
          pagePath: caminho(pageUrl),
          pageTitle: txt(e.page_title),
          referrer: txt(e.referrer, 600),
          ...utm,
          produtoSku: txt(produto.sku, 80),
          produtoNome: txt(produto.name, 300),
          produtoPreco: num(produto.price),
          valor: num(e.value),
          duracaoMs: num(e.duration_ms),
          engajadoMs: num(e.engaged_ms),
          elemento: txt(e.element, 200),
          metadata: metadataJson(e.metadata),
        })
        .onConflictDoNothing()
      if (!ins.rowsAffected) {
        r.duplicados++
        continue
      }
      r.novos++

      // Primeiro toque (UTM) fica; última visita atualiza.
      await db
        .update(leadTrackingVisitors)
        .set({ lastSeenAt: agora, utmSource: v.utmSource ?? utm.utmSource, utmMedium: v.utmMedium ?? utm.utmMedium, utmCampaign: v.utmCampaign ?? utm.utmCampaign })
        .where(eq(leadTrackingVisitors.id, v.id))

      const contato = (e.contact && typeof e.contact === 'object' ? e.contact : {}) as Record<string, unknown>
      const telefone = txt(contato.phone, 40)
      const email = txt(contato.email, 200)?.toLowerCase() ?? null
      if (!IDENTIFICAM.has(tipo) || (!telefone && !email)) continue
      const meta = lerMetadata(metadataJson(e.metadata))
      const resumo = resumoEventoLoja(tipo, meta, num(e.value))

      // Com telefone: acha ou cria o lead (rodízio por DDD). Só e-mail: liga
      // a um lead que já existe com esse e-mail (o CRM não cria lead sem telefone).
      let lead: { id: number; criado: boolean; vendorId: number | null } | null = null
      if (telefone) {
        lead = await findOrCreateLeadFromTrackingDetalhado({
          empresaId: empresa.id,
          phone: telefone,
          email: email ?? undefined,
          name: txt(contato.name, 200) ?? undefined,
          source: `loja_${tipo}`,
          utmCampaign: v.utmCampaign ?? utm.utmCampaign ?? undefined,
          observations: `Loja virtual: ${resumo}`,
        })
      }
      if (!lead && email) {
        const porEmail = await db.query.leads.findFirst({
          where: and(eq(leads.empresaId, empresa.id), eq(leads.email, email), isNull(leads.deletedAt)),
          columns: { id: true, vendorId: true },
        })
        if (porEmail) lead = { id: porEmail.id, criado: false, vendorId: porEmail.vendorId ?? null }
      }
      if (!lead) continue
      if (lead.id !== v.leadId) {
        await db.update(leadTrackingVisitors).set({ leadId: lead.id }).where(eq(leadTrackingVisitors.id, v.id))
        v = { ...v, leadId: lead.id }
        visitante.set(uid, v)
      }

      // Lead que já existia e fez algo importante na loja: linha no
      // histórico + aviso pro vendedor dele (o lead novo já é avisado na criação).
      if (!lead.criado && eventoQuente(tipo, meta)) {
        await db.insert(leadHistory).values({ empresaId: empresa.id, leadId: lead.id, action: 'loja_virtual', details: resumo })
        if (lead.vendorId) {
          const nome = txt(contato.name, 200) ?? 'Seu lead'
          await db.insert(notifications).values({
            vendedorId: lead.vendorId,
            leadId: lead.id,
            type: 'loja_virtual',
            title: tipo === 'purchase' ? '🛒 Lead comprou na loja virtual' : '🛒 Lead ativo na loja virtual',
            message: `${nome}: ${resumo}`.slice(0, 600),
          })
        }
      }
    }
    res.json(r)
  } catch (err) {
    console.error('[loja/eventos]', err)
    res.status(500).json({ error: 'erro ao gravar o lote', ...r })
  }
})
