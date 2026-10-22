import { useEffect, useState } from 'react'
import { Presentation, X } from 'lucide-react'

// Modo apresentação (design novo, teste): tela cheia, sem menu nem topo,
// letras maiores — pra mostrar o relatório numa reunião ou na TV.
export default function BotaoApresentacao() {
  const [ligado, setLigado] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('modo-apresentacao', ligado)
    if (ligado && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    if (!ligado && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    const saiuDaTelaCheia = () => {
      if (!document.fullscreenElement) setLigado(false)
    }
    document.addEventListener('fullscreenchange', saiuDaTelaCheia)
    return () => document.removeEventListener('fullscreenchange', saiuDaTelaCheia)
  }, [ligado])

  useEffect(() => () => document.documentElement.classList.remove('modo-apresentacao'), [])

  return ligado ? (
    <button
      type="button"
      onClick={() => setLigado(false)}
      className="fixed top-4 right-4 z-[9500] flex items-center gap-1.5 h-9 px-3 rounded-full bg-dark-800/90 border border-dark-600 text-sm text-dark-200 hover:text-dark-50 shadow-xl backdrop-blur print:hidden"
    >
      <X size={15} /> Sair da apresentação
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setLigado(true)}
      className="h-9 px-3 rounded-lg border border-dark-600 bg-dark-800 text-sm text-dark-200 hover:text-gold-400 hover:border-gold-500 flex items-center gap-1.5 transition-colors print:hidden"
      title="Tela cheia com letras grandes, pra reunião"
    >
      <Presentation size={15} /> Apresentar
    </button>
  )
}
