import express from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, leadTrackingVisitors, leadTrackingEvents } from '../db/schema.js'
import { findOrCreateLeadFromTracking } from '../lib/leadsTrackingService.js'

// Rota pública — chamada pelo tracker.js embutido nos sites do grupo (Joitec,
// Odin Tubos, Odin Compressores), fora do /trpc porque não há sessão
// autenticada do CRM nesse contexto. Portada do sistema separado
// odin-tubos-crm--master (server/src/routes/tracking.ts), mesmo contrato de
// payload pra não precisar mudar nada nos sites além da URL base
// (NEXT_PUBLIC_CRM_TRACKING_URL) — ver plano da migração fase 2.
export const trackingRouter = express.Router()

const EVENT_TYPES = ['page_view', 'click', 'form_submit', 'ebook_download', 'blog_signup'] as const
type EventType = (typeof EVENT_TYPES)[number]

const IDENTIFYING_EVENTS: EventType[] = ['form_submit', 'ebook_download', 'blog_signup']

trackingRouter.post('/events', async (req, res) => {
  const {
    company_id: empresaSlug,
    visitor_uid: visitorUid,
    event_type: eventType,
    page_url: pageUrl,
    page_title: pageTitle,
    metadata = {},
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  } = req.body ?? {}

  if (!empresaSlug || !visitorUid || !eventType) {
    return res.status(400).json({ error: 'company_id, visitor_uid e event_type são obrigatórios' })
  }
  if (!EVENT_TYPES.includes(eventType)) {
    return res.status(400).json({ error: 'event_type inválido' })
  }

  try {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, empresaSlug) })
    if (!empresa) return res.status(400).json({ error: 'company_id desconhecido' })

    const existingVisitor = await db.query.leadTrackingVisitors.findFirst({
      where: and(eq(leadTrackingVisitors.empresaId, empresa.id), eq(leadTrackingVisitors.visitorUid, visitorUid)),
    })

    let visitorId: number
    let leadId: number | null

    if (existingVisitor) {
      visitorId = existingVisitor.id
      leadId = existingVisitor.leadId
      await db
        .update(leadTrackingVisitors)
        .set({
          lastSeenAt: new Date().toISOString(),
          utmSource: existingVisitor.utmSource ?? utmSource ?? null,
          utmMedium: existingVisitor.utmMedium ?? utmMedium ?? null,
          utmCampaign: existingVisitor.utmCampaign ?? utmCampaign ?? null,
        })
        .where(eq(leadTrackingVisitors.id, visitorId))
    } else {
      const inserted = await db.insert(leadTrackingVisitors).values({
        empresaId: empresa.id,
        visitorUid,
        utmSource: utmSource ?? null,
        utmMedium: utmMedium ?? null,
        utmCampaign: utmCampaign ?? null,
      })
      visitorId = Number(inserted.lastInsertRowid)
      leadId = null
    }

    await db.insert(leadTrackingEvents).values({
      visitorId,
      empresaId: empresa.id,
      eventType,
      pageUrl: pageUrl ?? null,
      pageTitle: pageTitle ?? null,
      metadata: JSON.stringify(metadata ?? {}),
    })

    const phone = typeof metadata.phone === 'string' ? metadata.phone : undefined
    const email = typeof metadata.email === 'string' ? metadata.email : undefined
    const name = typeof metadata.name === 'string' ? metadata.name : undefined

    if (IDENTIFYING_EVENTS.includes(eventType) && phone) {
      const matchedLeadId = await findOrCreateLeadFromTracking({
        empresaId: empresa.id,
        name,
        phone,
        email,
        source: eventType,
        utmCampaign: existingVisitor?.utmCampaign ?? utmCampaign ?? undefined,
      })
      if (matchedLeadId && matchedLeadId !== leadId) {
        await db.update(leadTrackingVisitors).set({ leadId: matchedLeadId }).where(eq(leadTrackingVisitors.id, visitorId))
      }
    }

    res.status(201).json({ ok: true })
  } catch (err) {
    console.error('[tracking/events]', err)
    res.status(500).json({ error: 'erro ao processar evento' })
  }
})

// Script embutido nos sites via <script src=".../tracker.js" data-company="joitec">.
// Servido como texto puro (em vez de arquivo estático) pra não depender de
// copiar mais uma pasta no Dockerfile — conteúdo idêntico ao
// odin-tubos-crm--master/server/public/tracker.js. A URL da API é resolvida
// pelo próprio script relativa ao <script src>, então nunca tem domínio
// hardcoded aqui — funciona igual em qualquer host que sirva este arquivo.
export const TRACKER_JS = `(function () {
  const scriptTag = document.currentScript;
  const companyId = scriptTag.dataset.company;
  const endpoint = new URL('/api/tracking/events', scriptTag.src).toString();

  function getVisitorUid() {
    let uid = localStorage.getItem('odin_visitor_uid');
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem('odin_visitor_uid', uid);
    }
    return uid;
  }

  function getUtm(param) {
    return new URLSearchParams(window.location.search).get(param) || undefined;
  }

  function send(eventType, metadata) {
    metadata = metadata || {};
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        company_id: companyId,
        visitor_uid: getVisitorUid(),
        event_type: eventType,
        page_url: window.location.href,
        page_title: document.title,
        metadata: metadata,
        utm_source: getUtm('utm_source'),
        utm_medium: getUtm('utm_medium'),
        utm_campaign: getUtm('utm_campaign'),
      }),
    }).catch(function () {}); // tracking nunca deve travar a experiência do usuário
  }

  // page view automático
  send('page_view');

  // clicks em elementos marcados com data-track
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-track]');
    if (el) send('click', { track_id: el.dataset.track, text: el.textContent.trim().slice(0, 80) });
  });

  // formulários marcados com data-track-form
  document.addEventListener('submit', function (e) {
    const form = e.target.closest('[data-track-form]');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const phone = data.telefone || data.phone || data.whatsapp || data.celular;
    if (!phone) return; // sem telefone não dá pra criar/vincular lead (name/email sozinhos não bastam)
    send(form.dataset.trackForm || 'form_submit', {
      email: data.email,
      phone: phone,
      name: data.nome || data.name,
    });
  });

  // downloads de ebook: <a data-track-ebook="guia-compressores" href="...">
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-track-ebook]');
    if (el) send('ebook_download', { ebook: el.dataset.trackEbook });
  });

  window.odinTrack = send; // permite disparo manual, ex: odinTrack('blog_signup', {email})
})();
`
