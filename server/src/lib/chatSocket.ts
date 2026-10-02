import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { eq } from 'drizzle-orm'
import { verifyToken } from './jwt.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { agoraSqlite } from './dataBr.js'

// Camada de tempo real do Chat Grupo Odin — SEPARADA de propósito da
// automação de WhatsApp (Baileys, ver whatsapp/session.ts): não importa,
// não chama e não depende dela em nenhum momento. Cada aba/dispositivo
// autenticado abre um socket e entra na sala `user:<id>` (pra receber
// qualquer evento endereçado a ele, tipo "tem mensagem nova" mesmo sem a
// conversa aberta) — quando uma tela de conversa está realmente aberta,
// o cliente também entra na sala `conversa:<id>` pra receber as mensagens
// daquela conversa em tempo real.
//
// Presença online/offline é por socket, não por usuário: alguém pode ter
// 2 abas abertas, então só marca offline quando o ÚLTIMO socket daquele
// usuário cai (com um pequeno atraso pra tolerar reconexão rápida — troca
// de página, F5 — sem piscar online/offline à toa).
let io: Server | undefined
const socketsPorUsuario = new Map<number, Set<string>>()
const timersOffline = new Map<number, NodeJS.Timeout>()
const ATRASO_OFFLINE_MS = 5000

async function marcarOnline(userId: number) {
  const timer = timersOffline.get(userId)
  if (timer) {
    clearTimeout(timer)
    timersOffline.delete(userId)
  }
  await db.update(users).set({ chatOnline: true }).where(eq(users.id, userId))
  io?.to('chat:presenca').emit('chat:presenca', { userId, online: true })
}

function agendarOffline(userId: number) {
  const timer = setTimeout(async () => {
    timersOffline.delete(userId)
    if (socketsPorUsuario.get(userId)?.size) return // reconectou antes do atraso passar
    await db.update(users).set({ chatOnline: false, chatUltimaAtividadeEm: agoraSqlite() }).where(eq(users.id, userId))
    io?.to('chat:presenca').emit('chat:presenca', { userId, online: false })
  }, ATRASO_OFFLINE_MS)
  timersOffline.set(userId, timer)
}

export function iniciarChatSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || '*' },
    path: '/chat-socket',
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    const payload = token ? verifyToken(token) : null
    if (!payload) return next(new Error('Não autenticado'))
    socket.data.userId = payload.id
    socket.data.userName = payload.name
    next()
  })

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as number
    socket.join(`user:${userId}`)
    // Toda conexão também entra na sala geral de presença, pra receber o
    // "fulano ficou online/offline" de qualquer colega, não só de quem já
    // tem conversa aberta com ela.
    socket.join('chat:presenca')

    const atuais = socketsPorUsuario.get(userId) ?? new Set<string>()
    atuais.add(socket.id)
    socketsPorUsuario.set(userId, atuais)
    marcarOnline(userId).catch((err) => console.error('[chat-socket] falha ao marcar online:', err))

    // Cliente pede pra "seguir" uma conversa específica enquanto a tela
    // dela está aberta — sai da sala ao fechar/trocar de conversa.
    socket.on('chat:entrarConversa', (conversaId: number) => {
      socket.join(`conversa:${conversaId}`)
    })
    socket.on('chat:sairConversa', (conversaId: number) => {
      socket.leave(`conversa:${conversaId}`)
    })

    socket.on('disconnect', () => {
      const restantes = socketsPorUsuario.get(userId)
      restantes?.delete(socket.id)
      if (!restantes?.size) {
        socketsPorUsuario.delete(userId)
        agendarOffline(userId)
      }
    })
  })

  return io
}

// Chamado pelo router (chat.ts) depois de gravar uma mensagem no banco —
// avisa quem está com a conversa aberta (evento rico, já pronto pra
// renderizar) e quem só está na lista/outra tela (evento leve, só pra
// atualizar contador de não lida e reordenar a lista).
export function emitirNovaMensagem(conversaId: number, participanteIds: number[], mensagem: unknown) {
  io?.to(`conversa:${conversaId}`).emit('chat:novaMensagem', mensagem)
  for (const userId of participanteIds) {
    io?.to(`user:${userId}`).emit('chat:conversaAtualizada', { conversaId })
  }
}

export function emitirParaUsuario(userId: number, evento: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(evento, payload)
}

// Avisa quem está com a tela daquela conversa aberta (ex: alguém marcou
// como lida — os outros participantes vendo a conversa agora mesmo
// precisam atualizar o "✓✓ Lido" das próprias mensagens na hora).
export function emitirParaConversa(conversaId: number, evento: string, payload: unknown) {
  io?.to(`conversa:${conversaId}`).emit(evento, payload)
}
