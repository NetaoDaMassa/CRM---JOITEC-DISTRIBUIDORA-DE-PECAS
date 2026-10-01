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
  // Margem de 50 — achado do João, 2026-10-01: um carrinho pode nascer com
  // id baixo mas só o plugin Recarto marcar ele como "abandonado" (de
  // verdade, pronto pra aparecer nesse endpoint) um tempo depois — se nesse
  // meio tempo outros carrinhos com id maior já tiverem sido sincronizados
  // e empurrado o "desde_id" pra frente, esse carrinho atrasado nunca mais
  // seria buscado de novo. Reconsultando sempre com uma margem pra trás,
  // ele acaba entrando numa rodada seguinte — idempotente (telefone repetido
  // só retorna o lead já criado, não duplica, ver criarLeadWoocommerce).
  const desdeId = Math.max(0, ultimoId - 50)

  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/joitec-crm/v1/carrinhos-abandonados?desde_id=${desdeId}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'x-joitec-secret': secret },
      // 15s dava timeout direto na subida do container, quando várias
      // outras integrações (WhatsApp, GoTo, Notion, PABXONE360) disputam
      // CPU/IO ao mesmo tempo — achado do João, 2026-10-01, revisando os
      // logs. 30s dá folga suficiente pra isso sem travar o processo.
      signal: AbortSignal.timeout(30000),
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
    console.log(`[woocommerce-carrinho] sincronizado: nenhum carrinho (desde_id=${desdeId}, watermark=${ultimoId})`)
    return { processados: 0 }
  }

  // Lista cada carrinho recebido (id + telefone/nome) — pra conseguir
  // confirmar pelo log se um carrinho específico veio ou não, sem precisar
  // abrir o banco ou ficar testando o endpoint na mão.
  console.log(
    `[woocommerce-carrinho] recebidos ${linhas.length}: ${linhas
      .map((l) => `#${l.id} ${l.billing_phone ?? '(sem tel)'} ${[l.billing_first_name, l.billing_last_name].filter(Boolean).join(' ')}`)
      .join(' | ')}`
  )

  let maiorId = ultimoId
  for (const linha of linhas) {
    await processarCarrinhoRecarto(empresa.id, linha)
    if (linha.id > maiorId) maiorId = linha.id
  }

  if (maiorId > ultimoId) await setConfig(CONFIG_ULTIMO_ID, maiorId)

  console.log(`[woocommerce-carrinho] sincronizado: ${linhas.length} carrinho(s) processado(s), watermark agora ${maiorId}`)
  return { processados: linhas.length }
}
