import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAuth } from './AuthContext'
import { trpc } from '../lib/trpc'

interface ChatContextValue {
  socket: Socket | null
  // userId -> está online agora. Começa vazio e vai sendo preenchido pelos
  // eventos de presença (ver chatSocket.ts no servidor) — a tela que lista
  // vendedores funde isso com `chat.usuarios` (que já traz o status salvo
  // no banco) pra não ficar em branco antes do primeiro evento chegar.
  presencaOnline: Map<number, boolean>
  naoLidasTotal: number
}

const ChatContext = createContext<ChatContextValue>({ socket: null, presencaOnline: new Map(), naoLidasTotal: 0 })

export function useChat() {
  return useContext(ChatContext)
}

// Conexão única de Socket.IO pro Chat Grupo Odin — sobe junto com o login e
// morre no logout, disponível em qualquer tela via useChat(). Separado da
// automação de WhatsApp (Baileys) de propósito: não tem nenhuma relação com
// aquilo, é só o transporte de tempo real deste chat interno.
export function ChatProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth()
  const utils = trpc.useUtils()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [presencaOnline, setPresencaOnline] = useState<Map<number, boolean>>(new Map())
  const socketRef = useRef<Socket | null>(null)

  const { data: conversas } = trpc.chat.conversas.listar.useQuery(undefined, {
    enabled: !!token,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!token || !user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setSocket(null)
      return
    }

    const s = io('/', { path: '/chat-socket', auth: { token }, transports: ['websocket', 'polling'] })
    socketRef.current = s
    setSocket(s)

    s.on('chat:presenca', ({ userId, online }: { userId: number; online: boolean }) => {
      setPresencaOnline((prev) => new Map(prev).set(userId, online))
    })
    s.on('chat:conversaAtualizada', () => {
      utils.chat.conversas.listar.invalidate()
    })

    return () => {
      s.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id])

  const naoLidasTotal = (conversas ?? []).reduce((soma, c) => soma + c.naoLidas, 0)

  return <ChatContext.Provider value={{ socket, presencaOnline, naoLidasTotal }}>{children}</ChatContext.Provider>
}
