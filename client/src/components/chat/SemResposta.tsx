import { useLocation } from 'react-router-dom'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { timeAgo } from '../../lib/utils'
import Avatar from './Avatar'

// "Toda mensagem precisa ter uma resposta" (João, 2026-11-17) — ver
// server/src/lib/chatSemResposta.ts. Selo na lista de conversas, aviso dentro
// da conversa e bolinhas com a foto de quem chamou (estilo Messenger).

type ConversaResumo = {
  faltaResponder: boolean
  aguardandoResposta: boolean
  semRespostaDesde: string | null
  semRespostaAtrasada: boolean
}

export function SeloSemResposta({ c }: { c: ConversaResumo }) {
  if (c.faltaResponder)
    return (
      <span
        className={`inline-block mt-1 text-[10px] font-bold rounded px-1.5 py-0.5 ${
          c.semRespostaAtrasada ? 'bg-red-600 text-white animate-pulse' : 'bg-amber-900/50 text-amber-200 border border-amber-600/50'
        }`}
      >
        ⏳ FALTA RESPONDER{c.semRespostaDesde ? ` · ${timeAgo(c.semRespostaDesde)}` : ''}
      </span>
    )
  if (c.aguardandoResposta) return <span className="inline-block mt-1 text-[10px] text-dark-400">aguardando resposta</span>
  return null
}

// Dentro da conversa: lembra que falta responder + "👍 Ciente" pra fechar
// quando não tem o que responder.
export function AvisoSemResposta({ conversaId, onCiente, enviando }: { conversaId: number; onCiente: () => void; enviando: boolean }) {
  const { data: conversas } = trpc.chat.conversas.listar.useQuery(undefined, { staleTime: 10_000 })
  const c = conversas?.find((x) => x.id === conversaId)
  if (!c?.faltaResponder) return null
  return (
    <div
      className={`mx-2 mb-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
        c.semRespostaAtrasada ? 'bg-red-900/40 border border-red-600/60 text-red-100' : 'bg-amber-900/30 border border-amber-600/40 text-amber-100'
      }`}
    >
      <span className="flex-1">
        ⏳ Essa mensagem está esperando sua resposta{c.semRespostaDesde ? ` (${timeAgo(c.semRespostaDesde)})` : ''}.
      </span>
      <button type="button" disabled={enviando} onClick={onCiente} className="shrink-0 rounded-md bg-dark-800 border border-dark-600 px-2 py-0.5 hover:border-gold-500 text-dark-100">
        👍 Ciente
      </button>
    </div>
  )
}

// Bolinhas flutuantes com a foto de quem mandou e está esperando resposta.
// Somem sozinhas quando alguém responde (ou manda 👍).
export function BolhasSemResposta() {
  const { user } = useAuth()
  const { temAcesso, abrirConversaNoPopup } = useChat()
  const location = useLocation()
  const { data: conversas } = trpc.chat.conversas.listar.useQuery(undefined, { enabled: temAcesso, refetchInterval: 30_000 })
  const pendentes = (conversas ?? []).filter((c) => c.faltaResponder)
  const telaChat = location.pathname === (user?.role === 'admin' ? '/admin/chat' : '/vendedor/chat')
  if (!temAcesso || telaChat || !pendentes.length) return null
  const visiveis = pendentes.slice(0, 4)
  return (
    <div className="fixed right-6 bottom-44 md:bottom-24 z-40 flex flex-col items-center gap-2 print:hidden">
      {visiveis.map((c) => {
        const quem = c.semRespostaAutor ?? (c.tipoOrigem === 'grupo' ? null : c.outrosParticipantes[0]) ?? null
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => abrirConversaNoPopup(c.id)}
            title={`${quem?.name ?? c.titulo} — falta responder${c.tipoOrigem === 'direta' ? '' : ` (${c.titulo})`}`}
            className={`relative rounded-full shadow-xl shadow-black/50 transition-transform hover:scale-110 ring-2 ${c.semRespostaAtrasada ? 'ring-red-500 animate-bounce' : 'ring-amber-400'}`}
          >
            <div className="[&>div>div]:w-12 [&>div>div]:h-12 [&>div>div]:text-base">
              <Avatar nome={quem?.name ?? c.titulo} fotoUrl={quem?.fotoUrl} />
            </div>
            <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-dark-950 ${c.semRespostaAtrasada ? 'bg-red-500' : 'bg-amber-400'}`} />
          </button>
        )
      })}
      {pendentes.length > visiveis.length && (
        <span className="text-[11px] font-bold rounded-full bg-red-600 text-white px-2 py-0.5">+{pendentes.length - visiveis.length}</span>
      )}
    </div>
  )
}
