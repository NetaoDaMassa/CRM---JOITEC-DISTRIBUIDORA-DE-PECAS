// Link wa.me pro botão "Avisar no WhatsApp" em Aprovações → Arte/Design
// (aba de aprovados) — mesma ideia do devolucaoWhatsapp.ts: nada de API
// automática, só abre o WhatsApp Web/app com a mensagem pronta, avisando o
// vendedor que a arte/vídeo pedido está pronta e onde achar o arquivo, com
// link direto pra pasta em Arquivos/Mídia. Pedido do João, 2026-09-15.

const TIPO_LABEL: Record<string, string> = { comunicado: 'a arte', oferta: 'a arte', banner: 'a arte', video: 'o vídeo' }

function normalizarTelefone(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

export function buildDesignFinalizadoWaLink(params: {
  vendedorWhatsapp: string
  tipo: string
  nomeApresentacao: string
  pastaNome: string
  pastaUrl: string
}): string {
  const artigo = TIPO_LABEL[params.tipo] ?? 'o material'
  const msg = `Olá! Segue ${artigo} "${params.nomeApresentacao}" — está na pasta "${params.pastaNome}": ${params.pastaUrl}\n\nQualquer alteração, por favor avise o gerente.`
  return `https://wa.me/${normalizarTelefone(params.vendedorWhatsapp)}?text=${encodeURIComponent(msg)}`
}
