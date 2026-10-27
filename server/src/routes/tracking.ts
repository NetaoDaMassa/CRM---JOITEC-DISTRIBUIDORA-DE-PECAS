import express from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, leadTrackingVisitors, leadTrackingEvents } from '../db/schema.js'
import { findOrCreateLeadFromTracking, type MetaDadosLead } from '../lib/leadsTrackingService.js'

// Rota pública — chamada pelo tracker.js embutido nos sites do grupo (Joitec,
// Odin Tubos, Odin Compressores), fora do /trpc porque não há sessão
// autenticada do CRM nesse contexto. Portada do sistema separado
// odin-tubos-crm--master (server/src/routes/tracking.ts), mesmo contrato de
// payload pra não precisar mudar nada nos sites além da URL base
// (NEXT_PUBLIC_CRM_TRACKING_URL) — ver plano da migração fase 2.
export const trackingRouter = express.Router()

// 'meta_ads_lead' — leads do Meta Ads (Instant Forms) que caem numa
// planilha Google via integração nativa do Meta, e de lá um Apps Script
// manda pra cá (sem telefone/nome direto da Meta API, só o que já está na
// planilha). Mesmo contrato dos outros eventos — vira o `source` do lead,
// pra distinguir dos demais nos relatórios. Pedido do João, 2026-10-15.
const EVENT_TYPES = ['page_view', 'click', 'form_submit', 'ebook_download', 'blog_signup', 'meta_ads_lead'] as const
type EventType = (typeof EVENT_TYPES)[number]

const IDENTIFYING_EVENTS: EventType[] = ['form_submit', 'ebook_download', 'blog_signup', 'meta_ads_lead']

// Só aceita texto (corta tamanho) — vem de uma rota pública.
function texto(v: unknown, max = 300): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const t = String(v).trim()
  return t ? t.slice(0, max) : undefined
}

function lerMetaDados(bruto: unknown): MetaDadosLead | undefined {
  if (!bruto || typeof bruto !== 'object') return undefined
  const m = bruto as Record<string, unknown>
  const respostas: Record<string, string> = {}
  if (m.respostas && typeof m.respostas === 'object') {
    for (const [pergunta, resposta] of Object.entries(m.respostas as Record<string, unknown>).slice(0, 40)) {
      const r = texto(resposta, 1000)
      if (r) respostas[pergunta.slice(0, 200)] = r
    }
  }
  return {
    campanha: texto(m.campanha),
    conjunto: texto(m.conjunto),
    anuncio: texto(m.anuncio),
    formulario: texto(m.formulario),
    plataforma: texto(m.plataforma, 40),
    preenchidoEm: texto(m.preenchidoEm, 60),
    respostas,
  }
}

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
    // company/message só vêm preenchidos hoje pelo Apps Script do Meta Ads
    // (ver instruções dadas ao João, 2026-10-15) — o tracker.js do site não
    // manda esses campos, então ficam undefined pros eventos normais.
    const company = typeof metadata.company === 'string' ? metadata.company : undefined
    const message = typeof metadata.message === 'string' ? metadata.message : undefined
    // Script novo do Meta Ads (2026-10-27): cidade, CNPJ e o bloco `meta`
    // (campanha/conjunto/anúncio/formulário/plataforma + todas as respostas
    // do formulário). O script antigo mandava o CNPJ em `company` — se
    // `company` tiver 14 dígitos, trata como CNPJ também.
    const city = typeof metadata.city === 'string' ? metadata.city : undefined
    const cnpj =
      typeof metadata.cnpj === 'string'
        ? metadata.cnpj
        : company && company.replace(/\D/g, '').length === 14
          ? company
          : undefined
    const metaDados = eventType === 'meta_ads_lead' ? lerMetaDados(metadata.meta) : undefined

    if (IDENTIFYING_EVENTS.includes(eventType) && phone) {
      const matchedLeadId = await findOrCreateLeadFromTracking({
        empresaId: empresa.id,
        name,
        phone,
        email,
        company,
        observations: message,
        source: eventType,
        utmCampaign: existingVisitor?.utmCampaign ?? utmCampaign ?? metaDados?.campanha ?? undefined,
        city,
        cnpj,
        metaDados,
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
