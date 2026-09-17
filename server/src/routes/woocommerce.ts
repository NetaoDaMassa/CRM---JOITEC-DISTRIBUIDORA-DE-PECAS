import express from 'express'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'
import { processarCadastroWoocommerce, processarPedidoWoocommerce } from '../lib/woocommerceLeads.js'

// Recebe os webhooks nativos do WooCommerce (WooCommerce > Configurações >
// Avançado > Webhooks) da loja online da Compretec Loja Física — sem
// nenhum plugin extra no WordPress. Montado com express.raw() (ver
// index.ts) porque a assinatura do WooCommerce é calculada em cima do corpo
// cru da requisição, antes de qualquer JSON.parse.
export const woocommerceRouter = express.Router()

const EMPRESA_SLUG = 'compretec-loja-fisica'

function assinaturaValida(rawBody: Buffer, assinaturaRecebida: string | undefined, secret: string): boolean {
  if (!assinaturaRecebida) return false
  const esperada = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  const bufA = Buffer.from(assinaturaRecebida)
  const bufB = Buffer.from(esperada)
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

woocommerceRouter.post('/compretec/webhook', async (req, res) => {
  // Tudo dentro de um try/catch único de propósito — o teste de conexão que
  // o WooCommerce dispara ao salvar o webhook (wp-admin) às vezes não manda
  // Content-Type: application/json certinho, então express.raw() (montado
  // com `type: () => true` em index.ts) sempre entrega req.body como Buffer,
  // mas qualquer imprevisto aqui dentro NUNCA pode escapar sem resposta: uma
  // exceção não tratada num handler async do Express vira unhandled
  // rejection e derruba o processo Node inteiro (tirou o CRM inteiro do ar
  // numa rodada de teste, não só o webhook — 2026-09-17).
  try {
    const secret = process.env.WOOCOMMERCE_COMPRETEC_WEBHOOK_SECRET
    if (!secret) {
      console.error('[woocommerce] WOOCOMMERCE_COMPRETEC_WEBHOOK_SECRET não configurado')
      return res.status(500).json({ error: 'integração não configurada' })
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    const assinatura = req.header('x-wc-webhook-signature')
    if (!assinaturaValida(rawBody, assinatura, secret)) {
      return res.status(401).json({ error: 'assinatura inválida' })
    }

    // O WooCommerce manda um corpo vazio pra testar o webhook assim que ele é
    // criado no wp-admin — só confirma recebido, sem processar nada.
    if (rawBody.length === 0) return res.status(200).json({ ok: true })

    let payload: any
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'payload inválido' })
    }

    const topico = req.header('x-wc-webhook-topic') ?? ''

    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, EMPRESA_SLUG) })
    if (!empresa) {
      console.error(`[woocommerce] empresa "${EMPRESA_SLUG}" não encontrada`)
      return res.status(200).json({ ok: true })
    }

    if (topico.startsWith('customer.')) {
      await processarCadastroWoocommerce(empresa.id, payload)
    } else if (topico.startsWith('order.')) {
      await processarPedidoWoocommerce(empresa.id, payload)
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[woocommerce/webhook]', err)
    // 200 mesmo em erro interno — o WooCommerce reenvia e, depois de falhas
    // repetidas, desativa o webhook sozinho; preferimos investigar pelo log
    // a perder a inscrição do webhook.
    res.status(200).json({ ok: false })
  }
})
