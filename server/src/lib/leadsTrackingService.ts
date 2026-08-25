import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications } from '../db/schema.js'
import { getVendorByDDD, getRegionIdByDDD } from './leadsRoundRobin.js'

interface FindOrCreateLeadFromTrackingInput {
  empresaId: number
  name?: string
  phone: string
  email?: string
  source: string
}

// Extrai o DDD dos 2 primeiros dígitos do telefone (removendo o 55 do Brasil,
// se presente) — leads.ddd é NOT NULL, sem DDD válido não dá pra criar o lead.
// Mesma lógica do sistema de origem (odin-tubos-crm--master/server/src/lib/trackingLeadService.ts).
function extractDDD(phone: string): number | null {
  const digits = phone.replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (local.length < 10) return null
  const ddd = parseInt(local.slice(0, 2), 10)
  return ddd >= 11 && ddd <= 99 ? ddd : null
}

// Chamada a partir de POST /api/tracking/events (rota pública, sem sessão de
// usuário logado) quando um formulário do site tem telefone — cria (ou
// reaproveita, se já existe) o lead correspondente, com o mesmo rodízio por
// DDD usado em leads.create.
export async function findOrCreateLeadFromTracking(
  input: FindOrCreateLeadFromTrackingInput
): Promise<number | null> {
  const { empresaId, phone, email, name, source } = input

  const existing = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.phone, phone), isNull(leads.deletedAt)),
  })
  if (existing) return existing.id

  const ddd = extractDDD(phone)
  if (!ddd) return null

  const vendorId = await getVendorByDDD(ddd, empresaId)
  const regionId = await getRegionIdByDDD(ddd, empresaId)

  const result = await db.insert(leads).values({
    empresaId,
    name: name?.trim() || 'Lead do site',
    phone,
    ddd,
    email: email || null,
    source,
    vendorId,
    regionId,
    assignedAt: vendorId ? new Date().toISOString() : null,
    statusChangedAt: new Date().toISOString(),
  })

  const leadId = Number(result.lastInsertRowid)

  await db.insert(leadHistory).values({
    empresaId,
    leadId,
    action: 'criado',
    toStatus: 'novo',
    details: `Lead criado via tracking (${source})${vendorId ? ' e atribuído ao vendedor' : ' sem vendedor'}`,
  })

  if (vendorId) {
    await db.insert(notifications).values({
      vendedorId: vendorId,
      type: 'lead_assigned',
      title: 'Novo lead atribuído',
      message: `${name?.trim() || 'Um novo lead'} foi distribuído para você agora (origem: ${source}).`,
    })
  }

  return leadId
}
