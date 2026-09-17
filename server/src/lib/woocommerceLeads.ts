import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications, users } from '../db/schema.js'
import { parseTelefone } from './leadsTrackingService.js'

// Ponte entre os webhooks do WooCommerce (loja online da Compretec Loja
// Física) e os leads do CRM — ver routes/woocommerce.ts, que recebe e
// valida os webhooks e chama as duas funções exportadas aqui.

const SOURCES_ECOMMERCE = ['ecommerce_cadastro', 'ecommerce_carrinho_abandonado'] as const
type SourceEcommerce = (typeof SOURCES_ECOMMERCE)[number]

// Pedido só vira lead de "carrinho abandonado" se nunca chegou a ser pago —
// pending/on-hold/failed. processing/completed é venda de verdade, não
// remarketing.
const STATUS_ABANDONO = new Set(['pending', 'on-hold', 'failed'])

// Rodízio simples entre os vendedores ativos da empresa (sem levar em conta
// DDD/região, diferente do rodízio de leads.create — o comprador da loja
// online pode ser de qualquer lugar do Brasil, então não faz sentido rotear
// por região). Olha qual foi o último vendedor que recebeu um lead vindo da
// loja online e passa pro próximo da lista, sem precisar de tabela de estado
// própria.
async function proximoVendedorRodizio(empresaId: number): Promise<number | null> {
  const vendedores = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.role, 'vendor'), eq(users.isActive, true)),
    orderBy: asc(users.id),
  })
  if (vendedores.length === 0) return null

  const ultimoLead = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), inArray(leads.source, SOURCES_ECOMMERCE as unknown as string[])),
    orderBy: desc(leads.id),
  })

  const idxAtual = ultimoLead?.vendorId ? vendedores.findIndex((v) => v.id === ultimoLead.vendorId) : -1
  const proximo = vendedores[idxAtual === -1 ? 0 : (idxAtual + 1) % vendedores.length]
  return proximo.id
}

async function criarLeadWoocommerce(params: {
  empresaId: number
  name?: string
  phoneRaw?: string
  email?: string
  source: SourceEcommerce
  observations?: string
}): Promise<number | null> {
  const { empresaId, email, name, source, observations } = params
  if (!params.phoneRaw) return null

  const parsed = parseTelefone(params.phoneRaw)
  if (!parsed) return null
  const { ddd, phone } = parsed

  const existing = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.phone, phone), isNull(leads.deletedAt)),
  })
  if (existing) return existing.id

  const vendorId = await proximoVendedorRodizio(empresaId)

  const result = await db.insert(leads).values({
    empresaId,
    name: name?.trim() || 'Lead da loja online',
    phone,
    ddd,
    email: email || null,
    source,
    observations: observations || null,
    vendorId,
    assignedAt: vendorId ? new Date().toISOString() : null,
    statusChangedAt: new Date().toISOString(),
  })

  const leadId = Number(result.lastInsertRowid)

  await db.insert(leadHistory).values({
    empresaId,
    leadId,
    action: 'criado',
    toStatus: 'novo',
    details: `Lead criado via loja online (${source})${vendorId ? ' e atribuído ao vendedor' : ' sem vendedor'}`,
  })

  if (vendorId) {
    await db.insert(notifications).values({
      vendedorId: vendorId,
      type: 'lead_assigned',
      title: 'Novo lead atribuído',
      message: `${name?.trim() || 'Um novo lead'} foi distribuído para você agora (origem: loja online).`,
    })
  }

  return leadId
}

// Webhook "customer.created" — alguém criou conta na loja.
export async function processarCadastroWoocommerce(empresaId: number, payload: any): Promise<number | null> {
  const phoneRaw = payload?.billing?.phone
  const email = payload?.email || payload?.billing?.email
  const name = [payload?.first_name, payload?.last_name].filter(Boolean).join(' ').trim() || payload?.billing?.first_name

  return criarLeadWoocommerce({ empresaId, name, phoneRaw, email, source: 'ecommerce_cadastro' })
}

// Linha vinda do endpoint de exportação do plugin Recarto/WooCommerce
// Abandoned Cart Recovery (ver woocommerceCarrinhoAbandonadoPoller.ts) — id
// é o id na tabela wacv_abandoned_cart_record, usado como marca d'água pra
// não reprocessar a mesma linha de novo a cada rodada do poller.
export interface CarrinhoRecartoRow {
  id: number
  billing_first_name?: string | null
  billing_last_name?: string | null
  billing_email?: string | null
  billing_phone?: string | null
  abandoned_cart_time?: number | null
}

// Carrinho capturado pelo plugin Recarto assim que a pessoa preenche o
// checkout (nome/telefone/e-mail), mesmo sem nunca clicar em "Finalizar
// pedido" — pega muito mais gente do que o processarPedidoWoocommerce acima
// (que só reage quando o WooCommerce chega a criar um pedido de verdade).
export async function processarCarrinhoRecarto(empresaId: number, row: CarrinhoRecartoRow): Promise<number | null> {
  const name = [row.billing_first_name, row.billing_last_name].filter(Boolean).join(' ').trim()
  const dataHora = row.abandoned_cart_time
    ? new Date(row.abandoned_cart_time * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : null
  const observations = `Carrinho abandonado no checkout da loja online${dataHora ? ` (${dataHora})` : ''} — preencheu os dados mas não finalizou a compra.`

  return criarLeadWoocommerce({
    empresaId,
    name,
    phoneRaw: row.billing_phone ?? undefined,
    email: row.billing_email ?? undefined,
    source: 'ecommerce_carrinho_abandonado',
    observations,
  })
}

// Webhook "order.created"/"order.updated" — só vira lead de remarketing
// quando o pedido nunca foi pago (ver STATUS_ABANDONO).
export async function processarPedidoWoocommerce(empresaId: number, payload: any): Promise<number | null> {
  const status: string | undefined = payload?.status
  if (!status || !STATUS_ABANDONO.has(status)) return null

  const billing = payload?.billing ?? {}
  const phoneRaw = billing.phone
  const email = billing.email
  const name = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim()

  const itens = Array.isArray(payload?.line_items)
    ? payload.line_items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')
    : ''
  const total = payload?.total ? `R$ ${payload.total}` : ''
  const observations = ['Carrinho não finalizado na loja online.', itens && `Itens: ${itens}.`, total && `Total: ${total}.`]
    .filter(Boolean)
    .join(' ')

  return criarLeadWoocommerce({ empresaId, name, phoneRaw, email, source: 'ecommerce_carrinho_abandonado', observations })
}
