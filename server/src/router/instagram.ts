// API interna (autenticada) da tela Configurações > Integrações > Instagram
// — status da conexão, iniciar OAuth, desconectar, editar palavras-chave e
// mensagens automáticas. O webhook em si (que a Meta chama) é público, em
// server/src/routes/instagram.ts — não tem nada a ver com este router.
// Pedido do João, 2026-09-21.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { instagramAccounts, instagramAutomationSettings } from '../db/schema.js'
import { montarUrlAutorizacao } from '../lib/instagramApi.js'

export const instagramRouter = router({
  status: adminProcedure.query(async ({ ctx }) => {
    const conta = await db.query.instagramAccounts.findFirst({ where: eq(instagramAccounts.empresaId, ctx.empresaId) })
    // Nunca devolve o token (nem criptografado) pro front — só o que dá pra
    // mostrar na tela.
    return conta
      ? { conectado: true, status: conta.status, igUsername: conta.igUsername, connectedAt: conta.connectedAt }
      : { conectado: false, status: null, igUsername: null, connectedAt: null }
  }),

  urlConexao: adminProcedure.mutation(async ({ ctx }) => {
    return { url: montarUrlAutorizacao(ctx.empresaId) }
  }),

  desconectar: adminProcedure.mutation(async ({ ctx }) => {
    await db.delete(instagramAccounts).where(eq(instagramAccounts.empresaId, ctx.empresaId))
    return { ok: true }
  }),

  getConfiguracoes: adminProcedure.query(async ({ ctx }) => {
    const config = await db.query.instagramAutomationSettings.findFirst({ where: eq(instagramAutomationSettings.empresaId, ctx.empresaId) })
    return {
      triggerKeywords: config ? (JSON.parse(config.triggerKeywords) as string[]) : [],
      commentReplyMessage: config?.commentReplyMessage ?? 'Oi! Te chamei no direct 😊',
      welcomeDmMessage: config?.welcomeDmMessage ?? 'Olá! Obrigado por entrar em contato. Já já alguém te responde por aqui.',
    }
  }),

  salvarConfiguracoes: adminProcedure
    .input(
      z.object({
        triggerKeywords: z.array(z.string().trim().min(1)).max(30),
        commentReplyMessage: z.string().trim().min(1),
        welcomeDmMessage: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existente = await db.query.instagramAutomationSettings.findFirst({ where: eq(instagramAutomationSettings.empresaId, ctx.empresaId) })
      const valores = {
        triggerKeywords: JSON.stringify(input.triggerKeywords),
        commentReplyMessage: input.commentReplyMessage,
        welcomeDmMessage: input.welcomeDmMessage,
        updatedAt: new Date().toISOString(),
      }
      if (existente) {
        await db.update(instagramAutomationSettings).set(valores).where(eq(instagramAutomationSettings.empresaId, ctx.empresaId))
      } else {
        await db.insert(instagramAutomationSettings).values({ empresaId: ctx.empresaId, ...valores })
      }
      return { ok: true }
    }),
})
