import { router, publicProcedure } from './_base.js'
import { db } from '../db/client.js'

export const companiesRouter = router({
  list: publicProcedure.query(async () => {
    const rows = await db.query.companies.findMany({
      orderBy: (c, { asc }) => [asc(c.name)],
    })
    return rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
  }),
})
