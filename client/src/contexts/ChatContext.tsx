import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import toast from 'react-hot-toast'
import { useAuth } from './AuthContext'
import { trpc } from '../lib/trpc'
import Avatar from '../components/chat/Avatar'

interface ChatContextValue {
  // Se a pessoa logada já tem o Chat liberado em Permissões (ver
  // chatProcedure no server) — superAdmin e role 'gestor' sempre têm.
  // Usado pra esconder os botões (popup, flutuante, "Conversar sobre
  // isso") de quem ainda não foi liberado. Pedido do João, 2026-10-02:
  // escolher pessoa por pessoa antes de mandar pro ar.
  temAcesso: boolean
  socket: Socket | null
  // userId -> está online agora. Começa vazio e vai sendo preenchido pelos
  // eventos de presença (ver chatSocket.ts no servidor) — a tela que lista
  // vendedores funde isso com `chat.usuarios` (que já traz o status salvo
  // no banco) pra não ficar em branco antes do primeiro evento chegar.
  presencaOnline: Map<number, boolean>
  naoLidasTotal: number
  // Qual conversa está com a tela aberta agora (ver ChatJanela.tsx) — usado
  // só pra NÃO mostrar o pop-up de mensagem nova de uma conversa que a
  // pessoa já está olhando.
  conversaAbertaId: number | null
  setConversaAbertaId: (id: number | null) => void
  // Controle do popup flutuante (ver ChatPopup.tsx) — fica aberto/fechado
  // pra qualquer tela do sistema, não é mais uma página própria. Clicar no
  // aviso de mensagem nova (ou em "Conversar sobre isso" em qualquer lugar)
  // chama `abrirConversaNoPopup` pra abrir o popup já na conversa certa.
  popupAberto: boolean
  setPopupAberto: (aberto: boolean) => void
  conversaParaAbrir: number | null
  abrirConversaNoPopup: (conversaId: number) => void
  limparConversaParaAbrir: () => void
}

const ChatContext = createContext<ChatContextValue>({
  temAcesso: false,
  socket: null,
  presencaOnline: new Map(),
  naoLidasTotal: 0,
  conversaAbertaId: null,
  setConversaAbertaId: () => {},
  popupAberto: false,
  setPopupAberto: () => {},
  conversaParaAbrir: null,
  abrirConversaNoPopup: () => {},
  limparConversaParaAbrir: () => {},
})

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
  const [conversaAbertaId, setConversaAbertaId] = useState<number | null>(null)
  const [popupAberto, setPopupAberto] = useState(false)
  const [conversaParaAbrir, setConversaParaAbrir] = useState<number | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const conversaAbertaRef = useRef<number | null>(null)
  conversaAbertaRef.current = conversaAbertaId

  function abrirConversaNoPopup(conversaId: number) {
    setConversaParaAbrir(conversaId)
    setPopupAberto(true)
  }

  // Mesma condição de enabled do Sidebar pra 'minhasFeatures': superAdmin e
  // gestor nunca dependem dessa tabela, então nem precisam chamar a query.
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && (user.role === 'vendor' || (user.role === 'admin' && !user.superAdmin)),
  })
  const temAcesso = !!user && (user.superAdmin || user.role === 'gestor' || !!minhasFeatures?.includes('chat'))

  const { data: conversas } = trpc.chat.conversas.listar.useQuery(undefined, {
    enabled: !!token && temAcesso,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!token || !user || !temAcesso) {
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
    // Grupo excluído por um admin — some da lista de quem mais participava.
    // Só invalida a lista: como a tela sempre deriva "conversa aberta" de
    // `conversas.find(id)`, ela volta sozinha pra lista assim que o grupo
    // some do resultado (ver ChatPopup.tsx/pages/Chat.tsx). Pedido do João,
    // 2026-10-03.
    s.on('chat:conversaExcluida', () => {
      utils.chat.conversas.listar.invalidate()
      toast('Um grupo que você participava foi excluído.', { icon: '🗑️' })
    })

    // Pop-up de mensagem nova — só quando a pessoa NÃO está com aquela
    // conversa aberta na hora (senão ela já está vendo a mensagem chegar na
    // tela, o aviso seria redundante). Clicar abre o popup do chat direto
    // naquela conversa, de qualquer tela do sistema. Pedido do João,
    // 2026-10-02.
    s.on(
      'chat:mensagemRecebida',
      (payload: { conversaId: number; autorNome: string; autorFotoUrl: string | null; preview: string }) => {
        if (payload.conversaId === conversaAbertaRef.current) return
        toast.custom(
          (t) => (
            <button
              onClick={() => {
                toast.dismiss(t.id)
                abrirConversaNoPopup(payload.conversaId)
              }}
              className={`flex items-center gap-3 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 px-4 py-3 text-left max-w-sm ${
                t.visible ? 'animate-in fade-in' : 'opacity-0'
              }`}
            >
              <Avatar nome={payload.autorNome} fotoUrl={payload.autorFotoUrl} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark-100">{payload.autorNome}</p>
                <p className="text-xs text-dark-400 truncate">{payload.preview}</p>
              </div>
            </button>
          ),
          { duration: 6000 }
        )
      }
    )

    return () => {
      s.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, temAcesso])

  const naoLidasTotal = (conversas ?? []).reduce((soma, c) => soma + c.naoLidas, 0)

  return (
    <ChatContext.Provider
      value={{
        temAcesso,
        socket,
        presencaOnline,
        naoLidasTotal,
        conversaAbertaId,
        setConversaAbertaId,
        popupAberto,
        setPopupAberto,
        conversaParaAbrir,
        abrirConversaNoPopup,
        limparConversaParaAbrir: () => setConversaParaAbrir(null),
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}
