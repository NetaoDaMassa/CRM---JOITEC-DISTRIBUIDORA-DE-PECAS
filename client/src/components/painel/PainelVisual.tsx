import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Info, Sparkles, X } from 'lucide-react'

// Peças visuais compartilhadas pelas telas de Kanban/lista no "visual novo"
// (Visitas, Propostas, Pedidos — pedido do João, 2026-10-22: "mesma ideia
// do Kanban de Leads, mais design + dinâmico"): número clicável que filtra,
// cabeçalho de coluna colorido, quadro "O que tem de novo" e Legenda.

export function Indicador({
  icone: Icone,
  valor,
  rotulo,
  cor,
  ativo,
  onClick,
  dica,
}: {
  icone: LucideIcon
  valor: ReactNode
  rotulo: string
  cor: string
  ativo?: boolean
  onClick?: () => void
  dica?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={dica}
      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all min-w-0 ${
        ativo ? 'bg-dark-700 shadow-lg' : 'bg-dark-800 border-dark-600 enabled:hover:border-dark-400 enabled:hover:-translate-y-0.5'
      }`}
      style={ativo ? { borderColor: cor, boxShadow: `0 0 0 1px ${cor}` } : undefined}
    >
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cor}1f`, color: cor }}>
        <Icone size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold text-dark-50 leading-tight tabular-nums">{valor}</span>
        <span className="block text-[11px] text-dark-400 truncate">{rotulo}</span>
      </span>
    </button>
  )
}

// Faixa "Mostrando só X ... · limpar" quando um Indicador está filtrando.
export function AvisoFiltro({ quantidade, texto, aoLimpar }: { quantidade: number; texto: string; aoLimpar: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-3 text-sm">
      <span className="text-dark-300">
        Mostrando só <span className="font-semibold text-dark-50">{quantidade}</span> {texto}
      </span>
      <button type="button" onClick={aoLimpar} className="inline-flex items-center gap-1 text-xs text-gold-400 hover:underline">
        <X size={12} /> limpar
      </button>
    </div>
  )
}

export function CabecalhoColuna({ rotulo, cor, quantidade, alerta, extra }: { rotulo: string; cor: string; quantidade: number; alerta?: string | null; extra?: ReactNode }) {
  return (
    <div className="rounded-xl bg-dark-800/60 border border-dark-700 px-3 py-2 mb-3" style={{ borderTop: `3px solid ${cor}` }}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
        <span className="text-sm font-semibold text-dark-100 truncate">{rotulo}</span>
        <span className="text-xs font-bold rounded-full px-2 py-0.5" style={{ color: cor, background: `${cor}22` }}>
          {quantidade}
        </span>
        {alerta && <span className="text-[10px] font-bold text-red-400 bg-red-500/15 rounded-full px-1.5 py-0.5 whitespace-nowrap">{alerta}</span>}
      </div>
      {extra}
    </div>
  )
}

export function Pilula({ cor, children, title }: { cor: string; children: ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ color: cor, background: `${cor}1f` }} title={title}>
      {children}
    </span>
  )
}

// Fundo colorido por "idade" — usado em "parado há X dias".
export function corIdade(dias: number, amarelo: number, vermelho: number) {
  return dias >= vermelho ? '#e5534b' : dias >= amarelo ? '#e8a33a' : '#22a861'
}

export function diasDesdeData(d: string | null | undefined) {
  if (!d) return 0
  const data = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d.replace(' ', 'T')}Z`)
  return Math.max(0, Math.floor((Date.now() - data.getTime()) / 86400000))
}

export type Novidade = { emoji: string; titulo: string; texto: string }

export function CaixaNovidades({ itens, aoFechar }: { itens: Novidade[]; aoFechar: () => void }) {
  return (
    <div className="relative rounded-2xl border border-gold-500/30 bg-gradient-to-br from-gold-500/10 to-transparent p-4 mb-3">
      <button type="button" onClick={aoFechar} className="absolute right-3 top-3 text-dark-400 hover:text-dark-100" title="Fechar (dá para rever em Legenda)">
        <X size={16} />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-gold-400" />
        <h2 className="text-sm font-semibold text-dark-50">O que tem de novo nesta tela</h2>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2.5">
        {itens.map((n) => (
          <div key={n.titulo} className="flex gap-2.5 text-[13px]">
            <span className="text-base leading-5">{n.emoji}</span>
            <p className="text-dark-300">
              <span className="font-semibold text-dark-100">{n.titulo}:</span> {n.texto}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export type SecaoLegenda = { titulo: string; itens?: { marca: ReactNode; texto: ReactNode }[]; texto?: ReactNode }

export function BotaoLegenda({ secoes, aoRever }: { secoes: SecaoLegenda[]; aoRever?: () => void }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dark-600 bg-dark-800 text-sm text-dark-300 hover:text-gold-400 hover:border-gold-500/50 transition-colors"
      >
        <Info size={15} /> Legenda
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute right-0 mt-1 w-[min(92vw,420px)] max-h-[75vh] overflow-y-auto bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 p-4 space-y-4 text-xs">
            {secoes.map((s) => (
              <div key={s.titulo}>
                <p className="text-dark-500 font-semibold mb-1.5">{s.titulo}</p>
                <div className="space-y-1.5">
                  {s.itens?.map((i, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-dark-300">
                      <span className="shrink-0 w-20 flex justify-center">{i.marca}</span>
                      <span>{i.texto}</span>
                    </div>
                  ))}
                  {s.texto && <p className="text-dark-300">{s.texto}</p>}
                </div>
              </div>
            ))}
            {aoRever && (
              <button
                type="button"
                onClick={() => {
                  aoRever()
                  setAberto(false)
                }}
                className="text-gold-400 hover:underline"
              >
                Ver de novo "O que tem de novo"
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Botões "Quadro | Lista" (ou outras visões).
export function TrocaVisao<T extends string>({ valor, opcoes, onChange }: { valor: T; opcoes: { valor: T; rotulo: string; icone: LucideIcon }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-dark-600 bg-dark-800 p-0.5">
      {opcoes.map(({ valor: v, rotulo, icone: Icone }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${valor === v ? 'bg-gold-500 text-white' : 'text-dark-300 hover:text-dark-100'}`}
        >
          <Icone size={14} /> {rotulo}
        </button>
      ))}
    </div>
  )
}

export function baixarCsv(nomeArquivo: string, linhas: (string | number)[][]) {
  const csv = '﻿' + linhas.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
