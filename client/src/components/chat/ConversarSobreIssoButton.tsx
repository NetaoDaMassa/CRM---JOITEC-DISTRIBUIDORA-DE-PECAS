import { useState } from 'react'
import toast from 'react-hot-toast'
import { MessageCircleMore } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Modal from '../ui/Modal'
import ChatJanela from './ChatJanela'

type TipoOrigem = 'lead' | 'cliente' | 'pedido' | 'visita' | 'consulta_credito'

// Botão de zero fricção: clica e já abre a conversa vinculada a ESTE
// registro (cria na hora se ainda não existir) — sem formulário, sem
// assunto, a pessoa já sabe do que se trata porque está na tela do
// lead/cliente/pedido/visita/consulta de crédito. Pedido do João,
// 2026-10-02 (Chat Grupo Odin).
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
  const [conversaId, setConversaId] = useState<number | null>(null)
  const abrirMut = trpc.chat.conversas.abrirPorOrigem.useMutation({
    onSuccess: (data) => setConversaId(data.id),
    onError: (e) => toast.error(e.message),
  })

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
          <div className="h-[70vh] -mx-6 -my-5">
            <ChatJanela conversaId={conversaId} />
          </div>
        </Modal>
      )}
    </>
  )
}
