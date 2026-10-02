import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import PessoaPicker from './PessoaPicker'

// Tela de criar um "mini grupo": título livre + várias pessoas de uma vez
// (ao contrário da "Nova conversa" de 1:1). Reaproveitado tanto no popup do
// sininho quanto na aba geral (ver ChatPopup.tsx / pages/Chat.tsx). Pedido
// do João, 2026-10-03.
export default function NovoGrupoView({ onClose, onCriado }: { onClose: () => void; onCriado: (conversaId: number) => void }) {
  const [titulo, setTitulo] = useState('')
  const [selecionados, setSelecionados] = useState<number[]>([])

  const criarMut = trpc.chat.conversas.criarGrupo.useMutation({
    onSuccess: (data) => onCriado(data.id),
    onError: (e) => toast.error(e.message),
  })

  function toggle(userId: number) {
    setSelecionados((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]))
  }

  function criar() {
    if (!titulo.trim()) return toast.error('Dá um título pro grupo')
    if (!selecionados.length) return toast.error('Escolhe pelo menos mais uma pessoa')
    criarMut.mutate({ titulo: titulo.trim(), participantesIds: selecionados })
  }

  return (
    <div className="absolute inset-0 z-20 bg-dark-800 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-dark-700 shrink-0">
        <p className="text-sm font-semibold text-dark-100">Novo grupo</p>
        <button onClick={onClose} className="text-dark-400 hover:text-dark-100">
          <X size={16} />
        </button>
      </div>
      <div className="p-3 border-b border-dark-700 shrink-0">
        <input
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título do grupo..."
          className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
        />
      </div>
      <div className="relative flex-1 min-h-0">
        <PessoaPicker multiplo selecionados={selecionados} onEscolher={toggle} />
      </div>
      <div className="p-3 border-t border-dark-700 shrink-0">
        <button
          type="button"
          onClick={criar}
          disabled={criarMut.isPending}
          className="w-full bg-gold-600 hover:bg-gold-500 disabled:opacity-50 text-dark-950 font-medium rounded-lg py-2 text-sm transition-colors"
        >
          {criarMut.isPending ? 'Criando...' : `Criar grupo${selecionados.length ? ` (${selecionados.length + 1} pessoas)` : ''}`}
        </button>
      </div>
    </div>
  )
}
