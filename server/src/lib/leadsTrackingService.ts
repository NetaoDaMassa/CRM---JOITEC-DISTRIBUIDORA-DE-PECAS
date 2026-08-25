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

// Separa DDD (2 primeiros dígitos, removendo o 55 do Brasil se presente) do
// número local — leads.ddd é NOT NULL, sem DDD válido não dá pra criar o
// lead. Mesma lógica do sistema de origem
// (odin-tubos-crm--master/server/src/lib/trackingLeadService.ts), mas
// agora também devolve o número local pra `leads.phone` nunca guardar o DDD
// embutido — o formulário do site manda o telefone cru, do jeito que a
// pessoa digitou (DDD junto, às vezes com parênteses/traço), e guardar isso
// direto duplicava o DDD na ficha do lead e quebrava o link do WhatsApp.
function parseTelefone(phoneRaw: string): { ddd: number; phone: string } | null {
  const digits = phoneRaw.replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (local.length < 10) return null
  const ddd = parseInt(local.slice(0, 2), 10)
  if (ddd < 11 || ddd > 99) return null
  return { ddd, phone: local.slice(2) }
}

// Chamada a partir de POST /api/tracking/events (rota pública, sem sessão de
// usuário logado) quando um formulário do site tem telefone — cria (ou
// reaproveita, se já existe) o lead correspondente, com o mesmo rodízio por
// DDD usado em leads.create.
export async function findOrCreateLeadFromTracking(
  input: FindOrCreateLeadFromTrackingInput
): Promise<number | null> {
  const { empresaId, email, name, source } = input

  const parsed = parseTelefone(input.phone)
  if (!parsed) return null
  const { ddd, phone } = parsed

  const existing = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.phone, phone), isNull(leads.deletedAt)),
  })
  if (existing) return existing.id

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
