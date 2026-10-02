import { useState } from 'react'
import toast from 'react-hot-toast'
import { MessageCircleMore, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useChat } from '../../contexts/ChatContext'
import Modal from '../ui/Modal'
import ChatJanela from './ChatJanela'
import PessoaPicker from './PessoaPicker'

type TipoOrigem = 'lead' | 'cliente' | 'pedido' | 'visita' | 'consulta_credito'

// Botão de zero fricção: clica e já abre a conversa vinculada a ESTE
// registro (cria na hora se ainda não existir) — sem formulário, sem
// assunto, a pessoa já sabe do que se trata porque está na tela do
// lead/cliente/pedido/visita/consulta de crédito.
//
// O vendedor costuma já SER o dono do lead/cliente — auto-adicionar "o
// responsável" não ajuda em nada nesse caso. Então, numa conversa que
// acabou de nascer (só quem abriu dentro dela), oferece escolher com quem
// falar (financeiro, gestor, admin, marketing, qualquer um) antes de cair
// na tela de mensagens — pedido do João, 2026-10-02.
export default function ConversarSobreIssoButton({
  tipoOrigem,
  idOrigem,
  titulo,
  className,
}: {
  tipoOrigem: TipoOrigem
  idOrigem: number
  titulo?: string
  className?: string
}) {
  const { temAcesso } = useChat()
  const [conversaId, setConversaId] = useState<number | null>(null)
  const [escolhendoComQuem, setEscolhendoComQuem] = useState(false)
  const utils = trpc.useUtils()

  const abrirMut = trpc.chat.conversas.abrirPorOrigem.useMutation({
    onSuccess: (data) => {
      setConversaId(data.id)
      setEscolhendoComQuem(data.precisaEscolherComQuemFalar)
    },
    onError: (e) => toast.error(e.message),
  })

  const adicionarMut = trpc.chat.conversas.adicionarParticipante.useMutation({
    onSuccess: () => {
      if (conversaId) utils.chat.conversas.participantes.invalidate({ conversaId })
      setEscolhendoComQuem(false)
    },
    onError: (e) => toast.error(e.message),
  })

  if (!temAcesso) return null

  return (
    <>
      <button
        type="button"
        onClick={() => abrirMut.mutate({ tipoOrigem, idOrigem })}
        disabled={abrirMut.isPending}
        className={
          className ??
          'inline-flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 border border-gold-600/30 hover:border-gold-500/60 rounded-lg px-2.5 py-1.5 transition-colors'
        }
      >
        <MessageCircleMore size={13} /> Conversar sobre isso
      </button>

      {conversaId !== null && (
        <Modal open onClose={() => setConversaId(null)} title={titulo ?? 'Conversa'} size="md">
          <div className="h-[70vh] -mx-6 -my-5 relative">
            {escolhendoComQuem ? (
              <div className="absolute inset-0 bg-dark-800 flex flex-col">
                <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
                  <p className="text-sm font-semibold text-dark-100">Com quem você quer falar sobre isso?</p>
                  <button onClick={() => setEscolhendoComQuem(false)} className="text-dark-400 hover:text-dark-100">
                    <X size={16} />
                  </button>
                </div>
                <PessoaPicker onEscolher={(userId) => adicionarMut.mutate({ conversaId, userId })} />
              </div>
            ) : (
              <ChatJanela conversaId={conversaId} />
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
