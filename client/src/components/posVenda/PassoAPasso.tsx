// Caixa "Como funciona" (abre/fecha) com o passo a passo do Pós-venda e dos
// Agendamentos de peças, em linguagem simples — pedido do João, 2026-10-29.
// Lembra por navegador se a pessoa escondeu.
import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

export default function PassoAPasso({ chave, titulo, explicacao, passos, dicas }: { chave: string; titulo: string; explicacao?: React.ReactNode; passos: React.ReactNode[]; dicas?: React.ReactNode[] }) {
  const chaveStorage = `passo_a_passo_${chave}`
  const [aberto, setAberto] = useState(() => {
    try {
      return localStorage.getItem(chaveStorage) !== 'fechado'
    } catch {
      return true
    }
  })
  function alternar() {
    const novo = !aberto
    setAberto(novo)
    try {
      localStorage.setItem(chaveStorage, novo ? 'aberto' : 'fechado')
    } catch {
      // sem storage: só não lembra
    }
  }

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 mb-4">
      <button type="button" onClick={alternar} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <Info size={16} className="text-blue-300 shrink-0" />
        <span className="text-sm font-semibold text-blue-200 flex-1">{titulo}</span>
        <span className="text-xs text-dark-400">{aberto ? 'esconder' : 'mostrar'}</span>
        <ChevronDown size={16} className={`text-dark-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div className="px-4 pb-4 text-sm text-dark-200 space-y-3">
          {explicacao && <p className="text-dark-300">{explicacao}</p>}
          <ol className="space-y-1.5 list-decimal pl-5">
            {passos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
          {dicas && dicas.length > 0 && (
            <ul className="space-y-1 text-xs text-dark-400 border-t border-dark-700 pt-2">
              {dicas.map((d, i) => (
                <li key={i}>💡 {d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
