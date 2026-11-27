import { useState } from 'react'
import toast from 'react-hot-toast'
import { Sparkles, Plus, Trash2, X, Pencil, Check } from 'lucide-react'
import { trpc } from '../../lib/trpc'

// Respostas prontas + "✨ Sugerir com IA" (João, 2026-11-27). Abre pelo ⚡ ou
// digitando "/" na caixa de texto. Escolher uma só coloca o texto na caixa —
// a pessoa ainda pode editar antes de mandar. Cada um tem a sua lista.
export default function RespostasRapidas({
  conversaId,
  filtro,
  onEscolher,
  onClose,
}: {
  conversaId: number
  filtro: string
  onEscolher: (texto: string) => void
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const { data } = trpc.chat.respostas.listar.useQuery()
  const [editando, setEditando] = useState(false)
  const [nova, setNova] = useState('')
  const [sugestoes, setSugestoes] = useState<string[] | null>(null)

  const salvarMut = trpc.chat.respostas.salvar.useMutation({
    onSuccess: () => utils.chat.respostas.listar.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const sugerirMut = trpc.chat.respostas.sugerir.useMutation({
    onSuccess: (r) => setSugestoes(r.sugestoes),
    onError: (e) => toast.error(e.message),
  })

  const lista = data?.lista ?? []
  const termo = filtro.trim().toLowerCase()
  const visiveis = termo ? lista.filter((t) => t.toLowerCase().includes(termo)) : lista

  function adicionar() {
    const t = nova.trim()
    if (!t) return
    salvarMut.mutate({ lista: [...lista, t] })
    setNova('')
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-2 right-2 mb-1 z-40 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 max-h-[55vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-dark-700 shrink-0">
          <p className="text-xs font-semibold text-dark-100">⚡ Respostas prontas</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setEditando((v) => !v)} className="flex items-center gap-1 text-[11px] text-dark-400 hover:text-gold-400">
              {editando ? <Check size={12} /> : <Pencil size={12} />} {editando ? 'Pronto' : 'Editar lista'}
            </button>
            <button type="button" onClick={onClose} className="text-dark-500 hover:text-dark-100">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Sugestão da IA */}
        <div className="px-3 py-2 border-b border-dark-700 shrink-0">
          {data && !data.iaDisponivel ? (
            <p className="text-[11px] text-dark-500">✨ Sugestão da IA: ainda não ligada neste CRM.</p>
          ) : (
            <button
              type="button"
              onClick={() => sugerirMut.mutate({ conversaId })}
              disabled={sugerirMut.isPending}
              className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200 disabled:opacity-60"
            >
              <Sparkles size={13} className={sugerirMut.isPending ? 'animate-pulse' : ''} />
              {sugerirMut.isPending ? 'Lendo a conversa e pensando...' : sugestoes ? 'Sugerir de novo' : 'Sugerir resposta com IA'}
            </button>
          )}
          {sugestoes && (
            <div className="mt-1.5 space-y-1">
              {sugestoes.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onEscolher(t)}
                  className="block w-full text-left text-xs text-dark-100 bg-violet-900/25 border border-violet-700/40 hover:border-violet-500 rounded-lg px-2.5 py-1.5"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {visiveis.map((t) => (
            <div key={t} className="flex items-center gap-1 hover:bg-dark-700/50">
              <button type="button" onClick={() => !editando && onEscolher(t)} className="flex-1 text-left text-xs text-dark-200 px-3 py-2">
                {t}
              </button>
              {editando && (
                <button
                  type="button"
                  onClick={() => salvarMut.mutate({ lista: lista.filter((x) => x !== t) })}
                  className="p-2 text-dark-500 hover:text-red-400"
                  title="Tirar da lista"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {!visiveis.length && <p className="text-xs text-dark-500 px-3 py-2">Nenhuma resposta pronta com “{filtro}”.</p>}
        </div>

        {editando && (
          <div className="flex items-center gap-2 p-2 border-t border-dark-700 shrink-0">
            <input
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionar()}
              placeholder="Nova resposta pronta..."
              className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-2.5 py-1.5 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
            />
            <button type="button" onClick={adicionar} disabled={!nova.trim() || salvarMut.isPending} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 disabled:opacity-50">
              <Plus size={13} /> Adicionar
            </button>
          </div>
        )}
      </div>
    </>
  )
}
