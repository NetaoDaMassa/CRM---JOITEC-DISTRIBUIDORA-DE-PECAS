import { eq, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import { db } from '../db/client.js'
import { empresas, ligacaoAvaliacoes, pabxLigacoesProcessadas, users } from '../db/schema.js'
import { baixarAudioGravacao } from './gravacaoAudio.js'

// "Analisar ligação" — pedido do João, 2026-11-23: transcrever a gravação e
// apontar o que o vendedor fez bem e o que melhorar. Tudo pelo OpenRouter
// (mesma chave do Lead por print), gastando o mínimo:
//  1. Transcrição: se a central (PABXONE360) já mandou o texto, usa ele —
//     grátis. Senão, um modelo que ouve áudio (padrão Gemini 3.8 Flash,
//     ~R$0,02 por ligação de 5 min). O modelo grátis de áudio foi testado
//     e errava palavras ("tubo"→"tudo"), o que estragava a avaliação.
//  2. Avaliação: em cima do texto, modelo grátis (Nemotron Ultra); se ele
//     estiver ocupado/falhar, cai pro Claude Haiku (centavos de centavo).
// Modelos trocáveis por OPENROUTER_MODEL_TRANSCRICAO / _AVALIACAO.

const MODELO_TRANSCRICAO = () => process.env.OPENROUTER_MODEL_TRANSCRICAO || 'google/gemini-3.8-flash'
const MODELO_AVALIACAO = () => process.env.OPENROUTER_MODEL_AVALIACAO || 'nvidia/nemotron-3-ultra-550b-a55b:free'
const MODELO_AVALIACAO_RESERVA = 'anthropic/claude-haiku-5.5'

const AvaliacaoSchema = z.object({
  nota: z.number().int().min(0).max(10),
  resumo: z.string(),
  pontosFortes: z.array(z.string()),
  pontosMelhorar: z.array(z.string()),
  proximoPasso: z.string(),
})
type Avaliacao = z.infer<typeof AvaliacaoSchema>

export function iaLigacaoDisponivel() {
  return !!process.env.OPENROUTER_API_KEY
}

async function chamarOpenRouter(model: string, content: unknown, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'CRM - Analisar ligação' },
    body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: 'user', content }], ...extra }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    console.error('[avaliacao-ligacao]', model, 'respondeu', res.status, corpo.slice(0, 400))
    if (res.status === 402) throw new Error('O OpenRouter está sem crédito — coloque crédito em openrouter.ai → Credits.')
    if (res.status === 401) throw new Error('A chave do OpenRouter do CRM é inválida.')
    if (res.status === 429 || res.status >= 500) throw new Error('A IA está ocupada agora — tente de novo em 1 minuto.')
    throw new Error(`A IA recusou o pedido (${res.status}).`)
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const texto = String(json.choices?.[0]?.message?.content ?? '').trim()
  if (!texto) throw new Error('A IA não devolveu texto.')
  return texto
}

async function transcrever(links: string[], empresa: string, vendedor: string): Promise<string> {
  const partes: unknown[] = []
  for (const [i, link] of links.entries()) {
    const { audio, ext } = await baixarAudioGravacao(link)
    if (links.length > 1) partes.push({ type: 'text', text: `Parte ${i + 1} da ligação:` })
    partes.push({ type: 'input_audio', input_audio: { data: audio.toString('base64'), format: ext === 'wav' ? 'wav' : 'mp3' } })
  }
  partes.push({
    type: 'text',
    text:
      `Transcreva esta ligação telefônica de vendas em português do Brasil, do jeito que foi falado. O vendedor é ${vendedor}, da empresa "${empresa}" (Grupo Odin). ` +
      'Uma fala por linha, começando com "Vendedor:" (quem é da nossa empresa) ou "Cliente:". ' +
      'Trecho que não dá pra entender: [inaudível]. Música de espera, URA ou caixa postal: descreva entre colchetes. ' +
      'Responda só com a transcrição, sem comentários.',
  })
  return chamarOpenRouter(MODELO_TRANSCRICAO(), partes)
}

function promptAvaliacao(transcricao: string, empresa: string, vendedor: string) {
  return (
    `Você é um coach de vendas B2B. Avalie a ligação abaixo, feita por ${vendedor} da empresa "${empresa}" ` +
    '(Grupo Odin — distribuidora de compressores, tubos, peças e automação, vende para oficinas, revendas, indústrias e consumidor final).\n\n' +
    'Critérios: apresentação (nome e empresa); entender a necessidade com perguntas (aplicação, medida/especificação, quantidade, prazo, ' +
    'quem decide); pegar dados do cliente (nome, CNPJ, WhatsApp/e-mail); oferecer solução/alternativa e valor (não só preço); tratar ' +
    'objeções e urgência; combinar próximo passo concreto com data/hora; tom educado e profissional; escutar mais do que falar.\n\n' +
    'Responda:\n' +
    '- nota: 0 a 10 (seja exigente: 10 só se fez quase tudo dos critérios; ligação sem conversa de verdade — caixa postal, engano, ' +
    'cliente desligou — nota 0 e explique no resumo).\n' +
    '- resumo: 1 a 2 frases sobre o que aconteceu na ligação.\n' +
    '- pontosFortes: até 3, concretos, citando o que ele fez.\n' +
    '- pontosMelhorar: até 3, cada um dizendo O QUE faltou e a FRASE que ele poderia ter dito (ex: "Não pegou o nome do cliente. ' +
    'Poderia dizer: Com quem eu falo, por favor?").\n' +
    '- proximoPasso: o que ficou combinado (ou o que o vendedor deve fazer agora, se nada foi combinado).\n' +
    'Não invente nada que não está na transcrição. Escreva em português do Brasil.\n\n' +
    `<transcricao>\n${transcricao}\n</transcricao>`
  )
}

async function avaliar(transcricao: string, empresa: string, vendedor: string): Promise<{ avaliacao: Avaliacao; modelo: string }> {
  const { $schema: _s, ...schema } = z.toJSONSchema(AvaliacaoSchema) as Record<string, unknown>
  const extra = { response_format: { type: 'json_schema', json_schema: { name: 'avaliacao', strict: true, schema } } }
  const prompt = promptAvaliacao(transcricao, empresa, vendedor)
  let ultimoErro: unknown
  for (const modelo of [MODELO_AVALIACAO(), MODELO_AVALIACAO_RESERVA]) {
    try {
      const texto = await chamarOpenRouter(modelo, prompt, extra)
      const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1))
      return { avaliacao: AvaliacaoSchema.parse(json), modelo }
    } catch (e) {
      ultimoErro = e
      console.error('[avaliacao-ligacao] avaliação falhou com', modelo, (e as Error).message)
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Não foi possível avaliar a ligação.')
}

// Ligação em andamento há mais que isso = processo morreu (ex: deploy no meio) — deixa refazer.
const TRAVADA_MS = 10 * 60_000

export async function iniciarAvaliacao(ligacaoId: number, userId: number): Promise<void> {
  if (!iaLigacaoDisponivel()) throw new Error('A IA não está configurada no servidor (falta a chave do OpenRouter).')
  const lig = await db.query.pabxLigacoesProcessadas.findFirst({ where: eq(pabxLigacoesProcessadas.id, ligacaoId) })
  if (!lig) throw new Error('Ligação não encontrada.')
  const links = (lig.linkGravacao ?? '').split('\n').filter(Boolean)
  const transcricaoCentral = (lig.transcricao ?? '').trim()
  if (!links.length && transcricaoCentral.length < 40) throw new Error('Essa ligação não tem gravação.')

  const atual = await db.query.ligacaoAvaliacoes.findFirst({ where: eq(ligacaoAvaliacoes.ligacaoId, ligacaoId) })
  if (atual?.status === 'processando' && Date.now() - Date.parse(atual.atualizadoEm.replace(' ', 'T') + 'Z') < TRAVADA_MS) return

  const zerado = { status: 'processando' as const, erro: null, nota: null, resumo: null, pontosFortes: null, pontosMelhorar: null, proximoPasso: null, criadoPorId: userId, atualizadoEm: sql`(datetime('now'))` }
  await db
    .insert(ligacaoAvaliacoes)
    .values({ ligacaoId, ...zerado })
    .onConflictDoUpdate({ target: ligacaoAvaliacoes.ligacaoId, set: zerado })

  void processar(ligacaoId, lig, links, transcricaoCentral)
}

async function processar(
  ligacaoId: number,
  lig: typeof pabxLigacoesProcessadas.$inferSelect,
  links: string[],
  transcricaoCentral: string
) {
  try {
    const [emp, vend] = await Promise.all([
      lig.empresaId ? db.query.empresas.findFirst({ where: eq(empresas.id, lig.empresaId), columns: { nome: true } }) : null,
      lig.userId ? db.query.users.findFirst({ where: eq(users.id, lig.userId), columns: { name: true } }) : null,
    ])
    const nomeEmpresa = emp?.nome ?? 'Grupo Odin'
    const nomeVendedor = vend?.name ?? 'o vendedor'
    // Reaproveita a transcrição já feita numa análise anterior (refazer só a avaliação sai de graça).
    const anterior = await db.query.ligacaoAvaliacoes.findFirst({ where: eq(ligacaoAvaliacoes.ligacaoId, ligacaoId), columns: { transcricao: true, fonteTranscricao: true } })
    let transcricao = anterior?.transcricao ?? ''
    let fonte = anterior?.fonteTranscricao ?? null
    if (!transcricao) {
      if (transcricaoCentral.length >= 40) [transcricao, fonte] = [transcricaoCentral, 'central']
      else [transcricao, fonte] = [await transcrever(links, nomeEmpresa, nomeVendedor), 'ia']
      await db.update(ligacaoAvaliacoes).set({ transcricao, fonteTranscricao: fonte, atualizadoEm: sql`(datetime('now'))` }).where(eq(ligacaoAvaliacoes.ligacaoId, ligacaoId))
    }
    const { avaliacao, modelo } = await avaliar(transcricao, nomeEmpresa, nomeVendedor)
    await db
      .update(ligacaoAvaliacoes)
      .set({
        status: 'pronta',
        nota: avaliacao.nota,
        resumo: avaliacao.resumo,
        pontosFortes: JSON.stringify(avaliacao.pontosFortes.slice(0, 3)),
        pontosMelhorar: JSON.stringify(avaliacao.pontosMelhorar.slice(0, 3)),
        proximoPasso: avaliacao.proximoPasso,
        modelo: fonte === 'ia' ? `${MODELO_TRANSCRICAO()} + ${modelo}` : modelo,
        atualizadoEm: sql`(datetime('now'))`,
      })
      .where(eq(ligacaoAvaliacoes.ligacaoId, ligacaoId))
  } catch (e) {
    console.error('[avaliacao-ligacao] ligação', ligacaoId, e)
    await db
      .update(ligacaoAvaliacoes)
      .set({ status: 'erro', erro: (e as Error).message.slice(0, 300), atualizadoEm: sql`(datetime('now'))` })
      .where(eq(ligacaoAvaliacoes.ligacaoId, ligacaoId))
  }
}

export async function lerAvaliacao(ligacaoId: number) {
  const a = await db.query.ligacaoAvaliacoes.findFirst({ where: eq(ligacaoAvaliacoes.ligacaoId, ligacaoId) })
  if (!a) return null
  const lista = (v: string | null) => {
    try {
      return v ? (JSON.parse(v) as string[]) : []
    } catch {
      return []
    }
  }
  return { ...a, pontosFortes: lista(a.pontosFortes), pontosMelhorar: lista(a.pontosMelhorar) }
}
