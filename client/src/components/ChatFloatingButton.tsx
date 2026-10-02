import { useLocation, useNavigate } from 'react-router-dom'
import { MessageCircleMore } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'

// Botão flutuante no canto da tela (estilo "balão do WhatsApp" dos sites),
// abre a versão "aba geral" do chat (página cheia, lista + conversa lado a
// lado — ver pages/Chat.tsx) em qualquer tela do sistema. Convive com o
// popup do lado do sininho (ChatPopup.tsx): o João pediu os dois jeitos,
// não um no lugar do outro. Pedido + referência visual (balão do WhatsApp
// no canto do site da Compretec), 2026-10-02.
export default function ChatFloatingButton() {
  const { user } = useAuth()
  const { temAcesso, naoLidasTotal } = useChat()
  const navigate = useNavigate()
  const location = useLocation()

  const destino = user?.role === 'admin' ? '/admin/chat' : '/vendedor/chat'
  // Não faz sentido flutuar o botão por cima da própria tela de chat.
  if (!temAcesso || location.pathname === destino) return null

  return (
    <button
      onClick={() => navigate(destino)}
      title="Abrir Chat Grupo Odin"
      className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gold-600 hover:bg-gold-500 text-dark-950 shadow-2xl shadow-black/50 flex items-center justify-center transition-colors"
    >
      <MessageCircleMore size={26} />
      {naoLidasTotal > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center border-2 border-dark-950">
          {naoLidasTotal > 9 ? '9+' : naoLidasTotal}
        </span>
      )}
    </button>
  )
}
