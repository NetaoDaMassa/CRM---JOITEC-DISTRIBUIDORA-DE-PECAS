// Link wa.me pro botão "Notificar anexo no WhatsApp" em Arquivos/Mídia —
// mesma ideia de designWhatsapp.ts: nada de API automática, só abre o
// WhatsApp Web/app com a mensagem pronta, avisando que um arquivo novo foi
// enviado e onde achar. Pedido do João, 2026-10-01: escolhe NA HORA pra
// qual admin mandar (usa o WhatsApp já cadastrado em Usuários), em vez de
// um número fixo configurado de antemão.

function normalizarTelefone(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

export function buildNotificarAnexoWaLink(params: {
  adminWhatsapp: string
  nomeArquivo: string
  pastaNome: string
  pastaUrl: string
  enviadoPor: string
}): string {
  const msg = `Olá! ${params.enviadoPor} enviou o arquivo "${params.nomeArquivo}" na pasta "${params.pastaNome}" (Arquivos/Mídia): ${params.pastaUrl}`
  return `https://wa.me/${normalizarTelefone(params.adminWhatsapp)}?text=${encodeURIComponent(msg)}`
}
