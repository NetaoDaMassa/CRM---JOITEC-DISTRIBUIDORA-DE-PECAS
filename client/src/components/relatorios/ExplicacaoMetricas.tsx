import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { BookOpen, ChevronDown, Info } from 'lucide-react'
import { GLOSSARIO } from './glossario'

// Painel "O que significa cada número?" — fica fechado por padrão (só o
// botão), abre uma lista com a explicação de cada métrica do relatório.
// Lembra se a pessoa deixou aberto (por relatório, só no navegador dela).
export default function ExplicacaoMetricas({ chave, className = '' }: { chave: string; className?: string }) {
  const itens = GLOSSARIO[chave]
  const chaveStorage = `relatorios:explicacao:${chave}`
  const [aberto, setAberto] = useState(() => {
    try {
      return localStorage.getItem(chaveStorage) === '1'
    } catch {
      return false
    }
  })
  if (!itens?.length) return null

  const alternar = () => {
    const novo = !aberto
    setAberto(novo)
    try {
      localStorage.setItem(chaveStorage, novo ? '1' : '0')
    } catch {
      // ignora
    }
  }

  return (
    <div className={`rounded-2xl border border-dark-600 bg-dark-800 ${className}`}>
      <button type="button" onClick={alternar} aria-expanded={aberto} className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gold-500/15 text-gold-500">
          <BookOpen size={16} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-dark-50">O que significa cada número?</span>
          <span className="block text-xs text-dark-400">{aberto ? 'Clique pra fechar' : `Explicação de ${itens.length} métricas deste relatório`}</span>
        </span>
        <ChevronDown size={18} className={`text-dark-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <dl className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 px-4 pb-4">
          {itens.map((i) => (
            <div key={i.termo} className="rounded-xl bg-dark-900 border border-dark-700 p-3">
              <dt className="flex items-center gap-2 text-[13px] font-semibold text-dark-50">
                {i.cor && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.cor }} />}
                {i.termo}
              </dt>
              <dd className="text-[13px] text-dark-300 mt-1 leading-relaxed">{i.texto}</dd>
              {i.exemplo && <dd className="text-xs text-dark-400 mt-1.5 italic">Ex.: {i.exemplo}</dd>}
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

// Ícone ⓘ ao lado do nome da métrica: passa o mouse (ou toca, no celular)
// e aparece a explicação. Não é <button> porque às vezes fica dentro de um
// card que já é link/botão.
export function Dica({ texto, tamanho = 13 }: { texto?: string; tamanho?: number }) {
  const [aberta, setAberta] = useState(false)
  // Perto da borda direita da tela a caixa abre pra esquerda, senão vaza.
  const [praEsquerda, setPraEsquerda] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  if (!texto) return null
  const abrir = () => {
    const r = ref.current?.getBoundingClientRect()
    setPraEsquerda(!!r && r.left + 256 > window.innerWidth)
    setAberta(true)
  }
  const alternar = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Abre (não alterna): no celular o toque já dispara o mouseenter antes,
    // alternar fecharia na hora. Fecha ao tocar fora (onBlur).
    abrir()
  }
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={abrir} onMouseLeave={() => setAberta(false)}>
      <span
        role="button"
        tabIndex={0}
        aria-label="O que é isso?"
        onClick={alternar}
        onBlur={() => setAberta(false)}
        className="text-dark-500 hover:text-gold-500 cursor-help inline-flex"
      >
        <Info size={tamanho} />
      </span>
      {aberta && (
        <span className={`absolute ${praEsquerda ? 'right-0' : 'left-0'} top-full mt-1.5 z-30 w-60 max-w-[70vw] rounded-xl border border-dark-600 bg-dark-900 p-3 text-xs font-normal normal-case tracking-normal leading-relaxed text-dark-200 shadow-xl text-left whitespace-normal`}>
          {texto}
        </span>
      )}
    </span>
  )
}
