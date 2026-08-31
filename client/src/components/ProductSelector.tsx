// Seletor de Produtos/Serviços da proposta — busca no catálogo de modelos
// (mesmo do Almoxarifado), quantidade + voltagem por item. Fonte da verdade
// é `produtosItens` (JSON); `produtosDescricao` guarda o texto legível pra
// exibição em cards/relatórios/WhatsApp/conversão.
import { useMemo, useRef, useState } from 'react'
import { X, Search, Plus, Minus } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Textarea } from './ui/Input'

type CatalogEntry = { id: number; categoria: string; linha: string | null; modelo: string; especificacoes: string | null }
type Item = { modelo: string; qtd: number; voltagem: string }

const OUTROS_PREFIX = 'Outros:'
const LEGACY_MODELS_PREFIX = 'Modelos selecionados:'

function renderText(itens: Item[], outros: string): string {
  const linhas = itens.map((i) => `• ${i.modelo} — Qtd: ${i.qtd}${i.voltagem.trim() ? ` — ${i.voltagem.trim()}` : ''}`)
  const body = linhas.join('\n')
  if (outros.trim()) return (body ? body + '\n' : '') + `${OUTROS_PREFIX}\n${outros.trim()}`
  return body
}

function parseText(value: string): { itens: Item[]; outros: string } {
  const itens: Item[] = []
  const outrosLinhas: string[] = []
  let emOutros = false
  for (const linha of (value || '').split('\n')) {
    if (linha.startsWith(OUTROS_PREFIX)) {
      emOutros = true
      const resto = linha.slice(OUTROS_PREFIX.length).trim()
      if (resto) outrosLinhas.push(resto)
      continue
    }
    if (emOutros) { outrosLinhas.push(linha); continue }
    if (linha.startsWith('• ')) {
      const segs = linha.slice(2).split(' — ')
      const modelo = (segs[0] || '').trim()
      let qtd = 1
      let voltagem = ''
      for (const s of segs.slice(1)) {
        const seg = s.trim()
        if (/^qtd:/i.test(seg)) { const n = parseInt(seg.replace(/^qtd:/i, '').trim(), 10); if (!Number.isNaN(n) && n > 0) qtd = n }
        else if (seg) voltagem = seg
      }
      if (modelo) itens.push({ modelo, qtd, voltagem })
      continue
    }
    if (linha.startsWith(LEGACY_MODELS_PREFIX)) {
      for (const t of linha.slice(LEGACY_MODELS_PREFIX.length).split(', ').map((x) => x.trim()).filter(Boolean)) {
        const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
        const modelo = (m ? m[1] : t).trim()
        if (modelo) itens.push({ modelo, qtd: 1, voltagem: m ? m[2].trim() : '' })
      }
      continue
    }
    if (linha.trim()) outrosLinhas.push(linha)
  }
  return { itens, outros: outrosLinhas.join('\n').trim() }
}

function parseValue(value: string, itensJson?: string | null): { itens: Item[]; outros: string } {
  const doTexto = parseText(value)
  if (itensJson && itensJson.trim()) {
    try {
      const arr = JSON.parse(itensJson)
      if (Array.isArray(arr)) {
        return {
          itens: arr
            .filter((x) => x && typeof x.modelo === 'string' && x.modelo.trim())
            .map((x) => ({ modelo: String(x.modelo).trim(), qtd: Number(x.qtd) > 0 ? Number(x.qtd) : 1, voltagem: x.voltagem ? String(x.voltagem) : '' })),
          outros: doTexto.outros,
        }
      }
    } catch {
      /* cai no texto */
    }
  }
  return doTexto
}

export default function ProductSelector({
  value,
  onChange,
  itensJson,
  onItensChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  itensJson?: string | null
  onItensChange?: (json: string) => void
  disabled?: boolean
}) {
  const { data: catalogo } = trpc.propostas.catalogoModelos.useQuery()
  const [query, setQuery] = useState('')
  const [aberto, setAberto] = useState(false)
  const blurTimer = useRef<number | null>(null)

  const { itens, outros } = useMemo(() => parseValue(value, itensJson), [value, itensJson])

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lista = (catalogo ?? []) as CatalogEntry[]
    const base = q
      ? lista.filter((c) => c.modelo.toLowerCase().includes(q) || (c.linha ?? '').toLowerCase().includes(q) || c.categoria.toLowerCase().includes(q))
      : lista
    return base.slice(0, 30)
  }, [catalogo, query])

  function commit(nextItens: Item[], nextOutros: string) {
    onChange(renderText(nextItens, nextOutros))
    onItensChange?.(JSON.stringify(nextItens))
  }

  function adicionar(modelo: string) {
    if (disabled) return
    const idx = itens.findIndex((i) => i.modelo === modelo)
    const next = idx >= 0 ? itens.map((i, n) => (n === idx ? { ...i, qtd: i.qtd + 1 } : i)) : [...itens, { modelo, qtd: 1, voltagem: '' }]
    commit(next, outros)
    setQuery('')
  }
  const remover = (modelo: string) => commit(itens.filter((i) => i.modelo !== modelo), outros)
  const setQtd = (modelo: string, qtd: number) => commit(itens.map((i) => (i.modelo === modelo ? { ...i, qtd: Math.max(1, qtd || 1) } : i)), outros)
  const setVolt = (modelo: string, voltagem: string) => commit(itens.map((i) => (i.modelo === modelo ? { ...i, voltagem } : i)), outros)

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            className="w-full rounded-lg border border-dark-600 bg-dark-900 py-2 pl-8 pr-2 text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-gold-600"
            placeholder="Buscar máquina / item no catálogo..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); setAberto(true) }}
            onBlur={() => { blurTimer.current = window.setTimeout(() => setAberto(false), 150) }}
          />
          {aberto && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-dark-600 bg-dark-800 shadow-lg">
              {resultados.length === 0 ? (
                <p className="px-3 py-2 text-xs text-dark-500">Nenhum item encontrado</p>
              ) : (
                resultados.map((c) => {
                  const jaTem = itens.some((i) => i.modelo === c.modelo)
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => { e.preventDefault(); adicionar(c.modelo) }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-dark-700/50"
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-dark-100">{c.modelo}</span>
                        <span className="ml-2 text-dark-500">{[c.categoria, c.linha].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-gold-400">{jaTem ? '+1' : <Plus size={12} />}</span>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {itens.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-dark-600 p-2.5">
          <p className="text-[11px] font-semibold text-dark-500 uppercase tracking-wide">Itens selecionados</p>
          {itens.map((i) => (
            <div key={i.modelo} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-xs font-medium text-dark-200">{i.modelo}</span>
              <div className="flex items-center rounded-md border border-dark-600">
                <button type="button" disabled={disabled} onClick={() => setQtd(i.modelo, i.qtd - 1)} className="px-1.5 py-1 text-dark-500 hover:text-gold-400 disabled:opacity-40"><Minus size={11} /></button>
                <input
                  type="number"
                  min={1}
                  className="w-9 border-x border-dark-600 bg-transparent py-1 text-center text-xs text-dark-100 focus:outline-none"
                  value={i.qtd}
                  disabled={disabled}
                  onChange={(e) => setQtd(i.modelo, parseInt(e.target.value, 10))}
                />
                <button type="button" disabled={disabled} onClick={() => setQtd(i.modelo, i.qtd + 1)} className="px-1.5 py-1 text-dark-500 hover:text-gold-400 disabled:opacity-40"><Plus size={11} /></button>
              </div>
              <input
                className="h-7 w-24 rounded-md border border-dark-600 bg-dark-900 px-2 text-xs text-dark-100"
                placeholder="Voltagem"
                value={i.voltagem}
                disabled={disabled}
                onChange={(e) => setVolt(i.modelo, e.target.value)}
              />
              {!disabled && (
                <button type="button" onClick={() => remover(i.modelo)} className="text-dark-500 hover:text-red-400 transition-colors"><X size={14} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="text-xs text-dark-400 mb-1 block">Outros / observações dos itens</label>
        <Textarea
          placeholder="Itens fora do catálogo, acessórios, detalhes de cada máquina, condições especiais..."
          value={outros}
          disabled={disabled}
          onChange={(e) => commit(itens, e.target.value)}
          className="h-24 resize-y"
        />
      </div>
    </div>
  )
}
