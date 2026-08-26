// Seletor de Produtos/Serviços da proposta — portado de
// components/Propostas/ProductSelector.tsx do odincrm original. Busca o
// catálogo de modelos (mesmo do Almoxarifado), agrupa em botões-pílula por
// categoria, pede a voltagem de cada modelo escolhido, e guarda tudo como
// texto simples em `produtosDescricao` no formato:
// "Modelos selecionados: X (220V), Y (380V)\nOutros: ..." — mesma
// convenção do original, pra não precisar de coluna nova no banco.
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Textarea } from './ui/Input'

type CatalogEntry = { id: number; categoria: string; linha: string | null; modelo: string; especificacoes: string | null }
type SelectedItem = { modelo: string; voltagem: string }

const MODELS_PREFIX = 'Modelos selecionados: '
const OUTROS_PREFIX = 'Outros: '

function parseValue(value: string, catalogModels: string[]): { selecionados: SelectedItem[]; outros: string } {
  const linhas = value.split('\n')
  const idx = linhas.findIndex((l) => l.startsWith(MODELS_PREFIX))
  if (idx === -1) return { selecionados: [], outros: value }
  const tokens = linhas[idx].slice(MODELS_PREFIX.length).split(', ').map((t) => t.trim()).filter(Boolean)
  const selecionados: SelectedItem[] = []
  for (const t of tokens) {
    const match = t.match(/^(.*?)\s*\(([^)]*)\)$/)
    const modelo = (match ? match[1] : t).trim()
    const voltagem = match ? match[2].trim() : ''
    if (catalogModels.includes(modelo)) selecionados.push({ modelo, voltagem })
  }
  const resto = linhas.filter((_, i) => i !== idx).join('\n').trim()
  const outros = resto.startsWith(OUTROS_PREFIX) ? resto.slice(OUTROS_PREFIX.length) : resto
  return { selecionados, outros }
}

function composeValue(selecionados: SelectedItem[], outros: string): string {
  const partes: string[] = []
  if (selecionados.length) {
    const tokens = selecionados.map((s) => (s.voltagem.trim() ? `${s.modelo} (${s.voltagem.trim()})` : s.modelo))
    partes.push(`${MODELS_PREFIX}${tokens.join(', ')}`)
  }
  if (outros.trim()) partes.push(`${OUTROS_PREFIX}${outros.trim()}`)
  return partes.join('\n')
}

export default function ProductSelector({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { data: catalogo, isLoading } = trpc.propostas.catalogoModelos.useQuery()
  const [outrosLocal, setOutrosLocal] = useState<string | null>(null)

  const catalogModels = useMemo(() => (catalogo ?? []).map((c) => c.modelo), [catalogo])
  const { selecionados, outros } = useMemo(() => parseValue(value, catalogModels), [value, catalogModels])
  const outrosExibido = outrosLocal ?? outros

  const porCategoria = useMemo(() => {
    const grupos: Record<string, CatalogEntry[]> = {}
    for (const c of catalogo ?? []) (grupos[c.categoria] ??= []).push(c)
    return grupos
  }, [catalogo])

  function alternarModelo(modelo: string) {
    if (disabled) return
    const next = selecionados.some((s) => s.modelo === modelo) ? selecionados.filter((s) => s.modelo !== modelo) : [...selecionados, { modelo, voltagem: '' }]
    onChange(composeValue(next, outros))
  }

  function setVoltagem(modelo: string, voltagem: string) {
    const next = selecionados.map((s) => (s.modelo === modelo ? { ...s, voltagem } : s))
    onChange(composeValue(next, outros))
  }

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-xs text-dark-500">Carregando modelos...</p>}
      {!isLoading && (catalogo ?? []).length === 0 && <p className="text-xs text-dark-500">Nenhum modelo cadastrado no catálogo — use o campo "Outros" abaixo.</p>}

      {Object.entries(porCategoria).map(([categoria, modelos]) => (
        <div key={categoria}>
          <p className="text-[11px] font-semibold text-dark-500 uppercase tracking-wide mb-1.5">{categoria}</p>
          <div className="flex flex-wrap gap-1.5">
            {modelos.map((m) => {
              const isSelected = selecionados.some((s) => s.modelo === m.modelo)
              return (
                <button
                  type="button"
                  key={m.id}
                  disabled={disabled}
                  onClick={() => alternarModelo(m.modelo)}
                  title={m.linha ?? undefined}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                    isSelected ? 'border-gold-500 bg-gold-900/20 text-gold-400' : 'border-dark-600 text-dark-300 hover:border-gold-600/50'
                  }`}
                >
                  {isSelected ? '✓ ' : ''}
                  {m.modelo}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {selecionados.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-dark-600 p-2.5">
          <p className="text-[11px] font-semibold text-dark-500 uppercase tracking-wide">Selecionados — informe a voltagem de cada um</p>
          {selecionados.map((s) => (
            <div key={s.modelo} className="flex items-center gap-2">
              <span className="flex-1 text-xs font-medium text-dark-200">{s.modelo}</span>
              <input
                className="h-7 w-28 rounded-md border border-dark-600 bg-dark-900 px-2 text-xs text-dark-100"
                placeholder="Ex: 220V"
                value={s.voltagem}
                disabled={disabled}
                onChange={(e) => setVoltagem(s.modelo, e.target.value)}
              />
              {!disabled && (
                <button type="button" onClick={() => alternarModelo(s.modelo)} className="text-dark-500 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="text-xs text-dark-400 mb-1 block">Outros (não estão na lista)</label>
        <Textarea
          placeholder="Algo que não está na lista? Descreva aqui (opcional)"
          value={outrosExibido}
          disabled={disabled}
          onChange={(e) => { setOutrosLocal(e.target.value); onChange(composeValue(selecionados, e.target.value)) }}
          className="h-16 resize-none"
        />
      </div>
    </div>
  )
}
