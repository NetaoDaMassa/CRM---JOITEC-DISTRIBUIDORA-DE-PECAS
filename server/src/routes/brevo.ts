import express from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'
import { processarEventoBrevo } from '../lib/leadsBrevo.js'

// Rota pública (sem login) — configurada como URL de webhook dentro do
// painel da própria Brevo, de cada empresa (conta Brevo separada por
// empresa). Token na URL (não header) porque é o formato mais simples de
// colar direto no campo "Webhook URL" do painel da Brevo, sem precisar
// configurar headers customizados lá. Token gerado em Configurações >
// Integrações (ver server/src/router/integracoes.ts, brevoGerarToken).
export const brevoRouter = express.Router()

brevoRouter.post('/webhook/:empresaSlug/:token', async (req, res) => {
  try {
    const { empresaSlug, token } = req.params
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, empresaSlug) })
    if (!empresa || !empresa.brevoWebhookToken || empresa.brevoWebhookToken !== token) {
      // 404 genérico de propósito — não confirma pra quem estiver tentando
      // adivinhar slug/token se a empresa existe ou não.
      return res.status(404).json({ ok: false })
    }

    const { processados } = await processarEventoBrevo(empresa.id, empresa.brevoApiKey, req.body)
    res.json({ ok: true, processados })
  } catch (err) {
    // 200 mesmo em erro nosso — webhook malformado ou bug aqui não pode
    // virar retry-storm da Brevo. O erro fica só no log do servidor.
    console.error('[brevo webhook] erro processando evento:', err)
    res.status(200).json({ ok: false })
  }
})
