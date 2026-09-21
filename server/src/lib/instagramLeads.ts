// Cria o lead a partir de um evento de Instagram já roteado pra empresa
// certa (ver routes/instagram.ts) — mesmo padrão de leadsBrevo.ts: nasce
// sem telefone/DDD, sem vendedor (não dá pra rodízio por DDD sem telefone;
// alguém completa e atribui na mão depois). Pedido do João, 2026-09-21.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, instagramAccounts, instagramAutomationSettings } from '../db/schema.js'
import { enviarPrivateReply, enviarMensagemDireta } from './instagramApi.js'

async function criarLeadInstagram(
  empresaId: number,
  dados: { igUserId: string; igUsername: string | null; source: 'instagram_comment_keyword' | 'instagram_first_dm'; triggerText: string }
): Promise<void> {
  const nome = dados.igUsername ? `@${dados.igUsername}` : `Instagram ${dados.igUserId}`
  const result = await db.insert(leads).values({
    empresaId,
    name: nome,
    source: dados.source,
    igUserId: dados.igUserId,
    igUsername: dados.igUsername,
    igTriggerText: dados.triggerText.slice(0, 2000),
    statusChangedAt: new Date().toISOString(),
  })
  const leadId = Number(result.lastInsertRowid)

  await db.insert(leadHistory).values({
    empresaId,
    leadId,
    action: 'criado',
    toStatus: 'novo',
    details:
      dados.source === 'instagram_comment_keyword'
        ? 'Lead criado a partir de comentário com palavra-chave no Instagram — sem telefone, sem vendedor até completar.'
        : 'Lead criado a partir da primeira mensagem direta no Instagram — sem telefone, sem vendedor até completar.',
  })
}

// Gatilho 1: comentário num post/reels contendo uma das trigger_keywords da
// empresa → private reply + lead. `bateu por engano` (falso positivo) fica
// por conta de a empresa escolher palavras-chave específicas o bastante —
// não tem outra defesa aqui.
export async function processarComentarioInstagram(
  empresaId: number,
  commentId: string,
  textoComentario: string,
  igUserId: string,
  igUsername: string | null
): Promise<void> {
  const conta = await db.query.instagramAccounts.findFirst({ where: eq(instagramAccounts.empresaId, empresaId) })
  if (!conta || conta.status !== 'conectado') return

  const config = await db.query.instagramAutomationSettings.findFirst({ where: eq(instagramAutomationSettings.empresaId, empresaId) })
  const keywords: string[] = config ? (JSON.parse(config.triggerKeywords) as string[]) : []
  if (!keywords.length) return

  const textoNormalizado = textoComentario.toLowerCase()
  const bateu = keywords.some((k) => k.trim() && textoNormalizado.includes(k.trim().toLowerCase()))
  if (!bateu) return

  const mensagem = config?.commentReplyMessage || 'Oi! Te chamei no direct 😊'
  try {
    await enviarPrivateReply(commentId, conta.pageAccessTokenEnc, mensagem)
  } catch (err) {
    // Não trava a criação do lead por causa disso — o sinal de interesse é
    // real mesmo se a resposta automática falhar (token expirado, comentário
    // apagado antes da gente responder etc.). Fica só no log.
    console.error('[instagram] falha ao enviar private reply:', err)
  }

  await criarLeadInstagram(empresaId, { igUserId, igUsername, source: 'instagram_comment_keyword', triggerText: textoComentario })
}

// Gatilho 2: primeira mensagem direta desse ig_user_id pra essa empresa →
// DM de boas-vindas + lead. "Primeira" é checado pelo próprio histórico de
// leads (não existe ainda um lead com esse igUserId+source aqui) — se a
// pessoa mandar mensagem de novo depois, não manda boas-vindas outra vez.
export async function processarPrimeiraDmInstagram(empresaId: number, igUserId: string, igUsername: string | null, textoMensagem: string): Promise<void> {
  const conta = await db.query.instagramAccounts.findFirst({ where: eq(instagramAccounts.empresaId, empresaId) })
  if (!conta || conta.status !== 'conectado') return

  const jaTemLead = await db.query.leads.findFirst({
    where: and(eq(leads.empresaId, empresaId), eq(leads.igUserId, igUserId), eq(leads.source, 'instagram_first_dm')),
  })
  if (jaTemLead) return

  const config = await db.query.instagramAutomationSettings.findFirst({ where: eq(instagramAutomationSettings.empresaId, empresaId) })
  const mensagem = config?.welcomeDmMessage || 'Olá! Obrigado por entrar em contato.'
  try {
    await enviarMensagemDireta(igUserId, conta.pageAccessTokenEnc, mensagem)
  } catch (err) {
    console.error('[instagram] falha ao enviar DM de boas-vindas:', err)
  }

  await criarLeadInstagram(empresaId, { igUserId, igUsername, source: 'instagram_first_dm', triggerText: textoMensagem })
}
