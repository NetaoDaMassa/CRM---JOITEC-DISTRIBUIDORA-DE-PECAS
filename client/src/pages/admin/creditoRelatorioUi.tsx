// Peças de tela compartilhadas pelos relatórios de crédito (Consulta/
// Solicitação de Crédito e Registros de liberação): cartões de total em
// cima, tabelas embaixo, cada tabela com botão de baixar planilha (CSV que
// abre no Excel — lib/csv.ts, com ";" e BOM). Pedido do João, 2026-11-16.
import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { baixarCsv, paraCsv } from '../../lib/csv'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'

export const moeda = (v: number | null | undefined) => (v == null ? '—' : formatarMoedaBr(v))
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
export const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesBr = (mes: string) => {
  const [a, m] = mes.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${a}`
}
// Primeiro e último dia do mês "YYYY-MM" — pra clicar num mês e filtrar.
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

// Minutos de horário de trabalho → "2h 15min", "1 dia útil e 3h" etc.
export function tempoUtil(min: number | null | undefined): string {
  if (min == null) return '—'
  const JORNADA = 8 * 60 + 48 // 8-12 + 13-17:48
  const dias = Math.floor(min / JORNADA)
  const resto = min % JORNADA
  const h = Math.floor(resto / 60)
  const m = resto % 60
  const parteHoras = h ? (m ? `${h}h ${m}min` : `${h}h`) : `${m}min`
  if (!dias) return parteHoras
  return `${dias} ${dias > 1 ? 'dias úteis' : 'dia útil'}${resto ? ` e ${parteHoras}` : ''}`
}

export function CartaoTotal({ titulo, valor, detalhe, cor = 'text-dark-50' }: { titulo: string; valor: ReactNode; detalhe?: ReactNode; cor?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <p className="text-xs text-dark-400 uppercase tracking-wide">{titulo}</p>
      <p className={`text-2xl font-bold mt-1 ${cor}`}>{valor}</p>
      {detalhe && <p className="text-xs text-dark-500 mt-1">{detalhe}</p>}
    </div>
  )
}

export type Coluna<T> = {
  titulo: string
  valor: (l: T) => ReactNode
  // Valor que vai pra planilha (número puro, sem "R$", pra somar no Excel).
  csv: (l: T) => string | number | null | undefined
  alinhar?: 'esquerda' | 'direita'
}

// Número no formato do Excel brasileiro (vírgula decimal).
export const numCsv = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','))

export function TabelaRelatorio<T>({
  titulo,
  subtitulo,
  colunas,
  linhas,
  chave,
  arquivo,
  onClicar,
  dicaClique,
  vazio = 'Nada no período.',
}: {
  titulo: string
  subtitulo?: string
  colunas: Coluna<T>[]
  linhas: T[] | undefined
  chave: (l: T) => string | number
  arquivo: string
  onClicar?: (l: T) => void
  dicaClique?: string
  vazio?: string
}) {
  function exportar() {
    const lista = linhas ?? []
    const cols = colunas.map((c, i) => ({ chave: String(i), rotulo: c.titulo }))
    const dados = lista.map((l) => Object.fromEntries(colunas.map((c, i) => [String(i), c.csv(l) ?? ''])))
    baixarCsv(`${arquivo}.csv`, paraCsv(cols, dados))
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <p className="text-sm font-semibold text-dark-100">{titulo}</p>
          {(subtitulo || (onClicar && dicaClique)) && (
            <p className="text-xs text-dark-500 mt-0.5">{[subtitulo, onClicar ? dicaClique : null].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={exportar}
          disabled={!linhas?.length}
          className="shrink-0 inline-flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 disabled:opacity-40 border border-dark-600 rounded-lg px-2 py-1"
          title="Baixar esta tabela em planilha (abre no Excel)"
        >
          <Download size={12} /> Excel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-dark-400 border-b border-dark-700">
              {colunas.map((c) => (
                <th key={c.titulo} className={`px-4 py-2 font-medium whitespace-nowrap ${c.alinhar === 'direita' ? 'text-right' : 'text-left'}`}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {linhas?.map((l) => (
              <tr
                key={chave(l)}
                onClick={onClicar ? () => onClicar(l) : undefined}
                className={onClicar ? 'cursor-pointer hover:bg-dark-700/40 transition-colors' : ''}
              >
                {colunas.map((c) => (
                  <td key={c.titulo} className={`px-4 py-2 text-dark-200 ${c.alinhar === 'direita' ? 'text-right whitespace-nowrap tabular-nums' : 'text-left'}`}>
                    {c.valor(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!linhas?.length && <p className="px-4 py-3 text-xs text-dark-500">{vazio}</p>}
      </div>
    </div>
  )
}
