import { authRouter } from './auth.js'
import { leadsRouter } from './leads.js'
import { usersRouter } from './users.js'
import { regionsRouter } from './regions.js'
import { reportsRouter } from './reports.js'
import { campaignsRouter } from './campaigns.js'
import { notificationsRouter } from './notifications.js'
import { messageTemplatesRouter } from './messageTemplates.js'
import { companiesRouter } from './companies.js'
import { router } from './_base.js'

export { router, publicProcedure, protectedProcedure, adminProcedure } from './_base.js'

export const appRouter = router({
  auth: authRouter,
  leads: leadsRouter,
  users: usersRouter,
  regions: regionsRouter,
  reports: reportsRouter,
  campaigns: campaignsRouter,
  notifications: notificationsRouter,
  messageTemplates: messageTemplatesRouter,
  companies: companiesRouter,
})

export type AppRouter = typeof appRouter
