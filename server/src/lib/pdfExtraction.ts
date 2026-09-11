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
  // Valor total daquela linha (quantidade × valor unitário), só quando o
  // documento já mostra essa coluna pronta — não é devolvido pro cliente,
  // serve só de âncora interna: se `valorUnitario` não bater com
  // `valorTotalLinha / quantidade`, é sinal de que a IA leu a coluna errada
  // (unitário vs total vs código), e o valor recalculado abaixo corrige.
  valorTotalLinha: z.number().nullable(),
})

const ExtracaoSchema = z.object({
  itens: z.array(ItemSchema),
  condicaoPagamento: z.string().nullable(),
  valorTotal: z.number().nullable(),
})

export type ItemExtraido = z.infer<typeof ItemSchema>
export type ExtracaoPedido = z.infer<typeof ExtracaoSchema>

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
// e pede pra Claude extrair os itens, a condição de pagamento e o valor total
// em formato estruturado, pra pré-preencher o fechamento do pedido antes do
// vendedor confirmar (ele sempre pode revisar/corrigir antes de salvar).
// Erros crus da Anthropic (chave inválida, saldo insuficiente, etc.) não
// são acionáveis pro vendedor no meio de um fechamento — mostra uma
// mensagem clara pra ele preencher na mão, e loga o motivo técnico real só
// no servidor (pro admin investigar sem expor detalhe de billing/API pra
// quem tá vendendo).
function erroAmigavel(e: unknown): Error {
  const status = (e as { status?: number })?.status
  console.error('[pdf-extraction] falha ao chamar Anthropic:', e)
  if (status === 401) return new Error('Extração por IA indisponível (chave de API inválida) — preencha os itens manualmente.')
  if (status === 400) return new Error('Extração por IA indisponível no momento (sem crédito na conta da Anthropic) — preencha os itens manualmente.')
  return new Error('Não foi possível extrair os dados deste PDF automaticamente — preencha manualmente.')
}

export async function extrairItensDoPdf(caminhoArquivo: string): Promise<ExtracaoPedido> {
  const base64 = fs.readFileSync(caminhoArquivo).toString('base64')

  let response: Awaited<ReturnType<Anthropic['messages']['parse']>>
  try {
    response = await obterCliente().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(ExtracaoSchema),
        effort: 'high',
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            {
              type: 'text',
              text:
                'Este é um PDF de pedido de venda ou nota fiscal brasileira. Extraia:\n' +
                '1. Todos os itens/produtos vendidos, um por linha. Essas tabelas costumam ter VÁRIAS colunas ' +
                'numéricas lado a lado (Código, NCM, CST, CFOP, Unidade, Quantidade, Valor Unitário, Valor Total, ' +
                'Desconto, Base ICMS, Valor ICMS, Valor IPI...) — a prioridade nº 1 é acertar a QUANTIDADE de cada ' +
                'item, não confundindo com essas outras colunas:\n' +
                '   - NCM tem formato "0000.00.00" (8 dígitos com pontos) e CST/CFOP são códigos de 3-4 dígitos — ' +
                'NUNCA são quantidade nem valor, ignore-os completamente.\n' +
                '   - A coluna de quantidade fica normalmente logo após "Unidade/UN/PC/CX/KG" e é o único número da ' +
                'linha que representa "quantas peças", geralmente pequeno (1 a poucas centenas) — confira o ' +
                'cabeçalho da coluna (Qtd/Quant/Quantidade) pra ter certeza de qual número é esse antes de decidir.\n' +
                '   - Valor Unitário e Valor Total são colunas DIFERENTES: valor unitário é o preço de UMA peça, ' +
                'valor total da linha é quantidade × valor unitário (maior). Não pegue o valor total achando que é o ' +
                'unitário — se aparecerem as duas colunas na linha, preencha `valorUnitario` com a coluna de preço ' +
                'unitário e `valorTotalLinha` com a coluna de total da linha, cada uma no seu campo.\n' +
                '   - Formato de número brasileiro: vírgula é decimal, ponto é separador de milhar (ex: "1.234,56" ' +
                '= 1234.56). Em documentos gerados por sistema às vezes o separador decimal é só ponto (ex: ' +
                '"29.67" = 29.67) — nesse caso NÃO trate esse ponto como separador de milhar. Na dúvida sobre qual ' +
                'é o caso, use o valor que fizer `quantidade × valorUnitario` ficar perto de `valorTotalLinha` (se ' +
                'essa coluna existir na linha).\n' +
                '   - Se a quantidade ou o valor unitário não estiverem claros mesmo após essa checagem, retorne ' +
                'null nesse campo — é preferível null a um número inventado ou lido da coluna errada, especialmente ' +
                'pro valor (a quantidade é o que mais importa acertar aqui).\n' +
                '   Ignore COMPLETAMENTE linhas de totais, subtotais, impostos (ICMS/IPI/ISS etc.), frete, ' +
                'desconto, condição de pagamento e qualquer cabeçalho/rodapé/dado cadastral (CNPJ, endereço, número ' +
                'do pedido) — só o que é produto/serviço vendido de fato entra na lista.\n' +
                '   Cada produto diferente é UMA linha só: se o mesmo produto aparecer repetido no documento (ex: ' +
                'resumo + detalhamento), não duplique — extraia uma única vez, preferindo a linha mais detalhada ' +
                '(a que tiver quantidade E valores claros). Escreva a descrição exatamente como no documento, só ' +
                'limpando espaços duplicados e códigos internos soltos sem nome (mantenha o código se ele fizer ' +
                'parte do nome do produto, ex: "Filtro de óleo PH-123").\n' +
                '2. A condição de pagamento (ex: "À vista", "Boleto 30/60", "3x no cartão") se estiver escrita no ' +
                'documento — null se não encontrar.\n' +
                '3. O valor total do pedido (o total geral pago/a pagar, já com impostos e descontos aplicados, em ' +
                'reais, ponto decimal) — null se não encontrar um total claro.',
            },
          ],
        },
      ],
    })
  } catch (e) {
    throw erroAmigavel(e)
  }

  if (!response.parsed_output) {
    throw new Error('Não foi possível extrair os dados deste PDF automaticamente — preencha manualmente.')
  }

  // Segunda checada, em cima do que a IA já devolveu: quando a linha tem
  // quantidade + valorTotalLinha mas o valorUnitario não bate com
  // valorTotalLinha/quantidade (diferença > 5%), o unitário foi lido da
  // coluna errada — recalcula em vez de propagar um valor inflado pro
  // fechamento da venda (achado do João, 2026-09-11: item saindo 90x maior
  // que o esperado por causa disso).
  const itensCorrigidos = response.parsed_output.itens.map((item: ItemExtraido) => {
    if (item.quantidade && item.quantidade > 0 && item.valorTotalLinha != null && item.valorTotalLinha > 0) {
      const unitarioEsperado = item.valorTotalLinha / item.quantidade
      const divergeMuito = item.valorUnitario == null || Math.abs(item.valorUnitario - unitarioEsperado) / unitarioEsperado > 0.05
      if (divergeMuito) return { ...item, valorUnitario: Math.round(unitarioEsperado * 100) / 100 }
    }
    return item
  })

  return { ...response.parsed_output, itens: itensCorrigidos }
}
