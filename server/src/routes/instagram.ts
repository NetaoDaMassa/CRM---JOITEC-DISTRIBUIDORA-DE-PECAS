// Webhook único da Meta pra automação de Instagram — compartilhado por
// TODAS as empresas (um só Meta App, ver instagramApi.ts). Cada evento traz
// o id da Página/conta de Instagram de destino; usamos isso pra achar a
// empresa certa em `instagram_accounts` antes de processar. Pedido do João,
// 2026-09-21.
//
// Montada com express.raw() (ver index.ts), igual ao webhook do WooCommerce
// — a assinatura (x-hub-signature-256) é calculada em cima do corpo cru,
// antes de qualquer JSON.parse.
import express from 'express'
import crypto from 'crypto'
import { eq, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { instagramAccounts } from '../db/schema.js'
import { processarComentarioInstagram, processarPrimeiraDmInstagram } from '../lib/instagramLeads.js'

export const instagramRouter = express.Router()

// A Meta chama isso UMA vez, ao salvar a URL do webhook no painel do App —
// só confirma que o dono da URL sabe o verify_token combinado.
instagramRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN && typeof challenge === 'string') {
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

function assinaturaValida(rawBody: Buffer, assinaturaRecebida: string | undefined): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!assinaturaRecebida || !secret) return false
  // Formato "sha256=<hex>".
  const hashRecebido = assinaturaRecebida.split('=')[1]
  if (!hashRecebido) return false
  const hashEsperado = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const bufA = Buffer.from(hashRecebido)
  const bufB = Buffer.from(hashEsperado)
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

instagramRouter.post('/webhook', async (req, res) => {
  // Try/catch único de propósito (mesmo motivo do woocommerce.ts): um erro
  // não tratado aqui dentro de um handler async derruba o processo Node
  // inteiro, não só o webhook. 200 mesmo em erro nosso — a Meta reenvia e
  // desativa a assinatura depois de falhas repetidas.
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!assinaturaValida(rawBody, req.header('x-hub-signature-256'))) {
      return res.status(401).json({ error: 'assinatura inválida' })
    }

    let payload: any
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'payload inválido' })
    }

    for (const entry of payload.entry ?? []) {
      const idDoDestino: string | undefined = entry.id
      if (!idDoDestino) continue

      // `entry.id` pode ser o id da Página OU o id da conta de Instagram,
      // dependendo do campo do evento — checa os dois contra a conta salva.
      const conta = await db.query.instagramAccounts.findFirst({
        where: or(eq(instagramAccounts.igBusinessAccountId, idDoDestino), eq(instagramAccounts.igPageId, idDoDestino)),
      })
      if (!conta) continue // evento de uma conta não conectada a nenhuma empresa daqui

      // Gatilho 1: comentário com palavra-chave (`changes` com field "comments").
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue
        const valor = change.value ?? {}
        if (!valor.id || !valor.text) continue
        await processarComentarioInstagram(conta.empresaId, valor.id, valor.text, valor.from?.id ?? '', valor.from?.username ?? null)
      }

      // Gatilho 2: primeira mensagem direta (`messaging`, mesmo formato do
      // Messenger Platform). `is_echo` = mensagem que a PRÓPRIA página
      // mandou (ex: a resposta de boas-vindas que a gente acabou de enviar
      // ecoando de volta) — tem que ignorar, senão vira loop. Esse payload
      // não traz username de quem mandou, só o id numérico.
      for (const evento of entry.messaging ?? []) {
        if (evento.message?.is_echo) continue
        const texto = evento.message?.text
        const remetenteId = evento.sender?.id
        if (!texto || !remetenteId) continue
        await processarPrimeiraDmInstagram(conta.empresaId, remetenteId, null, texto)
      }
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[instagram webhook] erro processando evento:', err)
    res.status(200).json({ ok: false })
  }
})
