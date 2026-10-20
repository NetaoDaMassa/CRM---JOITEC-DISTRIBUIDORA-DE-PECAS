import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Search } from 'lucide-react'
import { paraCsv, baixarCsv } from '../../lib/csv'
import { moeda, numero, pct } from './blocos'
import { formatarDataCurta } from './filtros'
import { tituloDoArquivo, useExportacao } from './exportacao'

// Tabela dos relatórios detalhados (referência do João, 2026-10-20: busca,
// ordenar clicando na coluna, escolher colunas, exportar, paginação com
// "linhas por página" e "ir para página"). `simples` = versão do vendedor:
// só busca + ordenar + páginas.

export type Formato = 'texto' | 'moeda' | 'numero' | 'pct' | 'data'

export type Coluna<T> = {
  id: string
  rotulo: string
  valor: (l: T) => string | number | null | undefined
  render?: (l: T) => ReactNode
  formato?: Formato
  // Começa escondida (dá pra ligar em "Colunas").
  oculta?: boolean
  // Soma no rodapé (só números).
  somar?: boolean
  largura?: string
  // Texto longo que pode quebrar linha (o resto fica numa linha só).
  quebrar?: boolean
}

function formatar(v: string | number | null | undefined, formato: Formato = 'texto'): string {
  if (v === null || v === undefined || v === '') return '—'
  if (formato === 'moeda') return moeda(Number(v))
  if (formato === 'numero') return numero(Number(v))
  if (formato === 'pct') return pct(Number(v))
  if (formato === 'data') return formatarDataCurta(String(v))
  return String(v)
}

// CSV pro Excel brasileiro: número com vírgula decimal, data dd/mm/aaaa.
function paraExcel(v: string | number | null | undefined, formato: Formato = 'texto') {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return formato === 'moeda' ? v.toFixed(2).replace('.', ',') : String(v).replace('.', ',')
  if (formato === 'data') return formatarDataCurta(v)
  return v
}

const ehNumerico = (f?: Formato) => f === 'moeda' || f === 'numero' || f === 'pct'

export default function TabelaDados<T>({
  id,
  linhas,
  colunas,
  chave,
  buscaEm,
  placeholderBusca = 'Buscar...',
  nomeArquivo,
  link,
  ordemInicial,
  porPaginaInicial = 25,
  simples,
  barraExtra,
  vazio = 'Nenhum registro com esses filtros.',
  carregando,
}: {
  id: string
  linhas: T[] | undefined
  colunas: Coluna<T>[]
  chave: (l: T) => string | number
  buscaEm?: (l: T) => string
  placeholderBusca?: string
  nomeArquivo: string
  link?: (l: T) => string | undefined
  ordemInicial?: { coluna: string; direcao: 'asc' | 'desc' }
  porPaginaInicial?: number
  simples?: boolean
  barraExtra?: ReactNode
  vazio?: string
  carregando?: boolean
}) {
  const navigate = useNavigate()
  // Dentro da tela de exportação (PDF/Excel): sem busca/paginação, todas as
  // linhas vão pro Excel e o PDF mostra até `limiteLinhas`.
  const exp = useExportacao()
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState(ordemInicial ?? null)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(porPaginaInicial)
  const [irPara, setIrPara] = useState('')
  const [menuColunas, setMenuColunas] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const chaveOcultas = `tabela:${id}:ocultas`
  const [ocultas, setOcultas] = useState<string[]>(() => {
    try {
      const salvo = localStorage.getItem(chaveOcultas)
      if (salvo) return JSON.parse(salvo)
    } catch {
      // sem localStorage — usa o padrão
    }
    return colunas.filter((c) => c.oculta).map((c) => c.id)
  })

  useEffect(() => {
    if (!menuColunas) return
    const fechar = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuColunas(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [menuColunas])

  function alternarColuna(colId: string) {
    const novas = ocultas.includes(colId) ? ocultas.filter((c) => c !== colId) : [...ocultas, colId]
    setOcultas(novas)
    try {
      localStorage.setItem(chaveOcultas, JSON.stringify(novas))
    } catch {
      // ignora
    }
  }

  const visiveis = colunas.filter((c) => !ocultas.includes(c.id))

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    let r = linhas ?? []
    if (termo && buscaEm) r = r.filter((l) => buscaEm(l).toLowerCase().includes(termo))
    if (ordem) {
      const col = colunas.find((c) => c.id === ordem.coluna)
      if (col) {
        const fator = ordem.direcao === 'asc' ? 1 : -1
        r = [...r].sort((a, b) => {
          const va = col.valor(a)
          const vb = col.valor(b)
          // vazio sempre no fim
          if (va === null || va === undefined || va === '') return 1
          if (vb === null || vb === undefined || vb === '') return -1
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * fator
          return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * fator
        })
      }
    }
    return r
  }, [linhas, busca, ordem, colunas, buscaEm])

  useEffect(() => setPagina(1), [busca, ordem, porPagina, linhas])

  // Grava num ref do coletor (não é estado), então rodar a cada render não
  // causa loop — só mantém o Excel com o que está na tela agora.
  useEffect(() => {
    if (!exp) return
    exp.registrar(
      exp.secao,
      id,
      carregando
        ? null
        : {
            titulo: tituloDoArquivo(nomeArquivo),
            colunas: visiveis.map((c) => ({ rotulo: c.rotulo, formato: c.formato ?? 'texto' })),
            linhas: filtradas.map((l) =>
              visiveis.map((c) => {
                const v = c.valor(l)
                return v === undefined || v === '' ? null : v
              })
            ),
          }
    )
  })
  useEffect(() => {
    if (!exp) return
    return () => exp.registrar(exp.secao, id, null)
  }, [exp, id])

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const pedaco = exp ? filtradas.slice(0, exp.limiteLinhas) : filtradas.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina)
  const temSoma = visiveis.some((c) => c.somar)

  function clicarCabecalho(colId: string) {
    if (!ordem || ordem.coluna !== colId) setOrdem({ coluna: colId, direcao: 'desc' })
    else if (ordem.direcao === 'desc') setOrdem({ coluna: colId, direcao: 'asc' })
    else setOrdem(null)
  }

  function exportar() {
    const cols = visiveis.map((c) => ({ chave: c.id, rotulo: c.rotulo }))
    const dados = filtradas.map((l) => Object.fromEntries(visiveis.map((c) => [c.id, paraExcel(c.valor(l), c.formato)])))
    baixarCsv(nomeArquivo, paraCsv(cols, dados))
  }

  const numerosPagina = useMemo(() => {
    const lista: (number | '…')[] = []
    for (let p = 1; p <= totalPaginas; p++) {
      if (p === 1 || p === totalPaginas || Math.abs(p - paginaAtual) <= 1) lista.push(p)
      else if (lista[lista.length - 1] !== '…') lista.push('…')
    }
    return lista
  }, [totalPaginas, paginaAtual])

  const botaoPagina = 'h-8 min-w-8 px-2 rounded-lg border text-sm flex items-center justify-center transition-colors'

  if (exp) {
    // "Sem tabelas" no PDF: some da folha, mas continua indo pro Excel.
    if (!exp.limiteLinhas) return null
    return (
      <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden break-inside-auto">
        <table className="w-full text-[11px]">
          <thead className="table-header-group">
            <tr className="bg-dark-900 border-b border-dark-600">
              {visiveis.map((c) => (
                <th key={c.id} className={`px-2 py-1.5 font-semibold text-dark-300 ${ehNumerico(c.formato) ? 'text-right' : 'text-left'}`}>
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={visiveis.length} className="px-2 py-6 text-center text-dark-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!carregando && !pedaco.length && (
              <tr>
                <td colSpan={visiveis.length} className="px-2 py-6 text-center text-dark-500">
                  {vazio}
                </td>
              </tr>
            )}
            {!carregando &&
              pedaco.map((l) => (
                <tr key={chave(l)} className="border-b border-dark-700 last:border-0 break-inside-avoid">
                  {visiveis.map((c) => (
                    <td key={c.id} className={`px-2 py-1 ${ehNumerico(c.formato) ? 'text-right tabular-nums whitespace-nowrap text-dark-100' : 'text-dark-200'}`}>
                      {c.render ? c.render(l) : formatar(c.valor(l), c.formato)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
          {temSoma && !carregando && filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-dark-900 border-t border-dark-600 font-semibold">
                {visiveis.map((c, idx) => (
                  <td key={c.id} className={`px-2 py-1.5 ${ehNumerico(c.formato) ? 'text-right tabular-nums whitespace-nowrap text-dark-50' : 'text-dark-300'}`}>
                    {c.somar ? formatar(filtradas.reduce((s, l) => s + (Number(c.valor(l)) || 0), 0), c.formato) : idx === 0 ? 'Total' : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {!carregando && filtradas.length > pedaco.length && (
          <p className="px-2 py-1.5 text-[11px] text-dark-400 border-t border-dark-600">
            Mostrando {numero(pedaco.length)} de {numero(filtradas.length)} linhas (o total soma todas) — o Excel traz a lista completa.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-dark-600 flex-wrap">
        {buscaEm && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={placeholderBusca}
              className="w-full h-9 bg-dark-900 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 pl-8 pr-3 focus:outline-none focus:border-gold-500"
            />
          </div>
        )}
        {barraExtra}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-dark-400 whitespace-nowrap">{numero(filtradas.length)} registro(s)</span>
          {!simples && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuColunas((v) => !v)}
                className="h-9 px-3 rounded-lg border border-dark-600 text-sm text-dark-200 hover:border-gold-500 flex items-center gap-1.5"
              >
                <Columns3 size={15} /> Colunas
              </button>
              {menuColunas && (
                <div className="absolute right-0 top-10 z-30 w-56 bg-dark-800 border border-dark-600 rounded-xl shadow-xl p-2 max-h-80 overflow-y-auto">
                  <p className="text-[11px] uppercase tracking-wider text-dark-500 px-2 py-1">Mostrar colunas</p>
                  {colunas.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-dark-700 text-sm text-dark-200 cursor-pointer">
                      <input type="checkbox" checked={!ocultas.includes(c.id)} onChange={() => alternarColuna(c.id)} className="accent-[#0d9de0]" />
                      {c.rotulo}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={exportar}
            disabled={!filtradas.length}
            className="h-9 px-3 rounded-lg border border-dark-600 text-sm text-dark-200 hover:border-gold-500 disabled:opacity-40 flex items-center gap-1.5"
            title="Baixar planilha (abre no Excel)"
          >
            <Download size={15} /> Exportar
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-dark-900/60 border-b border-dark-600">
              {visiveis.map((c) => {
                const ativa = ordem?.coluna === c.id
                const Icone = !ativa ? ArrowUpDown : ordem!.direcao === 'desc' ? ArrowDown : ArrowUp
                return (
                  <th
                    key={c.id}
                    style={{ width: c.largura }}
                    className={`px-4 py-3 font-medium text-dark-400 whitespace-nowrap ${ehNumerico(c.formato) ? 'text-right' : 'text-left'}`}
                  >
                    <button
                      type="button"
                      onClick={() => clicarCabecalho(c.id)}
                      className={`inline-flex items-center gap-1 hover:text-dark-100 ${ativa ? 'text-dark-100' : ''}`}
                    >
                      {c.rotulo}
                      <Icone size={13} className={ativa ? 'text-gold-500' : 'opacity-40'} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={visiveis.length} className="px-4 py-10 text-center text-dark-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!carregando && !pedaco.length && (
              <tr>
                <td colSpan={visiveis.length} className="px-4 py-10 text-center text-dark-500">
                  {busca ? `Nada encontrado pra "${busca}".` : vazio}
                </td>
              </tr>
            )}
            {!carregando &&
              pedaco.map((l) => {
                const destino = link?.(l)
                return (
                  <tr
                    key={chave(l)}
                    onClick={destino ? () => navigate(destino) : undefined}
                    className={`border-b border-dark-700 last:border-0 transition-colors ${destino ? 'cursor-pointer hover:bg-gold-500/6' : 'hover:bg-dark-900/40'}`}
                  >
                    {visiveis.map((c) => (
                      <td
                        key={c.id}
                        className={`px-4 py-3 ${ehNumerico(c.formato) ? 'text-right tabular-nums text-dark-100' : 'text-dark-200'} ${
                          c.quebrar ? 'min-w-[260px]' : 'whitespace-nowrap'
                        }`}
                      >
                        {c.render ? c.render(l) : formatar(c.valor(l), c.formato)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
          {temSoma && !carregando && filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-dark-900/60 border-t border-dark-600 font-semibold">
                {visiveis.map((c, idx) => (
                  <td key={c.id} className={`px-4 py-3 ${ehNumerico(c.formato) ? 'text-right tabular-nums text-dark-50' : 'text-dark-300'}`}>
                    {c.somar ? formatar(filtradas.reduce((s, l) => s + (Number(c.valor(l)) || 0), 0), c.formato) : idx === 0 ? 'Total' : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {filtradas.length > 10 && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-dark-600 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-dark-400">
            Linhas por página
            <select
              value={porPagina}
              onChange={(e) => setPorPagina(Number(e.target.value))}
              className="h-8 bg-dark-900 border border-dark-600 rounded-lg text-sm text-dark-100 px-2"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 mx-auto">
            {!simples && (
              <button type="button" disabled={paginaAtual === 1} onClick={() => setPagina(1)} className={`${botaoPagina} border-dark-600 text-dark-300 disabled:opacity-30`}>
                <ChevronsLeft size={15} />
              </button>
            )}
            <button type="button" disabled={paginaAtual === 1} onClick={() => setPagina(paginaAtual - 1)} className={`${botaoPagina} border-dark-600 text-dark-300 disabled:opacity-30`}>
              <ChevronLeft size={15} />
            </button>
            {numerosPagina.map((p, i) =>
              p === '…' ? (
                <span key={`r${i}`} className="px-1 text-dark-500">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPagina(p)}
                  className={`${botaoPagina} ${p === paginaAtual ? 'bg-gold-500 border-gold-500 text-white font-semibold' : 'border-dark-600 text-dark-200 hover:border-gold-500'}`}
                >
                  {p}
                </button>
              )
            )}
            <button type="button" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(paginaAtual + 1)} className={`${botaoPagina} border-dark-600 text-dark-300 disabled:opacity-30`}>
              <ChevronRight size={15} />
            </button>
            {!simples && (
              <button type="button" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(totalPaginas)} className={`${botaoPagina} border-dark-600 text-dark-300 disabled:opacity-30`}>
                <ChevronsRight size={15} />
              </button>
            )}
          </div>
          {!simples && (
            <form
              className="flex items-center gap-2 text-sm text-dark-400"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Number(irPara)
                if (n >= 1 && n <= totalPaginas) setPagina(n)
                setIrPara('')
              }}
            >
              Ir para página
              <input value={irPara} onChange={(e) => setIrPara(e.target.value.replace(/\D/g, ''))} className="h-8 w-14 bg-dark-900 border border-dark-600 rounded-lg text-sm text-dark-100 px-2" />
              <button type="submit" className="text-dark-100 font-medium hover:text-gold-400">
                Ir ›
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
