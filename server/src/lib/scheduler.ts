import cron from 'node-cron'
import { and, eq, isNull, lte, ne, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications, users } from '../db/schema.js'
import { assignNextVendor } from './roundrobin.js'
import { businessHoursElapsedMs } from './businessHours.js'

const CRON_EXPRESSION = '*/5 * * * *'

const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS
const TWO_DAYS_MS = 2 * ONE_DAY_MS
const THREE_DAYS_MS = 3 * ONE_DAY_MS

const FOUR_BUSINESS_HOURS_MS = 4 * ONE_HOUR_MS
const TWELVE_BUSINESS_HOURS_MS = 12 * ONE_HOUR_MS
// 16h úteis (não 24h): dentro de uma janela de 48h corridas (seg-sex, 8h-18h) o máximo
// possível são 20h úteis, então um limiar de 24h nunca seria alcançado antes da regra
// de 48h corridas (revertStaleAbordagemLeads) já ter revertido o lead pra "Novo".
const SIXTEEN_BUSINESS_HOURS_MS = 16 * ONE_HOUR_MS

function isoMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function statusChangedCutoff(ms: number) {
  const cutoff = isoMinusMs(ms)
  // statusChangedAt pode ser nulo em leads antigos: nesse caso cai no fallback updatedAt
  return or(lte(leads.statusChangedAt, cutoff), and(isNull(leads.statusChangedAt), lte(leads.updatedAt, cutoff)))
}

function stageStartedAt(lead: { statusChangedAt: string | null; updatedAt: string }): string {
  return lead.statusChangedAt ?? lead.updatedAt
}

function noAttemptsYet(lead: { attemptCount: number | null }): boolean {
  return !lead.attemptCount || lead.attemptCount === 0
}

async function notifyIdleNovoLeads() {
  const idleLeads = await db.query.leads.findMany({
    where: and(eq(leads.status, 'novo'), isNull(leads.idleAlertSentAt), statusChangedCutoff(ONE_HOUR_MS)),
  })

  for (const lead of idleLeads) {
    if (!lead.vendorId) continue

    await db.insert(notifications).values({
      vendorId: lead.vendorId,
      leadId: lead.id,
      type: 'lead_idle_1h',
      title: 'Lead parado há 1 hora',
      message: `O lead "${lead.name}" está em "Novo" há mais de 1 hora sem contato.`,
    })

    await db.update(leads).set({ idleAlertSentAt: new Date().toISOString() }).where(eq(leads.id, lead.id))
  }
}

async function reassignIdleNovoLeads() {
  const idleLeads = await db.query.leads.findMany({
    where: and(eq(leads.status, 'novo'), isNull(leads.autoReassignedAt), statusChangedCutoff(ONE_DAY_MS)),
  })

  for (const lead of idleLeads) {
    if (!lead.vendorId || !lead.regionId) continue

    const now = new Date().toISOString()
    const newVendorId = await assignNextVendor(lead.regionId)

    if (newVendorId && newVendorId !== lead.vendorId) {
      await db
        .update(leads)
        .set({ vendorId: newVendorId, assignedAt: now, autoReassignedAt: now })
        .where(eq(leads.id, lead.id))

      await db.insert(leadHistory).values({
        leadId: lead.id,
        userId: null,
        action: 'reatribuicao_automatica',
        fromStatus: 'novo',
        toStatus: 'novo',
        fromVendorId: lead.vendorId,
        toVendorId: newVendorId,
        details: `Reatribuído automaticamente por inatividade de 24h em "Novo" (vendedor anterior #${lead.vendorId})`,
      })

      await db.insert(notifications).values({
        vendorId: newVendorId,
        leadId: lead.id,
        type: 'lead_reassigned',
        title: 'Novo lead atribuído automaticamente',
        message: `O lead "${lead.name}" foi atribuído a você por rodízio após ficar parado em "Novo".`,
      })
    } else {
      // Sem outro vendedor ativo disponível: mantém com o mesmo vendedor,
      // só marca como processado para não reprocessar a cada 5 minutos.
      await db.update(leads).set({ autoReassignedAt: now }).where(eq(leads.id, lead.id))
    }
  }
}

async function notifyAbordagemFirstContactPending() {
  const candidates = await db.query.leads.findMany({
    where: and(
      eq(leads.status, 'abordagem'),
      isNull(leads.abordagem4hAlertSentAt),
      statusChangedCutoff(FOUR_BUSINESS_HOURS_MS)
    ),
  })

  for (const lead of candidates) {
    if (!lead.vendorId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < FOUR_BUSINESS_HOURS_MS) continue

    await db.insert(notifications).values({
      vendorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_first_contact_pending',
      title: 'Lead aguardando 1º contato',
      message: `O lead "${lead.name}" está em "Abordagem" há 4h úteis sem nenhuma tentativa de contato.`,
    })

    await db.update(leads).set({ abordagem4hAlertSentAt: new Date().toISOString() }).where(eq(leads.id, lead.id))
  }
}

async function notifyAbordagemEmRisco() {
  const candidates = await db.query.leads.findMany({
    where: and(eq(leads.status, 'abordagem'), isNull(leads.slaStatus), statusChangedCutoff(TWELVE_BUSINESS_HOURS_MS)),
  })

  for (const lead of candidates) {
    if (!lead.vendorId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < TWELVE_BUSINESS_HOURS_MS) continue

    await db.update(leads).set({ slaStatus: 'em_risco' }).where(eq(leads.id, lead.id))

    await db.insert(notifications).values({
      vendorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_em_risco',
      title: 'Lead em risco',
      message: `O lead "${lead.name}" está em "Abordagem" há 12h úteis sem contato.`,
    })
  }
}

async function notifyAbordagemCritico() {
  const candidates = await db.query.leads.findMany({
    where: and(
      eq(leads.status, 'abordagem'),
      or(isNull(leads.slaStatus), ne(leads.slaStatus, 'critico')),
      statusChangedCutoff(SIXTEEN_BUSINESS_HOURS_MS)
    ),
  })

  for (const lead of candidates) {
    if (!lead.vendorId || !lead.companyId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < SIXTEEN_BUSINESS_HOURS_MS) continue

    await db.update(leads).set({ slaStatus: 'critico' }).where(eq(leads.id, lead.id))

    await db.insert(notifications).values({
      vendorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_critico',
      title: 'Lead crítico',
      message: `O lead "${lead.name}" está em "Abordagem" há 16h úteis sem contato.`,
    })

    const admins = await db.query.users.findMany({
      where: and(eq(users.role, 'admin'), eq(users.companyId, lead.companyId)),
    })
    for (const admin of admins) {
      await db.insert(notifications).values({
        vendorId: admin.id,
        leadId: lead.id,
        type: 'abordagem_critico_escalation',
        title: 'Escalonamento: lead crítico',
        message: `O lead "${lead.name}" (vendedor #${lead.vendorId}) está crítico em "Abordagem" há 16h úteis sem contato.`,
      })
    }
  }
}

async function notifyLeadCooling() {
  const candidates = await db.query.leads.findMany({
    where: and(
      eq(leads.status, 'abordagem'),
      isNull(leads.lastContactStaleAlertSentAt),
      lte(leads.lastContactAt, isoMinusMs(THREE_DAYS_MS))
    ),
  })

  for (const lead of candidates) {
    if (!lead.vendorId) continue

    await db.insert(notifications).values({
      vendorId: lead.vendorId,
      leadId: lead.id,
      type: 'lead_cooling',
      title: 'Lead esfriando',
      message: `O lead "${lead.name}" está sem nova tentativa de contato há 3 dias.`,
    })

    await db.update(leads).set({ lastContactStaleAlertSentAt: new Date().toISOString() }).where(eq(leads.id, lead.id))
  }
}

async function revertStaleAbordagemLeads() {
  const staleLeads = await db.query.leads.findMany({
    where: and(eq(leads.status, 'abordagem'), statusChangedCutoff(TWO_DAYS_MS)),
  })

  for (const lead of staleLeads) {
    const now = new Date().toISOString()

    await db
      .update(leads)
      .set({
        status: 'novo',
        statusChangedAt: now,
        idleAlertSentAt: null,
        autoReassignedAt: null,
        slaStatus: null,
        attemptCount: 0,
        abordagem4hAlertSentAt: null,
        lastContactStaleAlertSentAt: null,
      })
      .where(eq(leads.id, lead.id))

    await db.insert(leadHistory).values({
      leadId: lead.id,
      userId: null,
      action: 'reversao_automatica',
      fromStatus: 'abordagem',
      toStatus: 'novo',
      details: 'Retornou automaticamente para "Novo" após 2 dias sem avanço em "Abordagem"',
    })

    if (lead.vendorId) {
      await db.insert(notifications).values({
        vendorId: lead.vendorId,
        leadId: lead.id,
        type: 'lead_auto_reverted',
        title: 'Lead voltou para "Novo"',
        message: `O lead "${lead.name}" ficou 2 dias em "Abordagem" sem avanço e voltou para "Novo".`,
      })
    }
  }
}

export async function runChecks() {
  await notifyIdleNovoLeads()
  await reassignIdleNovoLeads()
  await revertStaleAbordagemLeads()
  await notifyAbordagemFirstContactPending()
  await notifyAbordagemEmRisco()
  await notifyAbordagemCritico()
  await notifyLeadCooling()
}

export function startScheduler() {
  cron.schedule(CRON_EXPRESSION, () => {
    runChecks().catch((err) => console.error('[scheduler] erro ao processar checagens:', err))
  })
  console.log('[scheduler] automação de etapas rodando a cada 5 minutos')
}
