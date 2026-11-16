import Anthropic from '@anthropic-ai/sdk'
// Mesmo esquema do pdfExtraction.ts: zodOutputFormat exige zod/v4 (o resto
// do projeto usa zod v3) — import isolado só aqui.
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

// "Novo lead por print" — pedido do João, 2026-11-16: sem API (oficial ou
// não) no WhatsApp, os leads que chegam das campanhas de WhatsApp eram
// redigitados na mão. Aqui o vendedor/admin manda o(s) print(s) da conversa
// (ou cola o texto copiado do WhatsApp Web / o .txt de "Exportar conversa")
// e a IA devolve os campos do lead já preenchidos. Ninguém salva nada sem
// conferir — a tela de Criar lead mostra tudo pra revisar antes.

const SEGMENTOS = ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'] as const

const LeadLidoSchema = z.object({
  nome: z.string().nullable(),
  // Só dígitos, com DDD, sem o 55 — ex: "11988887777". Null se o print não
  // mostra o número (contato salvo no celular aparece só com o nome).
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  empresa: z.string().nullable(),
  cnpj: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  segmento: z.enum(SEGMENTOS).nullable(),
  produtoInteresse: z.string().nullable(),
  resumo: z.string().nullable(),
  // Nome EXATO de uma das campanhas passadas no prompt, ou null.
  campanha: z.string().nullable(),
  // A conversa transcrita, uma mensagem por linha ("Cliente: ..." / "Nós: ...").
  conversa: z.string().nullable(),
})

export type LeadLido = z.infer<typeof LeadLidoSchema>

export type ImagemPrint = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }

let cliente: Anthropic | null = null
function obterCliente(): Anthropic {
  if (!cliente) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('Leitura por IA não configurada no servidor — preencha o lead manualmente.')
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}

function erroAmigavel(e: unknown): Error {
  const status = (e as { status?: number })?.status
  console.error('[lead-por-print] falha ao chamar Anthropic:', e)
  if (status === 401) return new Error('Leitura por IA indisponível (chave de API inválida) — preencha manualmente.')
  if (status === 400) return new Error('Leitura por IA indisponível no momento — preencha manualmente.')
  if (status === 429 || (status ?? 0) >= 500) return new Error('A leitura por IA está ocupada agora — tente de novo em alguns segundos.')
  return new Error('Não foi possível ler esse print automaticamente — preencha manualmente.')
}

function instrucoes(nomeEmpresa: string, campanhas: string[]): string {
  return (
    `Você está ajudando a equipe comercial da empresa "${nomeEmpresa}" a cadastrar um lead (cliente em potencial) ` +
    'no CRM a partir de uma conversa de WhatsApp. O material abaixo são prints da tela do WhatsApp (celular ou ' +
    'WhatsApp Web) e/ou o texto copiado/exportado da conversa. Se houver vários prints, são partes da MESMA ' +
    'conversa com o MESMO cliente — junte tudo.\n\n' +
    'Quem é o cliente: é a outra pessoa da conversa. Mensagens à direita/verdes são da nossa empresa; à ' +
    'esquerda/brancas são do cliente. No texto exportado, o nome antes dos dois pontos indica quem falou.\n\n' +
    'Preencha:\n' +
    '- nome: nome da pessoa (do topo da conversa ou de quando ela se apresenta). Se o topo mostra só um número, ' +
    'procure o nome nas mensagens; se não houver, null.\n' +
    '- telefone: só dígitos, com DDD e SEM o 55 do Brasil (ex: "+55 11 98888-7777" → "11988887777"). Procure no ' +
    'topo da conversa, na tela de dados do contato ou em número digitado nas mensagens. Nunca invente — se não ' +
    'aparecer, null.\n' +
    '- email, empresa (razão social ou nome da empresa do cliente), cnpj (só dígitos), cidade e uf (sigla de 2 ' +
    'letras): só se aparecerem ou forem ditos na conversa. DDD não é cidade — não deduza a cidade pelo DDD.\n' +
    '- segmento: "assistente_tecnico", "instalador", "revendedor_lojista" ou "outros", só se der pra saber pela ' +
    'conversa (ex: "tenho uma loja" → revendedor_lojista; "faço manutenção" → assistente_tecnico). Na dúvida, null.\n' +
    '- produtoInteresse: o produto/peça/serviço que o cliente quer, curto (ex: "Compressor 10 pés 110V").\n' +
    '- resumo: 1 a 3 frases dizendo o que o cliente quer e em que pé a conversa ficou, pro vendedor já chegar ' +
    'sabendo (ex: "Pediu preço do compressor X para oficina. Aguardando orçamento.").\n' +
    (campanhas.length
      ? `- campanha: se a conversa indicar de qual campanha o cliente veio (mensagem automática do anúncio, ` +
        `código tipo "cód. XX", nome do produto anunciado), escolha o nome EXATO de uma destas: ` +
        `${campanhas.map((c) => `"${c}"`).join(', ')}. Se não der pra saber com segurança, null.\n`
      : '- campanha: null.\n') +
    '- conversa: transcreva as mensagens visíveis em ordem, uma por linha, começando com "Cliente:" ou "Nós:" ' +
    '(com o horário entre colchetes quando aparecer, ex: "[14:32] Cliente: bom dia"). Para áudio/foto/figurinha ' +
    'escreva só "[áudio]", "[foto]" etc. Não resuma aqui — copie o texto.\n\n' +
    'Se o material não for uma conversa de WhatsApp/contato, devolva tudo null.'
  )
}

export async function lerLeadDoPrint(params: {
  imagens: ImagemPrint[]
  texto?: string
  nomeEmpresa: string
  campanhas: string[]
}): Promise<LeadLido> {
  const conteudo: Anthropic.ContentBlockParam[] = []
  params.imagens.forEach((img, i) => {
    if (params.imagens.length > 1) conteudo.push({ type: 'text', text: `Print ${i + 1}:` })
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })
  })
  if (params.texto?.trim()) {
    conteudo.push({ type: 'text', text: `Texto da conversa (copiado/exportado do WhatsApp):\n<conversa>\n${params.texto.trim()}\n</conversa>` })
  }
  conteudo.push({ type: 'text', text: instrucoes(params.nomeEmpresa, params.campanhas) })

  let response: Awaited<ReturnType<Anthropic['messages']['parse']>>
  try {
    response = await obterCliente().messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(LeadLidoSchema), effort: 'low' },
      messages: [{ role: 'user', content: conteudo }],
    })
  } catch (e) {
    throw erroAmigavel(e)
  }

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    console.error('[lead-por-print] sem saída estruturada, stop_reason =', response.stop_reason)
    throw new Error('Não foi possível ler esse print automaticamente — preencha manualmente.')
  }
  return response.parsed_output as LeadLido
}
