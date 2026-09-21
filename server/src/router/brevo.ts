import { z } from 'zod'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, emailMarketingEventos } from '../db/schema.js'

// API interna (autenticada) da tela Configurações > Integrações > Brevo —
// gera o token da URL de webhook e lista os eventos recebidos. O webhook em
// si (que a Brevo chama) é público, em server/src/routes/brevo.ts — não tem
// nada a ver com este router.
export const brevoRouter = router({
  config: adminProcedure.query(async ({ ctx }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
    return {
      token: empresa?.brevoWebhookToken ?? null,
      empresaSlug: empresa?.slug ?? '',
      // Nunca devolve a chave em si pro front, só se já tem uma salva.
      temApiKey: !!empresa?.brevoApiKey,
    }
  }),

  gerarToken: adminProcedure.mutation(async ({ ctx }) => {
    const token = randomBytes(16).toString('hex')
    await db.update(empresas).set({ brevoWebhookToken: token }).where(eq(empresas.id, ctx.empresaId))
    return { token }
  }),

  salvarApiKey: adminProcedure.input(z.object({ apiKey: z.string().trim().min(1) })).mutation(async ({ ctx, input }) => {
    await db.update(empresas).set({ brevoApiKey: input.apiKey }).where(eq(empresas.id, ctx.empresaId))
    return { ok: true }
  }),

  removerApiKey: adminProcedure.mutation(async ({ ctx }) => {
    await db.update(empresas).set({ brevoApiKey: null }).where(eq(empresas.id, ctx.empresaId))
    return { ok: true }
  }),

  eventosRecentes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return db.query.emailMarketingEventos.findMany({
        where: eq(emailMarketingEventos.empresaId, ctx.empresaId),
        orderBy: (e, { desc }) => [desc(e.createdAt)],
        limit: input?.limit ?? 50,
        with: { lead: { columns: { id: true, name: true, status: true } } },
      })
    }),
})
