import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'
// zodOutputFormat exige schemas construídos com a API do zod/v4 (o pacote
// `zod` do resto do projeto é v3) — import isolado só pra esse arquivo, não
// afeta a validação de input do tRPC no resto do app.
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

const ItemSchema = z.object({
  descricao: z.string(),
  quantidade: z.number().nullable(),
  valorUnitario: z.number().nullable(),
})

const ExtracaoSchema = z.object({
  itens: z.array(ItemSchema),
})

export type ItemExtraido = z.infer<typeof ItemSchema>

let cliente: Anthropic | null = null
function obterCliente(): Anthropic {
  if (!cliente) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurado no .env — peça pro admin configurar antes de usar a extração por IA.')
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}

// Lê o PDF do pedido/nota já salvo em disco (mesmo arquivo do upload normal)
// e pede pra Claude extrair os itens em formato estruturado, pra pré-preencher
// o editor de itens do pedido antes do vendedor confirmar o fechamento.
export async function extrairItensDoPdf(caminhoArquivo: string): Promise<ItemExtraido[]> {
  const base64 = fs.readFileSync(caminhoArquivo).toString('base64')

  const response = await obterCliente().messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(ExtracaoSchema),
      effort: 'medium',
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text:
              'Este é um PDF de pedido de venda ou nota fiscal brasileira. Extraia todos os itens/produtos vendidos, ' +
              'um por linha, com descrição, quantidade e valor unitário em reais (sem símbolo, usando ponto decimal). ' +
              'Se a quantidade ou o valor unitário não estiverem claros no documento, retorne null nesse campo — não invente. ' +
              'Ignore linhas de totais, subtotais, impostos, frete, desconto e qualquer cabeçalho/rodapé que não seja item de produto/serviço.',
          },
        ],
      },
    ],
  })

  if (!response.parsed_output) {
    throw new Error('Não foi possível extrair os itens deste PDF automaticamente — preencha manualmente.')
  }

  return response.parsed_output.itens
}
