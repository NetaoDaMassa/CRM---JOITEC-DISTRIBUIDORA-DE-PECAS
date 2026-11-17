import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { chatConversas, chatMensagens, chatParticipantes, notifications, users } from '../db/schema.js'
import { businessHoursElapsedMs } from './businessHours.js'

// Chat interno: "toda mensagem precisa ter uma resposta" (João, 2026-11-17).
// A conversa fica pendente enquanto a última mensagem não for respondida por
// outra pessoa. Em grupo vale a resposta de qualquer um (decisão dele).
// Depois de 30 min úteis (seg-sex 8-12/13-17:48, sem feriado — mesma conta
// dos leads) vira notificação no sininho de quem precisa responder.
// Um "👍"/"ok"/"obrigado" sozinho fecha a conversa sem pedir resposta de
// volta — senão ninguém conseguiria encerrar uma conversa nunca.
export const MINUTOS_SEM_RESPOSTA = 30
const LIMITE_MS = MINUTOS_SEM_RESPOSTA * 60 * 1000

const CIENTE = /^(ok+|okay|blz|beleza|obrigad[oa]s?|obg|valeu|vlw|certo|show|perfeito|combinado|de nada|ciente|entendido|t[aá] bom|tmj)[\s!.]*$/i
export function ehCiente(m: { tipo: string; texto: string | null }): boolean {
  if (m.tipo !== 'texto') return false
  const t = (m.texto ?? '').trim()
  if (!t) return false
  if (CIENTE.test(t)) return true
  // Só emoji (👍 ✅ 🙏 …), sem letra nem número.
  return !/[\p{L}\p{N}]/u.test(t) && /\p{Extended_Pictographic}/u.test(t)
}

type Msg = { id: number; autorId: number; tipo: string; texto: string | null; createdAt: string }
export type Pendencia = { autorId: number; mensagemId: number; desde: string; texto: string | null; tipo: string }

// `desc` = mensagens da conversa, mais nova primeiro (sem as apagadas).
export function pendenciaDe(desc: Msg[]): Pendencia | null {
  const ultima = desc[0]
  if (!ultima || ehCiente(ultima)) return null
  let desde = ultima.createdAt
  for (const m of desc.slice(1)) {
    if (m.autorId !== ultima.autorId || ehCiente(m)) break
    desde = m.createdAt
  }
  return { autorId: ultima.autorId, mensagemId: ultima.id, desde, texto: ultima.texto, tipo: ultima.tipo }
}

export function atrasada(desde: string, agoraIso = new Date().toISOString()): boolean {
  return businessHoursElapsedMs(desde, agoraIso) >= LIMITE_MS
}

function previa(p: Pendencia): string {
  if (p.tipo !== 'texto') return p.tipo === 'audio' ? '🎤 áudio' : p.tipo === 'imagem' ? '📷 foto' : p.tipo === 'video' ? '🎬 vídeo' : '📎 arquivo'
  const t = (p.texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

// Roda a cada 5 min (scheduler). Só olha conversa com mensagem nos últimos
// 3 dias — o que já estava parado antes de ligar não vira avalanche de aviso.
export async function avisarMensagensSemResposta(): Promise<number> {
  const corte = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  const conversas = await db.query.chatConversas.findMany({
    where: and(isNull(chatConversas.deletedAt), gte(chatConversas.ultimaMensagemEm, corte)),
  })
  let avisos = 0
  for (const c of conversas) {
    const msgs = await db
      .select({ id: chatMensagens.id, autorId: chatMensagens.autorId, tipo: chatMensagens.tipo, texto: chatMensagens.texto, createdAt: chatMensagens.createdAt })
      .from(chatMensagens)
      .where(and(eq(chatMensagens.conversaId, c.id), isNull(chatMensagens.deletedAt)))
      .orderBy(desc(chatMensagens.createdAt), desc(chatMensagens.id))
      .limit(30)
    const p = pendenciaDe(msgs)
    if (!p || c.avisoSemRespostaMsgId === p.mensagemId || !atrasada(p.desde)) continue
    const parts = await db.query.chatParticipantes.findMany({ where: eq(chatParticipantes.conversaId, c.id) })
    const ids = [...new Set(parts.map((x) => x.userId))]
    const pessoas = ids.length ? await db.query.users.findMany({ where: inArray(users.id, ids), columns: { id: true, name: true, isActive: true } }) : []
    const autor = pessoas.find((u) => u.id === p.autorId)?.name ?? 'Alguém'
    const destino = pessoas.filter((u) => u.id !== p.autorId && u.isActive)
    const onde = c.tipoOrigem === 'direta' ? '' : ` em "${c.tituloSnapshot ?? 'conversa'}"`
    for (const u of destino) {
      await db.insert(notifications).values({
        vendedorId: u.id,
        conversaId: c.id,
        type: 'chat_sem_resposta',
        title: '💬 Mensagem sem resposta',
        message: `${autor}${onde}: "${previa(p)}" — esperando resposta há mais de ${MINUTOS_SEM_RESPOSTA} min.`,
      })
      avisos++
    }
    await db.update(chatConversas).set({ avisoSemRespostaMsgId: p.mensagemId }).where(eq(chatConversas.id, c.id))
  }
  return avisos
}

// Alguém respondeu: o aviso de "sem resposta" daquela conversa some do sininho.
export async function limparAvisosSemResposta(conversaId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.conversaId, conversaId), eq(notifications.type, 'chat_sem_resposta'), eq(notifications.read, false)))
}
