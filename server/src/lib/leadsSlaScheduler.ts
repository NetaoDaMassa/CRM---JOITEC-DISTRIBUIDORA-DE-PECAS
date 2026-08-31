// Motor de SLA/automação do módulo de Leads — portado de
// odin-tubos-crm--master/server/src/lib/scheduler.ts (nunca tinha sido
// portado antes; só o esqueleto de colunas em `leads` existia aqui,
// preenchido só pelas ações manuais — ver comentário em schema.ts). Achado
// do João, 2026-08-31: a aba SLA de Relatórios de Marketing sempre mostrava
// zero em risco/crítico porque nada nunca escrevia esses campos.
//
// Limites fixos por enquanto (mesmos padrões do sistema antigo) — dá pra
// virar configurável por empresa depois, numa tela própria, se precisar.
import { and, eq, isNull, lte, ne, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications, users } from '../db/schema.js'
import { assignNextVendor } from './leadsRoundRobin.js'
import { businessHoursElapsedMs } from './businessHours.js'
import { agoraSqlite } from './dataBr.js'

const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS
const THREE_DAYS_MS = 3 * ONE_DAY_MS

const NOVO_NOTIFY_HOURS = 1
const NOVO_REASSIGN_HOURS = 3 // só a etapa "novo" tem rodízio automático (mesmo default do sistema antigo)
const ABORDAGEM_FIRST_CONTACT_HOURS = 4
const ABORDAGEM_EM_RISCO_HOURS = 12
const ABORDAGEM_CRITICO_HOURS = 16

function hoursToMs(hours: number): number {
  return hours * ONE_HOUR_MS
}

function agoraMenosMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString().replace('T', ' ').slice(0, 19)
}

function stageStartedAt(lead: { statusChangedAt: string | null; updatedAt: string }): string {
  return lead.statusChangedAt ?? lead.updatedAt
}

// Relógio do rodízio: conta a partir de quando o vendedor ATUAL recebeu o
// lead (rodízio automático ou transferência manual), não de quando o lead
// entrou na etapa — senão um lead transferido herdava o tempo que já tinha
// ficado parado com o vendedor anterior.
function assignmentClockStart(lead: { assignedAt: string | null; statusChangedAt: string | null; updatedAt: string }): string {
  return lead.assignedAt ?? stageStartedAt(lead)
}

function noAttemptsYet(lead: { attemptCount: number | null }): boolean {
  return !lead.attemptCount || lead.attemptCount === 0
}

async function notifyIdleNovoLeads() {
  const idleLeads = await db.query.leads.findMany({
    where: and(eq(leads.status, 'novo'), isNull(leads.idleAlertSentAt), isNull(leads.deletedAt)),
  })

  let notificados = 0
  for (const lead of idleLeads) {
    if (!lead.vendorId) continue
    if (businessHoursElapsedMs(assignmentClockStart(lead)) < hoursToMs(NOVO_NOTIFY_HOURS)) continue

    await db.insert(notifications).values({
      vendedorId: lead.vendorId,
      leadId: lead.id,
      type: 'lead_idle_1h',
      title: `Lead parado há ${NOVO_NOTIFY_HOURS}h`,
      message: `O lead "${lead.name}" está em "Novo" há mais de ${NOVO_NOTIFY_HOURS}h sem contato.`,
    })
    await db.update(leads).set({ idleAlertSentAt: agoraSqlite() }).where(eq(leads.id, lead.id))
    notificados++
  }
  return notificados
}

// Rodízio automático — só a etapa "novo", igual ao comportamento original.
// Não filtra por autoReassignedAt (esse campo é só um marcador histórico):
// quem trava uma nova reatribuição é o próprio relógio (assignedAt reseta a
// cada troca, automática ou manual) — permite rodízio em cadeia se o
// próximo vendedor também não atender a tempo.
async function reassignIdleNovoLeads() {
  const candidatos = await db.query.leads.findMany({
    where: and(eq(leads.status, 'novo'), isNull(leads.deletedAt)),
  })

  let reatribuidos = 0
  for (const lead of candidatos) {
    if (!lead.vendorId || !lead.regionId) continue
    if (lead.nextContactAt) continue // já tem retorno agendado, conta como atendido
    if (businessHoursElapsedMs(assignmentClockStart(lead)) < hoursToMs(NOVO_REASSIGN_HOURS)) continue

    const agora = agoraSqlite()
    const newVendorId = await assignNextVendor(lead.regionId)
    if (!newVendorId || newVendorId === lead.vendorId) continue // sem outro vendedor ativo, tenta de novo no próximo ciclo

    await db
      .update(leads)
      .set({ vendorId: newVendorId, assignedAt: agora, autoReassignedAt: agora, idleAlertSentAt: null })
      .where(eq(leads.id, lead.id))

    await db.insert(leadHistory).values({
      empresaId: lead.empresaId,
      leadId: lead.id,
      userId: null,
      action: 'reatribuicao_automatica',
      fromStatus: lead.status,
      toStatus: lead.status,
      fromVendorId: lead.vendorId,
      toVendorId: newVendorId,
      details: `Reatribuído automaticamente por inatividade de ${NOVO_REASSIGN_HOURS}h em "Novo" (vendedor anterior #${lead.vendorId})`,
    })

    await db.insert(notifications).values({
      vendedorId: newVendorId,
      leadId: lead.id,
      type: 'lead_reassigned',
      title: 'Lead atribuído automaticamente',
      message: `O lead "${lead.name}" foi atribuído a você por rodízio após ficar parado em "Novo".`,
    })
    reatribuidos++
  }
  return reatribuidos
}

async function notifyAbordagemFirstContactPending() {
  const candidatos = await db.query.leads.findMany({
    where: and(eq(leads.status, 'abordagem'), isNull(leads.abordagem4hAlertSentAt), isNull(leads.deletedAt)),
  })

  let notificados = 0
  for (const lead of candidatos) {
    if (!lead.vendorId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < hoursToMs(ABORDAGEM_FIRST_CONTACT_HOURS)) continue

    await db.insert(notifications).values({
      vendedorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_first_contact_pending',
      title: 'Lead aguardando 1º contato',
      message: `O lead "${lead.name}" está em "Abordagem" há ${ABORDAGEM_FIRST_CONTACT_HOURS}h úteis sem nenhuma tentativa de contato.`,
    })
    await db.update(leads).set({ abordagem4hAlertSentAt: agoraSqlite() }).where(eq(leads.id, lead.id))
    notificados++
  }
  return notificados
}

async function notifyAbordagemEmRisco() {
  const candidatos = await db.query.leads.findMany({
    where: and(eq(leads.status, 'abordagem'), isNull(leads.slaStatus), isNull(leads.deletedAt)),
  })

  let marcados = 0
  for (const lead of candidatos) {
    if (!lead.vendorId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < hoursToMs(ABORDAGEM_EM_RISCO_HOURS)) continue

    await db.update(leads).set({ slaStatus: 'em_risco' }).where(eq(leads.id, lead.id))
    await db.insert(notifications).values({
      vendedorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_em_risco',
      title: 'Lead em risco',
      message: `O lead "${lead.name}" está em "Abordagem" há ${ABORDAGEM_EM_RISCO_HOURS}h úteis sem contato.`,
    })
    marcados++
  }
  return marcados
}

async function notifyAbordagemCritico() {
  const candidatos = await db.query.leads.findMany({
    where: and(eq(leads.status, 'abordagem'), or(isNull(leads.slaStatus), ne(leads.slaStatus, 'critico')), isNull(leads.deletedAt)),
  })

  let marcados = 0
  for (const lead of candidatos) {
    if (!lead.vendorId || !noAttemptsYet(lead)) continue
    if (businessHoursElapsedMs(stageStartedAt(lead)) < hoursToMs(ABORDAGEM_CRITICO_HOURS)) continue

    await db.update(leads).set({ slaStatus: 'critico' }).where(eq(leads.id, lead.id))
    await db.insert(notifications).values({
      vendedorId: lead.vendorId,
      leadId: lead.id,
      type: 'abordagem_critico',
      title: 'Lead crítico',
      message: `O lead "${lead.name}" está em "Abordagem" há ${ABORDAGEM_CRITICO_HOURS}h úteis sem contato.`,
    })

    const admins = await db.query.users.findMany({ where: and(eq(users.role, 'admin'), eq(users.empresaId, lead.empresaId)) })
    for (const admin of admins) {
      await db.insert(notifications).values({
        vendedorId: admin.id,
        leadId: lead.id,
        type: 'abordagem_critico_escalation',
        title: 'Escalonamento: lead crítico',
        message: `O lead "${lead.name}" (vendedor #${lead.vendorId}) está crítico em "Abordagem" há ${ABORDAGEM_CRITICO_HOURS}h úteis sem contato.`,
      })
    }
    marcados++
  }
  return marcados
}

async function notifyLeadCooling() {
  const limite = agoraMenosMs(THREE_DAYS_MS)
  const candidatos = await db.query.leads.findMany({
    where: and(
      eq(leads.status, 'abordagem'),
      isNull(leads.lastContactStaleAlertSentAt),
      isNull(leads.deletedAt),
      lte(leads.lastContactAt, limite)
    ),
  })

  let notificados = 0
  for (const lead of candidatos) {
    if (!lead.vendorId) continue
    await db.insert(notifications).values({
      vendedorId: lead.vendorId,
      leadId: lead.id,
      type: 'lead_cooling',
      title: 'Lead esfriando',
      message: `O lead "${lead.name}" está sem nova tentativa de contato há 3 dias.`,
    })
    await db.update(leads).set({ lastContactStaleAlertSentAt: agoraSqlite() }).where(eq(leads.id, lead.id))
    notificados++
  }
  return notificados
}

export async function runLeadsSlaChecks(): Promise<void> {
  const idleNovo = await notifyIdleNovoLeads()
  const reatribuidos = await reassignIdleNovoLeads()
  const pendentes = await notifyAbordagemFirstContactPending()
  const emRisco = await notifyAbordagemEmRisco()
  const criticos = await notifyAbordagemCritico()
  const esfriando = await notifyLeadCooling()

  const total = idleNovo + reatribuidos + pendentes + emRisco + criticos + esfriando
  if (total > 0) {
    console.log(
      `[leads-sla] novo-parado=${idleNovo} reatribuidos=${reatribuidos} 1o-contato-pendente=${pendentes} em-risco=${emRisco} criticos=${criticos} esfriando=${esfriando}`
    )
  }
}
