import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { trpc } from '../lib/trpc'

// Busca uma pasta já existente em Arquivos/Mídia — usado em Solicitar Arte
// → Aprovações pra vincular o pedido aprovado à pasta onde o arquivo final
// ficou (ver design.ts `definirPastaFinal`). Mesmo padrão de ClientePicker,
// só que a lista inteira de pastas da empresa já vem pronta (não costuma
// ter tantas a ponto de precisar buscar no servidor a cada letra digitada)
// — filtra local pelo caminho completo ("Campanhas 2026 / Setembro").
export default function PastaPicker({
  label,
  pastaId,
  pastaNome,
  onSelect,
}: {
  label?: string
  pastaId: number | null
  pastaNome: string | null
  onSelect: (pasta: { id: number; nome: string } | null) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const { data: pastas, isLoading } = trpc.marketing.listarTodasPastas.useQuery(undefined, { enabled: aberto })

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', handleClickFora)
    return () => document.removeEventListener('mousedown', handleClickFora)
  }, [])

  const termo = busca.trim().toLowerCase()
  const filtradas = termo ? pastas?.filter((p) => p.caminho.toLowerCase().includes(termo)) : pastas

  if (pastaId && pastaNome) {
    return (
      <div className="flex flex-col gap-1">
        {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
        <div className="flex items-center justify-between gap-2 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm">
          <span className="text-dark-100 truncate">📁 {pastaNome}</span>
          <button type="button" onClick={() => onSelect(null)} className="text-dark-500 hover:text-red-400 shrink-0">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 relative" ref={boxRef}>
      {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onFocus={() => setAberto(true)}
          placeholder="Buscar pasta..."
          className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-8 pr-3 py-2 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-gold-600"
        />
      </div>
      {aberto && (
        <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {isLoading && <p className="text-xs text-dark-500 px-3 py-2">Carregando...</p>}
          {!isLoading && filtradas?.length === 0 && <p className="text-xs text-dark-500 px-3 py-2">Nenhuma pasta encontrada.</p>}
          {filtradas?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect({ id: p.id, nome: p.nome })
                setBusca('')
                setAberto(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-700 hover:text-gold-400 transition-colors"
            >
              {p.caminho}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
