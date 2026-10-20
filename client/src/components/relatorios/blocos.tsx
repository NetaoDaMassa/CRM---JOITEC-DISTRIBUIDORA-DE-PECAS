import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Dica } from './ExplicacaoMetricas'

// Peças visuais dos relatórios novos (resumo + detalhados) — pedido do João,
// 2026-10-20, a partir de 3 referências: números grandes com "vs período
// anterior", medidor de ativação, barra de atividade da carteira e tabela
// com filtro/ordenar/colunas/exportar.

export const moeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const moedaCentavos = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const numero = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR')
export const pct = (v: number | null | undefined, casas = 1) =>
  `${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`

// Variação contra o período anterior. `inverter` = número menor é melhor
// (ex.: clientes sem contato).
export function Variacao({ atual, anterior, inverter, sufixo = 'vs período anterior' }: { atual: number; anterior: number | undefined; inverter?: boolean; sufixo?: string }) {
  if (anterior === undefined) return <span className="text-xs text-dark-500">&nbsp;</span>
  if (anterior === 0 && atual === 0) return <span className="text-xs text-dark-500">sem mudança {sufixo}</span>
  const variacao = anterior === 0 ? 100 : ((atual - anterior) / Math.abs(anterior)) * 100
  const subiu = variacao >= 0
  const bom = inverter ? !subiu : subiu
  const Icone = subiu ? ArrowUpRight : ArrowDownRight
  return (
    <span className="flex items-center gap-1.5 text-xs text-dark-400 flex-wrap">
      {sufixo}
      <span
        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold ${
          bom ? 'bg-emerald-500/12 text-emerald-500' : 'bg-red-500/12 text-red-500'
        }`}
      >
        <Icone size={12} />
        {Math.abs(variacao).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
      </span>
    </span>
  )
}

export function KpiCard({
  titulo,
  valor,
  detalhe,
  ajuda,
  atual,
  anterior,
  inverter,
  icone: Icone,
  cor = '#24aff4',
  href,
  destaque,
}: {
  titulo: string
  valor: ReactNode
  detalhe?: ReactNode
  ajuda?: string
  atual?: number
  anterior?: number
  inverter?: boolean
  icone?: LucideIcon
  cor?: string
  href?: string
  destaque?: 'ruim' | 'bom'
}) {
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-dark-300 flex items-center gap-1.5">
          {titulo}
          <Dica texto={ajuda} />
        </p>
        {Icone && (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cor}1f`, color: cor }}>
            <Icone size={16} />
          </span>
        )}
      </div>
      <p
        className={`text-[26px] leading-tight font-bold mt-1 tracking-tight ${
          destaque === 'ruim' ? 'text-red-500' : destaque === 'bom' ? 'text-emerald-500' : 'text-dark-50'
        }`}
      >
        {valor}
      </p>
      <div className="mt-1.5 min-h-5">
        {atual !== undefined ? <Variacao atual={atual} anterior={anterior} inverter={inverter} /> : detalhe && <p className="text-xs text-dark-400">{detalhe}</p>}
      </div>
      {atual !== undefined && detalhe && <p className="text-xs text-dark-500 mt-1">{detalhe}</p>}
      {href && (
        <span className="absolute right-3 bottom-3 text-dark-500 group-hover:text-gold-400 transition-colors">
          <ChevronRight size={16} />
        </span>
      )}
    </>
  )
  const classe = 'group relative block bg-dark-800 border border-dark-600 rounded-2xl p-4 transition-all'
  return href ? (
    <Link to={href} className={`${classe} hover:border-gold-500/60 hover:shadow-lg hover:-translate-y-0.5`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  )
}

export function Secao({
  titulo,
  subtitulo,
  acoes,
  children,
  className = '',
  href,
  rotuloLink = 'Ver relatório completo',
}: {
  titulo: ReactNode
  subtitulo?: ReactNode
  acoes?: ReactNode
  children: ReactNode
  className?: string
  href?: string
  rotuloLink?: string
}) {
  return (
    <section className={`bg-dark-800 border border-dark-600 rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-dark-50">{titulo}</h2>
          {subtitulo && <p className="text-xs text-dark-400 mt-0.5 italic">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex items-center gap-2 flex-wrap">{acoes}</div>}
      </div>
      {children}
      {href && (
        <Link to={href} className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-gold-500 hover:text-gold-400">
          {rotuloLink} <ChevronRight size={15} />
        </Link>
      )}
    </section>
  )
}

// Medidor em meia-lua (taxa de ativação, positivação, cobertura).
export function Medidor({ percentual, cor = '#22a861', rotulo }: { percentual: number; cor?: string; rotulo?: string }) {
  const p = Math.max(0, Math.min(100, percentual))
  const r = 80
  const comprimento = Math.PI * r
  return (
    <div className="relative w-full max-w-[240px] mx-auto">
      <svg viewBox="0 0 200 112" className="w-full">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--color-dark-700)" strokeWidth="26" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={cor}
          strokeWidth="26"
          strokeDasharray={`${(p / 100) * comprimento} ${comprimento}`}
          style={{ transition: 'stroke-dasharray .8s ease' }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-3xl font-bold text-dark-50 leading-none">{pct(percentual, 0)}</p>
        {rotulo && <p className="text-[11px] text-dark-400 mt-1">{rotulo}</p>}
      </div>
    </div>
  )
}

export type Segmento = { chave: string; rotulo: string; valor: number; cor: string; ajuda?: string }

// Barra empilhada com legenda — "Atividade da carteira".
export function BarraSegmentada({ segmentos, aoClicar, selecionado }: { segmentos: Segmento[]; aoClicar?: (chave: string) => void; selecionado?: string | null }) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0)
  if (!total) return <p className="text-sm text-dark-500">Sem clientes na carteira com esses filtros.</p>
  return (
    <div>
      <div className="flex h-11 w-full rounded-lg overflow-hidden">
        {segmentos
          .filter((s) => s.valor > 0)
          .map((s) => {
            const largura = (s.valor / total) * 100
            return (
              <button
                key={s.chave}
                type="button"
                onClick={() => aoClicar?.(s.chave)}
                title={`${s.rotulo}: ${numero(s.valor)} (${pct(largura)})`}
                className={`h-full flex items-center justify-center text-[13px] font-bold text-white transition-all hover:brightness-110 ${
                  selecionado && selecionado !== s.chave ? 'opacity-35' : ''
                } ${aoClicar ? 'cursor-pointer' : 'cursor-default'}`}
                style={{ width: `${largura}%`, background: s.cor }}
              >
                {largura >= 6 ? numero(s.valor) : ''}
              </button>
            )
          })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {segmentos.map((s) => (
          <button
            key={s.chave}
            type="button"
            onClick={() => aoClicar?.(s.chave)}
            title={s.ajuda}
            className={`flex items-center gap-1.5 text-[13px] text-dark-200 ${selecionado && selecionado !== s.chave ? 'opacity-45' : ''}`}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.cor }} />
            <span className="font-semibold">{numero(s.valor)}</span> {s.rotulo.toLowerCase()} ({pct((s.valor / total) * 100)})
          </button>
        ))}
      </div>
    </div>
  )
}

// Número pequeno com ícone (cards da linha de baixo da referência).
export function MiniNumero({ icone: Icone, valor, rotulo, cor, href, onClick, ajuda }: { icone: LucideIcon; valor: ReactNode; rotulo: string; cor: string; href?: string; onClick?: () => void; ajuda?: string }) {
  const corpo = (
    <>
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${cor}1f`, color: cor }}>
          <Icone size={19} />
        </span>
        <p className="text-xl font-bold text-dark-50 ml-auto">{valor}</p>
        {(href || onClick) && <ChevronRight size={15} className="text-dark-500 group-hover:text-gold-400" />}
      </div>
      <p className="text-[13px] mt-2 font-medium flex items-center gap-1.5" style={{ color: cor }}>
        {rotulo}
        <Dica texto={ajuda} />
      </p>
    </>
  )
  const classe = 'group block bg-dark-900 border border-dark-700 rounded-xl p-3.5 transition-all text-left w-full'
  if (href)
    return (
      <Link to={href} className={`${classe} hover:border-gold-500/50`}>
        {corpo}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${classe} hover:border-gold-500/50`}>
        {corpo}
      </button>
    )
  return <div className={classe}>{corpo}</div>
}

// Lista de ranking com barra embutida (ranking de vendedores, top produtos).
export function Ranking({ itens, formatar = numero, cor = '#24aff4', vazio = 'Nada no período.' }: { itens: { rotulo: string; valor: number; extra?: string; href?: string }[]; formatar?: (v: number) => string; cor?: string; vazio?: string }) {
  const max = Math.max(...itens.map((i) => i.valor), 0)
  if (!itens.length) return <p className="text-sm text-dark-500">{vazio}</p>
  return (
    <ul className="space-y-2.5">
      {itens.map((i, idx) => (
        <li key={i.rotulo + idx}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-dark-200 truncate">
              <span className="text-dark-500 mr-1.5 tabular-nums">{idx + 1}.</span>
              {i.rotulo}
            </span>
            <span className="text-dark-50 font-semibold tabular-nums shrink-0">
              {formatar(i.valor)}
              {i.extra && <span className="text-dark-500 font-normal text-xs ml-1.5">{i.extra}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-dark-700 mt-1 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${max ? (i.valor / max) * 100 : 0}%`, background: cor }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Etiqueta({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap" style={{ background: `${cor}1f`, color: cor }}>
      {children}
    </span>
  )
}

export function Carregando() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-24 bg-dark-800 rounded-2xl" />
      <div className="h-64 bg-dark-800 rounded-2xl" />
    </div>
  )
}

// Abas em pílula (troca de visão dentro de um relatório).
export function Abas<T extends string>({ valor, opcoes, onChange }: { valor: T; opcoes: { valor: T; rotulo: string; contagem?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-dark-600 bg-dark-800 p-1 gap-0.5 overflow-x-auto max-w-full">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onChange(o.valor)}
          className={`px-3.5 h-9 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            valor === o.valor ? 'bg-gold-500 text-white shadow-sm' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-700'
          }`}
        >
          {o.rotulo}
          {o.contagem !== undefined && (
            <span className={`text-xs rounded-md px-1.5 ${valor === o.valor ? 'bg-white/20' : 'bg-dark-700 text-dark-400'}`}>{numero(o.contagem)}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// Filtro rápido em "chips" coloridos (categoria, classe ABC, dias...).
export function Chips<T extends string | number>({ valor, opcoes, onChange }: { valor: T | null; opcoes: { valor: T; rotulo: string; cor?: string }[]; onChange: (v: T | null) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {opcoes.map((o) => {
        const ativo = valor === o.valor
        return (
          <button
            key={String(o.valor)}
            type="button"
            onClick={() => onChange(ativo ? null : o.valor)}
            className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              ativo ? 'border-transparent text-white' : 'border-dark-600 text-dark-300 hover:text-dark-100'
            }`}
            style={ativo ? { background: o.cor ?? '#0d9de0' } : undefined}
          >
            {o.cor && !ativo && <span className="w-2 h-2 rounded-full" style={{ background: o.cor }} />}
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}

// ── De onde vem o faturamento ───────────────────────────────────────────
// Carteira (vendas do Kanban) × Pedidos (módulo Pedidos da Odin) × SAP.
// Só aparece quando tem mais de uma fonte com venda no período.
type Origem = { origem: 'carteira' | 'pedidos' | 'sap'; quantidade: number; valorTotal: number }
const ORIGENS: Record<Origem['origem'], { rotulo: string; ajuda: string; cor: string }> = {
  carteira: { rotulo: 'Carteira', ajuda: 'vendas fechadas no Kanban da Carteira', cor: '#24aff4' },
  pedidos: { rotulo: 'Pedidos', ajuda: 'pedidos lançados direto no módulo Pedidos (máquinas, externos e leads)', cor: '#f97316' },
  sap: { rotulo: 'Histórico SAP', ajuda: 'pedidos importados do SAP', cor: '#8b5cf6' },
}

export function OrigemVendas({ origens, className = '' }: { origens?: Origem[]; className?: string }) {
  const com = (origens ?? []).filter((o) => o.quantidade > 0)
  if (com.length < 2) return null
  const total = com.reduce((s, o) => s + o.valorTotal, 0)
  return (
    <div className={`rounded-xl border border-dark-700 bg-dark-900 px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-dark-100">De onde vem o faturamento</p>
        <p className="text-xs text-dark-400">Total {moeda(total)}</p>
      </div>
      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-dark-700">
        {com.map((o) => (
          <span key={o.origem} style={{ width: `${total ? (o.valorTotal / total) * 100 : 0}%`, background: ORIGENS[o.origem].cor }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-2.5">
        {com.map((o) => (
          <span key={o.origem} className="flex items-center gap-1.5 text-[13px] text-dark-200" title={ORIGENS[o.origem].ajuda}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ORIGENS[o.origem].cor }} />
            <span className="font-semibold">{ORIGENS[o.origem].rotulo}</span>
            <span>{moeda(o.valorTotal)}</span>
            <span className="text-dark-400">
              · {numero(o.quantidade)} {o.quantidade === 1 ? 'venda' : 'vendas'} · {pct(total ? (o.valorTotal / total) * 100 : 0)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
