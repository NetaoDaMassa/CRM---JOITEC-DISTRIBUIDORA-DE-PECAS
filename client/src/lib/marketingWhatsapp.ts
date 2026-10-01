// Link wa.me pro botão "Notificar anexo no WhatsApp" em Arquivos/Mídia —
// mesma ideia de designWhatsapp.ts: nada de API automática, só abre o
// WhatsApp Web/app com a mensagem pronta pro número do gerente (cadastrado
// em Configurações > Notificações), avisando que um arquivo novo foi
// enviado e onde achar. Pedido do João, 2026-10-01.

function normalizarTelefone(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

export function buildNotificarAnexoWaLink(params: {
  whatsappGerente: string
  nomeArquivo: string
  pastaNome: string
  pastaUrl: string
  enviadoPor: string
}): string {
  const msg = `Olá! ${params.enviadoPor} enviou o arquivo "${params.nomeArquivo}" na pasta "${params.pastaNome}" (Arquivos/Mídia): ${params.pastaUrl}`
  return `https://wa.me/${normalizarTelefone(params.whatsappGerente)}?text=${encodeURIComponent(msg)}`
}
