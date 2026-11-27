// "✨ Sugerir resposta" no chat (João, 2026-11-27: "sugestão da IA, já deixar
// criado"). Lê as últimas mensagens da conversa e devolve até 3 respostas
// curtas; a pessoa escolhe uma, ela cai na caixa de texto e dá pra editar
// antes de mandar (nunca envia sozinho). Mesmo OpenRouter grátis da análise de
// ligação; modelo trocável por OPENROUTER_MODEL_CHAT.

const MODELO = () => process.env.OPENROUTER_MODEL_CHAT || 'nvidia/nemotron-3-ultra-550b-a55b:free'
const MODELO_RESERVA = 'meta-llama/llama-3.3-70b-instruct:free'

export function sugestaoDisponivel(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

type Msg = { autor: string; minha: boolean; texto: string }

export async function sugerirRespostas(opts: { eu: string; assunto: string; mensagens: Msg[] }): Promise<string[]> {
  if (!sugestaoDisponivel()) throw new Error('A sugestão da IA ainda não está ligada neste CRM (falta a chave do OpenRouter).')
  const conversa = opts.mensagens.map((m) => `${m.minha ? `${opts.eu} (eu)` : m.autor}: ${m.texto}`).join('\n')
  const prompt = `Você ajuda ${opts.eu}, funcionário(a) de uma distribuidora (CRM interno, colegas de trabalho conversando).
Assunto da conversa: ${opts.assunto || 'conversa interna'}.

Últimas mensagens:
${conversa}

Escreva 3 opções de resposta curtas (no máximo 2 frases cada), em português do Brasil, tom profissional e direto, como mensagem de WhatsApp entre colegas.
Não invente números de pedido, valores ou datas que não aparecem na conversa.
Responda SÓ com JSON: {"sugestoes":["...","...","..."]}`

  let ultimoErro: Error | null = null
  for (const model of [MODELO(), MODELO_RESERVA]) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'CRM - Chat sugestao' },
        body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(45_000),
      })
      if (res.status === 402) throw new Error('O OpenRouter está sem crédito.')
      if (!res.ok) throw new Error(`IA respondeu ${res.status}`)
      const json: any = await res.json()
      const texto: string = json?.choices?.[0]?.message?.content ?? ''
      const bloco = texto.match(/\{[\s\S]*\}/)?.[0]
      const lista = bloco ? JSON.parse(bloco).sugestoes : null
      if (Array.isArray(lista) && lista.length) return lista.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 3).map((s: string) => s.trim())
      throw new Error('IA não devolveu sugestões')
    } catch (e) {
      ultimoErro = e as Error
      console.error('[chat-sugestao]', model, ultimoErro.message)
    }
  }
  throw new Error(`Não consegui gerar sugestão agora (${ultimoErro?.message ?? 'erro'}). Tente de novo em instantes.`)
}
