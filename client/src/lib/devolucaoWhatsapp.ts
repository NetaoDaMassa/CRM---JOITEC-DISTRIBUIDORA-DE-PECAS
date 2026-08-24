// Links wa.me pro módulo de Devolução — mesma ideia do sistema original:
// nada de API automática de WhatsApp, só um link pré-preenchido que abre o
// WhatsApp Web/app com a mensagem pronta pra enviar.

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo',
  em_andamento: 'Em andamento',
  analise: 'Análise',
  nota_fiscal_devolucao: 'Nota fiscal devolução',
  chegada_materiais: 'Chegada materiais',
  preparacao_envio: 'Preparação e envio',
  rastreio_transportadora: 'Rastreio transportadora',
  finalizado: 'Finalizado',
}

// Assume Brasil se vier só DDD+número (≤11 dígitos) — mesma regra do
// sistema original.
function normalizarTelefone(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

function buildRawWaLink(numero: string, mensagem: string): string {
  return `https://wa.me/${normalizarTelefone(numero)}?text=${encodeURIComponent(mensagem)}`
}

export function buildVendorNotificationWaLink(vendedorWhatsapp: string, protocolo: string, status: string, clienteNome: string): string {
  const msg = `Olá! O chamado de devolução ${protocolo} (cliente: ${clienteNome}) mudou de status: ${STATUS_LABEL[status] ?? status}.`
  return buildRawWaLink(vendedorWhatsapp, msg)
}

export function buildClientContactWaLink(clienteWhatsapp: string, clienteNome: string, protocolo: string): string {
  const msg = `Olá ${clienteNome}, tudo bem? Estou entrando em contato sobre o chamado de devolução ${protocolo}.`
  return buildRawWaLink(clienteWhatsapp, msg)
}

export function buildClientFeedbackWaLink(clienteWhatsapp: string, clienteNome: string, protocolo: string): string {
  const msg = `Olá ${clienteNome}! O chamado de devolução ${protocolo} foi finalizado. Poderia nos contar como foi o atendimento?`
  return buildRawWaLink(clienteWhatsapp, msg)
}
