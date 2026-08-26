import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { trpc } from '../lib/trpc'

// Busca um cliente já cadastrado (Boletos/Negociações sempre apontam pra um
// cliente existente, nunca nome avulso — evita duplicar cadastro fora da
// base). Reaproveita `clientes.list` (mesma busca da tela de Clientes).
export default function ClientePicker({
  label,
  clienteId,
  clienteNome,
  onSelect,
}: {
  label?: string
  clienteId: number | null
  clienteNome: string | null
  onSelect: (cliente: { id: number; razaoSocial: string } | null) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const { data } = trpc.clientes.list.useQuery({ q: busca, pagina: 1 }, { enabled: aberto && busca.trim().length >= 2 })

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', handleClickFora)
    return () => document.removeEventListener('mousedown', handleClickFora)
  }, [])

  if (clienteId && clienteNome) {
    return (
      <div className="flex flex-col gap-1">
        {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
        <div className="flex items-center justify-between gap-2 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm">
          <span className="text-dark-100 truncate">{clienteNome}</span>
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
          placeholder="Buscar cliente por nome..."
          className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-8 pr-3 py-2 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:border-gold-600"
        />
      </div>
      {aberto && busca.trim().length >= 2 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {data?.items.length === 0 && <p className="text-xs text-dark-500 px-3 py-2">Nenhum cliente encontrado.</p>}
          {data?.items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onSelect({ id: c.id, razaoSocial: c.razaoSocial })
                setBusca('')
                setAberto(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-700 hover:text-gold-400 transition-colors"
            >
              {c.razaoSocial}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
