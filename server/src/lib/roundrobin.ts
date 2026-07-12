import { db } from '../db/client.js'
import { ddds, regionVendors, roundRobinState } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

export async function getVendorByDDD(ddd: number, companyId: number): Promise<number | null> {
  const dddRecord = await db.query.ddds.findFirst({
    where: and(eq(ddds.ddd, ddd), eq(ddds.companyId, companyId)),
  })
  if (!dddRecord) return null

  const regionId = dddRecord.regionId
  return assignNextVendor(regionId)
}

export async function assignNextVendor(regionId: number): Promise<number | null> {
  const vendors = await db.query.regionVendors.findMany({
    where: eq(regionVendors.regionId, regionId),
    with: { vendor: true },
  })

  const activeVendors = vendors.filter((rv) => rv.vendor.isActive)
  if (activeVendors.length === 0) return null

  let state = await db.query.roundRobinState.findFirst({
    where: eq(roundRobinState.regionId, regionId),
  })

  if (!state) {
    await db.insert(roundRobinState).values({ regionId, nextIndex: 0 })
    state = await db.query.roundRobinState.findFirst({
      where: eq(roundRobinState.regionId, regionId),
    })
  }
  if (!state) return null

  const currentIndex = state.nextIndex % activeVendors.length
  const chosenVendor = activeVendors[currentIndex]

  await db
    .update(roundRobinState)
    .set({ nextIndex: currentIndex + 1 })
    .where(eq(roundRobinState.regionId, regionId))

  return chosenVendor.vendorId
}

export async function getRegionIdByDDD(ddd: number, companyId: number): Promise<number | null> {
  const dddRecord = await db.query.ddds.findFirst({
    where: and(eq(ddds.ddd, ddd), eq(ddds.companyId, companyId)),
  })
  return dddRecord?.regionId ?? null
}
