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

// Logs explícitos em todo caminho (sucesso, "não configurado", erro HTTP) —
// achado do João, 2026-10-01: antes não logava nada em caso de sucesso NEM
// no caso de env var ausente, então um log vazio não provava nada (podia
// ser "rodou bem" ou "nem tentou", sem como diferenciar de fora). Agora dá
// pra saber pelo log sozinho, sem precisar abrir o banco.
export async function sincronizarCarrinhosAbandonadosCompretec(): Promise<{ processados: number }> {
  const siteUrl = process.env.WOOCOMMERCE_COMPRETEC_SITE_URL
  const secret = process.env.WOOCOMMERCE_COMPRETEC_EXPORT_SECRET
  if (!siteUrl || !secret) {
    console.log('[woocommerce-carrinho] WOOCOMMERCE_COMPRETEC_SITE_URL/EXPORT_SECRET não configurado no ambiente — pulando')
    return { processados: 0 }
  }

  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, EMPRESA_SLUG) })
  if (!empresa) {
    console.error(`[woocommerce-carrinho] empresa "${EMPRESA_SLUG}" não encontrada`)
    return { processados: 0 }
  }

  const ultimoId = await getConfigNumero(CONFIG_ULTIMO_ID, 0)

  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/joitec-crm/v1/carrinhos-abandonados?desde_id=${ultimoId}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'x-joitec-secret': secret },
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    console.error(`[woocommerce-carrinho] falha de rede ao buscar ${url}:`, err)
    return { processados: 0 }
  }
  if (!res.ok) {
    console.error(`[woocommerce-carrinho] falha ao buscar carrinhos abandonados: HTTP ${res.status} (${url})`)
    return { processados: 0 }
  }

  const linhas = (await res.json()) as CarrinhoRecartoRow[]
  if (!Array.isArray(linhas) || linhas.length === 0) {
    console.log(`[woocommerce-carrinho] sincronizado: nenhum carrinho novo (desde_id=${ultimoId})`)
    return { processados: 0 }
  }

  let maiorId = ultimoId
  for (const linha of linhas) {
    await processarCarrinhoRecarto(empresa.id, linha)
    if (linha.id > maiorId) maiorId = linha.id
  }

  if (maiorId > ultimoId) await setConfig(CONFIG_ULTIMO_ID, maiorId)

  console.log(`[woocommerce-carrinho] sincronizado: ${linhas.length} carrinho(s) processado(s), último id ${maiorId}`)
  return { processados: linhas.length }
}
