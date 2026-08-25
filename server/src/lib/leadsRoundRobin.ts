import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leadDdds, leadRegionVendedores, leadRoundRobinState } from '../db/schema.js'

// Portado de /Users/weslley/Documents/odin-tubos-crm--master/server/src/lib/roundrobin.ts,
// adaptado pro schema/nomes deste CRM (empresaId em vez de companyId, tabelas
// prefixadas lead*). Mesmo comportamento: distribui em rodízio simples (sem peso,
// sem considerar quantos leads cada vendedor já tem em aberto) entre os vendedores
// ativos vinculados à região.

export async function getVendorByDDD(ddd: number, empresaId: number): Promise<number | null> {
  const dddRecord = await db.query.leadDdds.findFirst({
    where: and(eq(leadDdds.ddd, ddd), eq(leadDdds.empresaId, empresaId)),
  })
  if (!dddRecord) return null
  return assignNextVendor(dddRecord.regionId)
}

export async function assignNextVendor(regionId: number): Promise<number | null> {
  const vendors = await db.query.leadRegionVendedores.findMany({
    where: eq(leadRegionVendedores.regionId, regionId),
    with: { vendor: true },
  })

  const activeVendors = vendors.filter((rv) => rv.vendor.isActive)
  if (activeVendors.length === 0) return null

  let state = await db.query.leadRoundRobinState.findFirst({
    where: eq(leadRoundRobinState.regionId, regionId),
  })

  if (!state) {
    await db.insert(leadRoundRobinState).values({ regionId, nextIndex: 0 })
    state = await db.query.leadRoundRobinState.findFirst({
      where: eq(leadRoundRobinState.regionId, regionId),
    })
  }
  if (!state) return null

  const currentIndex = state.nextIndex % activeVendors.length
  const chosenVendor = activeVendors[currentIndex]

  await db
    .update(leadRoundRobinState)
    .set({ nextIndex: currentIndex + 1, updatedAt: new Date().toISOString() })
    .where(eq(leadRoundRobinState.regionId, regionId))

  return chosenVendor.vendorId
}

export async function getRegionIdByDDD(ddd: number, empresaId: number): Promise<number | null> {
  const dddRecord = await db.query.leadDdds.findFirst({
    where: and(eq(leadDdds.ddd, ddd), eq(leadDdds.empresaId, empresaId)),
  })
  return dddRecord?.regionId ?? null
}
