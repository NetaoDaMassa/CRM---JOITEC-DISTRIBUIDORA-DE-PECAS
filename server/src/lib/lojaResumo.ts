// Texto curto do que o visitante fez na loja virtual — vai nas observações
// do lead novo, no histórico do lead e no aviso pro vendedor (pedido do
// João, 2026-11-10: "quero todos os dados, carrinhos com os produtos").
// A loja manda os itens em metadata.items (carrinho) ou metadata.order
// (checkout, compra e pagamento não concluído) — ver ecommerce-compretec
// packages/core/src/crm/order-details.ts.

export interface ItemLoja {
  sku: string | null
  nome: string
  quantidade: number
  preco: number | null
}

export interface PedidoLoja {
  numero: string | null
  status: string | null
  linkAdmin: string | null
  itens: ItemLoja[]
  subtotal: number | null
  desconto: number | null
  frete: number | null
  total: number | null
  cupom: string | null
  pagamento: string | null
  parcelas: number | null
  transportadora: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  bairro: string | null
  tipoDocumento: string | null
}

const PAGAMENTO: Record<string, string> = { PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito', BOLETO: 'Boleto' }

// metadata.form do evento "lead" (ecommerce: captureLead source)
const FORMULARIO: Record<string, string> = {
  checkout: 'Deixou o contato no checkout',
  cupom_primeira_compra: 'Pediu o cupom de primeira compra',
  home_lead_form: 'Preencheu o formulário da página inicial',
  newsletter: 'Assinou as ofertas por e-mail',
  quote: 'Pediu orçamento',
  contact: 'Mandou mensagem pelo Fale conosco',
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function lerMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// Itens vêm em dois formatos: carrinho {sku,name,price,quantity} e GA4
// {item_id,item_name,price,quantity}.
export function itensDe(meta: Record<string, unknown>): ItemLoja[] {
  const pedido = meta.order && typeof meta.order === 'object' ? (meta.order as Record<string, unknown>) : null
  const lista = Array.isArray(pedido?.items) ? pedido!.items : Array.isArray(meta.items) ? meta.items : []
  return (lista as Record<string, unknown>[])
    .filter((i) => i && typeof i === 'object')
    .map((i) => ({
      sku: s(i.sku) ?? s(i.item_variant) ?? s(i.item_id),
      nome: s(i.name) ?? s(i.item_name) ?? 'Produto',
      quantidade: n(i.quantity) ?? 1,
      preco: n(i.price),
    }))
}

export function pedidoDe(meta: Record<string, unknown>): PedidoLoja | null {
  const o = meta.order && typeof meta.order === 'object' ? (meta.order as Record<string, unknown>) : null
  if (!o) return null
  return {
    numero: s(o.number),
    status: s(o.status),
    linkAdmin: s(o.admin_url),
    itens: itensDe(meta),
    subtotal: n(o.subtotal),
    desconto: n(o.discount),
    frete: n(o.shipping),
    total: n(o.total),
    cupom: s(o.coupon),
    pagamento: s(o.payment_method) ? (PAGAMENTO[s(o.payment_method)!] ?? s(o.payment_method)) : null,
    parcelas: n(o.installments),
    transportadora: [s(o.shipping_carrier), s(o.shipping_service)].filter(Boolean).join(' · ') || null,
    cidade: s(o.city),
    uf: s(o.state),
    cep: s(o.zip_code),
    bairro: s(o.neighborhood),
    tipoDocumento: s(o.customer_document_type),
  }
}

export const reais = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Rótulo do evento do ponto de vista do vendedor. payment_failed chega como
// cart_abandoned com metadata.store_event = 'payment_failed'.
export function rotuloEventoLoja(tipo: string, meta: Record<string, unknown>): string {
  if (meta.store_event === 'payment_failed') return 'Pagamento não concluído'
  if (meta.store_event === 'whatsapp_click') return 'Clicou no WhatsApp'
  if (meta.store_event === 'phone_click') return 'Clicou no telefone'
  const r: Record<string, string> = {
    page_view: 'Abriu uma página',
    page_leave: 'Saiu da página',
    click: 'Clicou',
    product_view: 'Viu o produto',
    add_to_cart: 'Pôs no carrinho',
    remove_from_cart: 'Tirou do carrinho',
    begin_checkout: 'Fez um pedido (aguardando pagamento)',
    purchase: 'Comprou (pagamento confirmado)',
    search: 'Buscou',
    lead: FORMULARIO[String(meta.form)] ?? 'Deixou o contato',
    form_submit: 'Enviou um formulário',
    signup: 'Criou conta na loja',
    cart_abandoned: 'Abandonou o carrinho',
  }
  return r[tipo] ?? tipo
}

// Uma linha por evento importante: "Abandonou o carrinho · R$ 231,90 · 1x Lixadeira (C4631)".
export function resumoEventoLoja(tipo: string, meta: Record<string, unknown>, valor: number | null): string {
  const pedido = pedidoDe(meta)
  const itens = itensDe(meta)
  const total = pedido?.total ?? valor ?? n(meta.value)
  const partes = [rotuloEventoLoja(tipo, meta)]
  if (pedido?.numero) partes.push(`pedido ${pedido.numero}`)
  if (total) partes.push(reais(total))
  if (pedido?.pagamento) partes.push(pedido.parcelas && pedido.parcelas > 1 ? `${pedido.pagamento} ${pedido.parcelas}x` : pedido.pagamento)
  if (s(meta.reason)) partes.push(`motivo: ${s(meta.reason)}`)
  if (itens.length) partes.push(itens.map((i) => `${i.quantidade}x ${i.nome}${i.sku ? ` (${i.sku})` : ''}`).join(', '))
  if (pedido?.cidade) partes.push(`${pedido.cidade}${pedido.uf ? `/${pedido.uf}` : ''}`)
  if (s(meta.interest)) partes.push(`interesse: ${s(meta.interest)}`)
  if (s(meta.recovery_url)) partes.push(`link do carrinho: ${s(meta.recovery_url)}`)
  return partes.join(' · ').slice(0, 1500)
}

// Eventos que merecem aviso ao vendedor e linha no histórico do lead.
export function eventoQuente(tipo: string, meta: Record<string, unknown>): boolean {
  if (tipo === 'cart_abandoned') return meta.store_event === 'payment_failed' || !n(meta.stage) || n(meta.stage) === 1
  return ['begin_checkout', 'purchase', 'lead', 'form_submit', 'signup'].includes(tipo)
}
