import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeDollarSign } from 'lucide-react'
import { trpc } from '../lib/trpc'

// Resposta do Financeiro numa consulta/limite de crédito (João, 2026-11-27):
// além do sininho, aparece este aviso grande e animado na tela do vendedor,
// uma vez por resposta, pra ele "ficar esperto". Lembra quais já mostrou
// (por navegador); se o navegador não guardar, lembra só nesta aba.
type Aviso = { id: number; type: string; title: string; message: string; read: boolean }
const CHAVE = 'credito_popup_vistos'

function lerVistos(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHAVE) ?? '[]') as number[])
  } catch {
    return new Set()
  }
}
function gravarVistos(v: Set<number>) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify([...v].slice(-200)))
  } catch {
    // sem storage: lembra só na memória
  }
}

export default function CreditoRespostaPopup({ items }: { items: Aviso[] | undefined }) {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const vistos = useRef<Set<number>>(lerVistos())
  const [atual, setAtual] = useState<Aviso | null>(null)
  const markReadMut = trpc.notifications.markRead.useMutation({ onSuccess: () => utils.notifications.list.invalidate() })

  useEffect(() => {
    if (atual || !items) return
    const proximo = items.find((n) => !n.read && n.type.startsWith('credito_resposta_') && !vistos.current.has(n.id))
    if (proximo) setAtual(proximo)
  }, [items, atual])

  if (!atual) return null
  const liberado = atual.type === 'credito_resposta_liberado'

  function fechar(abrir: boolean) {
    if (!atual) return
    vistos.current.add(atual.id)
    gravarVistos(vistos.current)
    if (abrir) {
      markReadMut.mutate({ id: atual.id })
      navigate('/vendedor/solicitacao-credito')
    }
    setAtual(null)
  }

  return (
    // Tela baixa (notebook, zoom): o aviso inteiro cabe — rola se precisar,
    // e fica mais compacto em altura pequena (print da Katiely, 2026-11-27).
    <div className="popup-overlay fixed inset-0 z-[60] overflow-y-auto bg-black/75 backdrop-blur-sm" onClick={() => fechar(false)}>
      <div className="min-h-full flex items-center justify-center p-4">
      <div
        className={`popup-card bg-dark-800 border-4 ${liberado ? 'border-green-500' : 'border-red-500'} rounded-3xl px-6 py-6 md:px-10 [@media(min-height:760px)]:py-10 text-center shadow-2xl w-full max-w-md`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dark-400">Resposta do Financeiro</p>
        <div
          className={`credito-moeda mx-auto mt-4 w-20 h-20 [@media(min-height:760px)]:w-28 [@media(min-height:760px)]:h-28 rounded-full flex items-center justify-center ${liberado ? 'bg-green-500/15 text-green-400 ring-4 ring-green-500/60' : 'bg-red-500/15 text-red-400 ring-4 ring-red-500/60'}`}
          style={{ ['--credito-cor' as string]: liberado ? 'rgba(34, 197, 94, 0.55)' : 'rgba(239, 68, 68, 0.55)' }}
        >
          <BadgeDollarSign className="w-12 h-12 [@media(min-height:760px)]:w-16 [@media(min-height:760px)]:h-16" strokeWidth={1.6} />
        </div>
        <p className={`mt-4 [@media(min-height:760px)]:mt-6 text-3xl md:text-4xl font-extrabold ${liberado ? 'text-green-400' : 'text-red-400'}`}>{liberado ? 'LIBERADO' : 'NEGADO'}</p>
        <p className="mt-3 text-base font-semibold text-dark-50">{atual.title}</p>
        <p className="mt-2 text-sm text-dark-300">{atual.message}</p>
        <div className="mt-5 [@media(min-height:760px)]:mt-7 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fechar(true)}
            className={`w-full rounded-xl py-3 font-semibold text-white ${liberado ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'}`}
          >
            Ver a resposta
          </button>
          <button type="button" onClick={() => fechar(false)} className="text-sm text-dark-400 hover:text-dark-200 underline">
            Fechar
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}
