import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, notifications, users } from '../db/schema.js'
import { parseTelefone } from './leadsTrackingService.js'

// Ponte entre os webhooks do WooCommerce (loja online da Compretec Loja
// Física) e os leads do CRM — ver routes/woocommerce.ts, que recebe e
// valida os webhooks e chama as duas funções exportadas aqui.

const SOURCES_ECOMMERCE = ['ecommerce_cadastro', 'ecommerce_carrinho_abandonado', 'ecommerce_venda'] as const
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

// Pedido PAGO de verdade (processing/completed) — achado do João, 2026-10-01:
// o webhook sempre esteve chegando certinho (confirmado nos logs do
// WooCommerce), mas uma venda concluída nunca virava lead no CRM, porque
// `processarPedidoWoocommerce` só tratava pedido NÃO pago (ver
// STATUS_ABANDONO). Decisão: toda venda da loja online também deve
// aparecer no CRM — direto como "Ganho" (já é uma venda fechada, não faz
// sentido nascer em "Novo" esperando alguém ligar). Se já existir um lead
// com esse telefone (por exemplo, um carrinho abandonado anterior da
// mesma pessoa que agora voltou e comprou), atualiza ELE pra Ganho em vez
// de criar um segundo lead duplicado.
async function criarOuAtualizarLeadVendaWoocommerce(params: {
  empresaId: number
  name?: string
  phoneRaw?: string
  email?: string
  valorTotal: number
  itens: string
}): Promise<number | null> {
  const { empresaId, email, name, valorTotal, itens } = params
  if (!params.phoneRaw) return null

  const parsed = parseTelefone(params.phoneRaw)
  if (!parsed) return null
  const { ddd, phone } = parsed

  const agora = new Date().toISOString()
  const detalheVenda = `Venda concluída na loja online (R$ ${valorTotal.toFixed(2)})${itens ? ` — ${itens}` : ''}.`

  const existing = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.phone, phone), isNull(leads.deletedAt)),
  })

  if (existing) {
    // Idempotente — o WooCommerce pode reenviar o mesmo pedido (ex: de
    // "processing" pra "completed") mais de uma vez; só mexe se ainda não
    // tinha marcado esse lead como Ganho.
    if (existing.status === 'ganho') return existing.id

    await db
      .update(leads)
      .set({ status: 'ganho', finalOrderValue: valorTotal, statusChangedAt: agora, updatedAt: agora })
      .where(eq(leads.id, existing.id))

    await db.insert(leadHistory).values({
      empresaId,
      leadId: existing.id,
      action: 'status_alterado',
      fromStatus: existing.status,
      toStatus: 'ganho',
      details: detalheVenda,
    })

    if (existing.vendorId) {
      await db.insert(notifications).values({
        vendedorId: existing.vendorId,
        type: 'lead_assigned',
        title: 'Venda confirmada na loja online',
        message: `${existing.name} comprou pela loja online agora (R$ ${valorTotal.toFixed(2)}).`,
      })
    }

    return existing.id
  }

  const vendorId = await proximoVendedorRodizio(empresaId)

  const result = await db.insert(leads).values({
    empresaId,
    name: name?.trim() || 'Cliente da loja online',
    phone,
    ddd,
    email: email || null,
    source: 'ecommerce_venda',
    status: 'ganho',
    finalOrderValue: valorTotal,
    observations: detalheVenda,
    vendorId,
    assignedAt: vendorId ? agora : null,
    statusChangedAt: agora,
  })
  const leadId = Number(result.lastInsertRowid)

  await db.insert(leadHistory).values({
    empresaId,
    leadId,
    action: 'criado',
    toStatus: 'ganho',
    details: `${detalheVenda}${vendorId ? ' Atribuída ao vendedor.' : ' Sem vendedor.'}`,
  })

  if (vendorId) {
    await db.insert(notifications).values({
      vendedorId: vendorId,
      type: 'lead_assigned',
      title: 'Venda confirmada na loja online',
      message: `${name?.trim() || 'Um cliente'} comprou pela loja online agora (R$ ${valorTotal.toFixed(2)}).`,
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
  itens?: { nome: string; quantidade: number }[] | null
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
  const itensTexto =
    row.itens && row.itens.length > 0 ? row.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ') : ''
  const observations = [
    `Carrinho abandonado no checkout da loja online${dataHora ? ` (${dataHora})` : ''} — preencheu os dados mas não finalizou a compra.`,
    itensTexto && `Itens: ${itensTexto}.`,
  ]
    .filter(Boolean)
    .join(' ')

  return criarLeadWoocommerce({
    empresaId,
    name,
    phoneRaw: row.billing_phone ?? undefined,
    email: row.billing_email ?? undefined,
    source: 'ecommerce_carrinho_abandonado',
    observations,
  })
}

// Webhook "order.created"/"order.updated" — pedido pago (processing/
// completed) vira lead "Ganho" direto; pedido nunca pago (ver
// STATUS_ABANDONO) vira lead de remarketing pra alguém tentar recuperar.
// Qualquer outro status (ex: cancelado, reembolsado) é ignorado.
const STATUS_VENDA_PAGA = new Set(['processing', 'completed'])

export async function processarPedidoWoocommerce(empresaId: number, payload: any): Promise<number | null> {
  const status: string | undefined = payload?.status
  if (!status) return null

  const billing = payload?.billing ?? {}
  const phoneRaw = billing.phone
  const email = billing.email
  const name = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim()
  const itens = Array.isArray(payload?.line_items)
    ? payload.line_items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')
    : ''

  if (STATUS_VENDA_PAGA.has(status)) {
    const valorTotal = Number(payload?.total) || 0
    return criarOuAtualizarLeadVendaWoocommerce({ empresaId, name, phoneRaw, email, valorTotal, itens })
  }

  if (!STATUS_ABANDONO.has(status)) return null

  const total = payload?.total ? `R$ ${payload.total}` : ''
  const observations = ['Carrinho não finalizado na loja online.', itens && `Itens: ${itens}.`, total && `Total: ${total}.`]
    .filter(Boolean)
    .join(' ')

  return criarLeadWoocommerce({ empresaId, name, phoneRaw, email, source: 'ecommerce_carrinho_abandonado', observations })
}
