// Link wa.me pro botão "Contestar no WhatsApp" em Solicitação de Crédito —
// mesma ideia do designWhatsapp.ts: abre o WhatsApp direto com o responsável
// que decidiu (campo decididoPor), mensagem já pronta com o cliente e a
// decisão, pra discutir sem precisar procurar o contato. Pedido do João,
// 2026-10-01.

function normalizarTelefone(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

export function buildContestarCreditoWaLink(params: {
  decisorWhatsapp: string
  vendedorNome: string
  clienteNome: string
  decisao: 'liberado' | 'negado'
  motivoResposta: string
}): string {
  const decisaoTexto = params.decisao === 'liberado' ? 'liberado' : 'negado'
  const msg = `Olá! Aqui é ${params.vendedorNome}. Vi que o crédito do cliente "${params.clienteNome}" foi ${decisaoTexto} — motivo: "${params.motivoResposta}". Posso conversar sobre isso?`
  return `https://wa.me/${normalizarTelefone(params.decisorWhatsapp)}?text=${encodeURIComponent(msg)}`
}
