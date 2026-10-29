import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

// Caixa "Como preencher" que abre/fecha no topo de uma tela — passo a passo
// em linguagem simples pra quem vai lançar os dados. Lembra se a pessoa
// fechou (por navegador). Pedido do João, 2026-10-29.
export default function ComoUsar({ chave, titulo = 'Como preencher', passos, dicas }: { chave: string; titulo?: string; passos: React.ReactNode[]; dicas?: React.ReactNode[] }) {
  const chaveStorage = `como_usar_${chave}`
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
          <ol className="space-y-1.5 list-decimal pl-5">
            {passos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
          {dicas && dicas.length > 0 && (
            <ul className="space-y-1 text-xs text-dark-400 border-t border-blue-500/20 pt-2">
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
