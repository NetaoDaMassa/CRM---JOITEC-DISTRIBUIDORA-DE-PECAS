import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'
import { getConfigNumero, setConfig } from './configuracoes.js'
import { processarCarrinhoRecarto, type CarrinhoRecartoRow } from './woocommerceLeads.js'

// Busca periodicamente (ver scheduler.ts) os carrinhos abandonados novos
// captados pelo plugin WooCommerce Abandoned Cart Recovery Premium
// (Recarto) da loja online da Compretec Loja Física, via um endpoint REST
// pequeno instalado no WordPress (functions.php do tema — ver instruções
// passadas ao João em 2026-09-17). Diferente do webhook nativo do
// WooCommerce (routes/woocommerce.ts), que só reage quando um pedido de
// verdade é criado, esse plugin capta o contato assim que a pessoa preenche
// o checkout, mesmo sem finalizar — é o volume real de "carrinho
// abandonado".
const EMPRESA_SLUG = 'compretec-loja-fisica'
const CONFIG_ULTIMO_ID = 'woocommerce_compretec_carrinho_ultimo_id'

export async function sincronizarCarrinhosAbandonadosCompretec(): Promise<{ processados: number }> {
  const siteUrl = process.env.WOOCOMMERCE_COMPRETEC_SITE_URL
  const secret = process.env.WOOCOMMERCE_COMPRETEC_EXPORT_SECRET
  if (!siteUrl || !secret) return { processados: 0 }

  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, EMPRESA_SLUG) })
  if (!empresa) return { processados: 0 }

  const ultimoId = await getConfigNumero(CONFIG_ULTIMO_ID, 0)

  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/joitec-crm/v1/carrinhos-abandonados?desde_id=${ultimoId}`
  const res = await fetch(url, {
    headers: { 'x-joitec-secret': secret },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    console.error(`[woocommerce-carrinho] falha ao buscar carrinhos abandonados: HTTP ${res.status}`)
    return { processados: 0 }
  }

  const linhas = (await res.json()) as CarrinhoRecartoRow[]
  if (!Array.isArray(linhas) || linhas.length === 0) return { processados: 0 }

  let maiorId = ultimoId
  for (const linha of linhas) {
    await processarCarrinhoRecarto(empresa.id, linha)
    if (linha.id > maiorId) maiorId = linha.id
  }

  if (maiorId > ultimoId) await setConfig(CONFIG_ULTIMO_ID, maiorId)

  return { processados: linhas.length }
}
