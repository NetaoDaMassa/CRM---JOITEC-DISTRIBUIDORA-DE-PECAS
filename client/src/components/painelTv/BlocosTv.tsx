// Blocos do telão (75", 16:9) — tudo em vh pra escalar com a resolução da
// TV. Extraídos do PainelTV.tsx pra o Painel de TV da Odin usar o mesmo
// visual (2026-10-23).
import { useEffect, useState } from 'react'

// O recharts usa px fixo — essa escala (1 = tela de 1080px de altura)
// acompanha a resolução da TV.
export function useEscala(): number {
  const [escala, setEscala] = useState(() => window.innerHeight / 1080)
  useEffect(() => {
    const atualizar = () => setEscala(window.innerHeight / 1080)
    window.addEventListener('resize', atualizar)
    return () => window.removeEventListener('resize', atualizar)
  }, [])
  return escala
}

export function Card({
  titulo,
  extra,
  children,
  className = '',
  cor,
}: {
  titulo?: string
  extra?: React.ReactNode
  children: React.ReactNode
  className?: string
  cor?: string
}) {
  return (
    <div
      className={`bg-dark-800 border border-dark-600 rounded-[1.4vh] p-[2.2vh] flex flex-col min-h-0 overflow-hidden ${className}`}
      style={cor ? { borderLeft: `0.5vh solid ${cor}` } : undefined}
    >
      {(titulo || extra) && (
        <div className="flex items-center justify-between gap-[1.6vh] mb-[1.6vh] shrink-0">
          {titulo && <h2 className="text-[2.4vh] font-semibold text-gold-400 uppercase tracking-wide leading-none">{titulo}</h2>}
          {extra}
        </div>
      )}
      {children}
    </div>
  )
}

export function Selo({ children, tom }: { children: React.ReactNode; tom: 'verde' | 'vermelho' | 'ambar' | 'ouro' | 'neutro' }) {
  const cls = {
    verde: 'text-green-400 bg-green-900/25',
    vermelho: 'text-red-400 bg-red-900/25',
    ambar: 'text-amber-400 bg-amber-900/25',
    ouro: 'text-gold-400 bg-gold-900/25',
    neutro: 'text-dark-300 bg-dark-700',
  }[tom]
  return <span className={`text-[1.9vh] font-bold px-[1.4vh] py-[0.6vh] rounded-full whitespace-nowrap ${cls}`}>{children}</span>
}

export function Kpi({ titulo, valor, sub, cor }: { titulo: string; valor: React.ReactNode; sub?: React.ReactNode; cor: string }) {
  return (
    <div
      className="bg-dark-800 border border-dark-600 rounded-[1.4vh] px-[2.2vh] py-[1.8vh] flex flex-col justify-between min-h-0"
      style={{ borderTop: `0.5vh solid ${cor}` }}
    >
      <p className="text-[1.9vh] text-dark-300 uppercase tracking-wide font-semibold">{titulo}</p>
      <p className="text-[8vh] leading-none font-bold font-mono tabular-nums text-dark-50 mt-[0.8vh]">{valor}</p>
      {sub && <p className="text-[1.7vh] text-dark-400 mt-[0.8vh]">{sub}</p>}
    </div>
  )
}

// Linhas que dividem a altura disponível por igual — com poucos vendedores
// não ficam gigantes (mínimo de `minLinhas` espaços), com muitos a fonte
// encolhe junto pra não estourar a altura da tela.
export function Linhas<T>({
  itens,
  minLinhas = 8,
  chave,
  render,
}: {
  itens: T[]
  minLinhas?: number
  chave: (item: T, i: number) => string | number
  render: (item: T, i: number, fonteVh: number) => React.ReactNode
}) {
  const slots = Math.max(itens.length, minLinhas)
  const fonteVh = Math.min(2.6, 30 / slots)
  return (
    <div className="flex-1 min-h-0 grid gap-[0.6vh]" style={{ gridTemplateRows: `repeat(${slots}, minmax(0, 1fr))` }}>
      {itens.map((item, i) => (
        <div key={chave(item, i)} className="min-h-0 flex items-center gap-[1.4vh] border-b border-dark-700/50" style={{ fontSize: `${fonteVh}vh` }}>
          {render(item, i, fonteVh)}
        </div>
      ))}
    </div>
  )
}

export function Posicao({ i, medalhas = true }: { i: number; medalhas?: boolean }) {
  return (
    <span className="w-[2.6em] shrink-0 text-dark-400 font-mono text-center">
      {medalhas && i === 0 ? '🥇' : medalhas && i === 1 ? '🥈' : medalhas && i === 2 ? '🥉' : `${i + 1}º`}
    </span>
  )
}

// Barra horizontal embutida na linha — `percentual` já vem 0..100 (cortado
// em 100 pra quem passou da meta não estourar a coluna).
export function BarraLinha({ percentual, cor, rotulo }: { percentual: number; cor: string; rotulo: string }) {
  return (
    <div className="flex-1 min-w-0 flex items-center gap-[1.2vh]">
      <div className="flex-1 h-[0.75em] bg-dark-700/70 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, percentual))}%`, background: cor }} />
      </div>
      <span className="w-[4.6em] text-right font-mono tabular-nums font-bold text-dark-50">{rotulo}</span>
    </div>
  )
}

export function NomeVendedor({ nome, fonteVh }: { nome: string; fonteVh: number }) {
  return (
    <span className="truncate font-medium text-dark-100" style={{ width: `${fonteVh * 13}vh` }}>
      {nome}
    </span>
  )
}
