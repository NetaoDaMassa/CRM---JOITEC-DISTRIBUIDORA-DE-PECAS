import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { moeda } from '../../../components/relatorios/blocos'

// Peças comuns das abas do relatório Itens do SAP (redesenho 2026-11-19).

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const NOMES_MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
export const mesLongo = (m: string) => `${NOMES_MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
export const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
export const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
export const eixoY = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}mi` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))
export const moedaCurta = (v: number): string =>
  v < 0
    ? `−${moedaCurta(-v)}`
    : Math.abs(v) >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : Math.abs(v) >= 10_000 ? `R$ ${Math.round(v / 1000).toLocaleString('pt-BR')} mil` : moeda(v)

export function mesesAtras(mes: string, n: number) {
  let [a, m] = mes.split('-').map(Number)
  m -= n
  while (m < 1) {
    m += 12
    a -= 1
  }
  while (m > 12) {
    m -= 12
    a += 1
  }
  return `${a}-${String(m).padStart(2, '0')}`
}

// Cabeçalho de cada aba: a pergunta que ela responde, grande, e uma linha
// de apoio.
export function Pergunta({ titulo, apoio, children }: { titulo: string; apoio?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-dark-50">{titulo}</h2>
        {apoio && <p className="text-sm text-dark-400 mt-0.5">{apoio}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

// "Como é calculado": fechado por padrão (antes era um parágrafo longo no
// rodapé de cada aba).
export function ComoCalcula({ itens }: { itens: ReactNode[] }) {
  return (
    <details className="group text-sm text-dark-400 bg-dark-800/60 border border-dark-700 rounded-xl px-4 py-2.5">
      <summary className="cursor-pointer select-none flex items-center gap-2 text-dark-300 hover:text-dark-100">
        <Info size={14} /> Como é calculado
      </summary>
      <ul className="mt-2 mb-1 space-y-1.5 list-disc pl-5">
        {itens.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  )
}

export const classeCampo = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500'

