import crypto from 'node:crypto'
import express from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, leadTrackingVisitors, lojaEventos } from '../db/schema.js'
import { getConfigTexto } from '../lib/configuracoes.js'
import { findOrCreateLeadFromTracking } from '../lib/leadsTrackingService.js'

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
          metadata: e.metadata && typeof e.metadata === 'object' ? JSON.stringify(e.metadata).slice(0, 4000) : null,
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
      if (IDENTIFICAM.has(tipo) && telefone) {
        const leadId = await findOrCreateLeadFromTracking({
          empresaId: empresa.id,
          phone: telefone,
          email: txt(contato.email, 200) ?? undefined,
          name: txt(contato.name, 200) ?? undefined,
          source: `loja_${tipo}`,
          utmCampaign: v.utmCampaign ?? utm.utmCampaign ?? undefined,
          observations: tipo === 'cart_abandoned' || tipo === 'begin_checkout' ? `Loja virtual: ${tipo === 'cart_abandoned' ? 'carrinho abandonado' : 'iniciou o checkout'}${num(e.value) ? ` · R$ ${num(e.value)!.toFixed(2)}` : ''}` : undefined,
        })
        if (leadId && leadId !== v.leadId) {
          await db.update(leadTrackingVisitors).set({ leadId }).where(eq(leadTrackingVisitors.id, v.id))
          v = { ...v, leadId }
          visitante.set(uid, v)
        }
      }
    }
    res.json(r)
  } catch (err) {
    console.error('[loja/eventos]', err)
    res.status(500).json({ error: 'erro ao gravar o lote', ...r })
  }
})
