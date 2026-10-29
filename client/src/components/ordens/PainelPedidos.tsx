import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Download } from 'lucide-react'
import { formatDateTime } from '../../lib/utils'
import { PRIORIDADE_CONFIG, STAGE_LABELS, getStageSequence, type OrderType, type Stage } from '../../lib/ordensShared'
import { AvatarIniciais } from '../ui/Visual'
import { COR_ETAPA_PEDIDO, nivelAlerta, type OrdemCard } from '../OrdensBoard'
import { Pilula, baixarCsv, diasDesdeData } from '../painel/PainelVisual'
import type { Novidade, SecaoLegenda } from '../painel/PainelVisual'

// Painel dos Pedidos (visual novo, pedido do João 2026-10-22): filtros
// rápidos, trilha das etapas, modo lista, novidades e legenda.

export type FiltroPedido = 'andamento' | 'atrasados' | 'atencao' | 'urgentes' | 'prontos' | 'concluidos_mes'

// Máquina e peça terminam em Concluído (Pós-venda vem antes) — 2026-10-29.
const ETAPAS_FIM = ['concluido']
const ativo = (o: OrdemCard) => o.status === 'ativo'
const emAndamento = (o: OrdemCard) => ativo(o) && !ETAPAS_FIM.includes(o.stage)

export const TESTES_PEDIDO: Record<FiltroPedido, (o: OrdemCard) => boolean> = {
  andamento: emAndamento,
  atrasados: (o) => emAndamento(o) && nivelAlerta(o) === 'vermelho',
  atencao: (o) => emAndamento(o) && nivelAlerta(o) === 'laranja',
  urgentes: (o) => emAndamento(o) && o.detalhes?.prioridadeDespacho === 'urgente',
  prontos: (o) => ativo(o) && o.stage === 'coleta' && !!o.coleta?.confirmado,
  concluidos_mes: (o) => ativo(o) && ETAPAS_FIM.includes(o.stage) && o.updatedAt.slice(0, 7) === new Date().toISOString().slice(0, 7),
}

export const ROTULO_FILTRO_PEDIDO: Record<FiltroPedido, string> = {
  andamento: 'pedidos em andamento',
  atrasados: 'pedidos atrasados (vermelho)',
  atencao: 'pedidos pedindo atenção (laranja)',
  urgentes: 'pedidos urgentes',
  prontos: 'pedidos prontos para rastreio',
  concluidos_mes: 'pedidos concluídos este mês',
}

export function idadeMediaEmAndamento(lista: OrdemCard[]) {
  const abertos = lista.filter(emAndamento)
  if (!abertos.length) return null
  return Math.round(abertos.reduce((s, o) => s + diasDesdeData(o.createdAt), 0) / abertos.length)
}

// Trilha: todas as etapas em fila com a quantidade em cada uma. Clicar leva
// até a coluna no quadro.
export function TrilhaPedidos({ lista, orderType, aoClicar }: { lista: OrdemCard[]; orderType: OrderType; aoClicar: (stage: string) => void }) {
  const etapas = getStageSequence(orderType)
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-3 mb-3 overflow-x-auto">
      <p className="text-xs text-dark-400 mb-2 px-1">
        Caminho do pedido de <span className="font-semibold text-dark-200">{orderType === 'maquina' ? 'Máquina' : 'Peça'}</span> — clique numa etapa para ir até a coluna
      </p>
      <div className="flex items-stretch gap-1 min-w-max">
        {etapas.map((st, i) => {
          const qtd = lista.filter((o) => o.stage === st && ativo(o)).length
          const atrasados = lista.filter((o) => o.stage === st && ativo(o) && nivelAlerta(o) === 'vermelho').length
          const cor = COR_ETAPA_PEDIDO[st] ?? '#94a3b8'
          return (
            <div key={st} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => aoClicar(st)}
                className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-dark-700 ${qtd ? 'border-dark-600' : 'border-dark-700 opacity-50'}`}
                style={{ borderBottom: `3px solid ${cor}` }}
              >
                <span className="block text-lg font-bold leading-none tabular-nums" style={{ color: qtd ? cor : undefined }}>
                  {qtd}
                </span>
                <span className="block text-[10px] text-dark-400 whitespace-nowrap mt-0.5">{STAGE_LABELS[st as Stage]}</span>
                {atrasados > 0 && <span className="block text-[9px] font-bold text-red-400">{atrasados} atrasado{atrasados > 1 ? 's' : ''}</span>}
              </button>
              {i < etapas.length - 1 && <ChevronRight size={13} className="text-dark-600 shrink-0" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Coluna = 'pedido' | 'cliente' | 'etapa' | 'vendedor' | 'parado' | 'criado'

export function TabelaPedidos({ lista, orderType, aoAbrir }: { lista: OrdemCard[]; orderType: OrderType; aoAbrir: (id: number) => void }) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'parado', desc: true })
  const etapas = getStageSequence(orderType) as readonly string[]
  const ativos = lista.filter(ativo)
  const valor = (o: OrdemCard, c: Coluna): string | number =>
    c === 'pedido'
      ? o.id
      : c === 'cliente'
        ? (o.cliente?.razaoSocial ?? '').toLowerCase()
        : c === 'etapa'
          ? etapas.indexOf(o.stage)
          : c === 'vendedor'
            ? (o.vendedor?.name ?? '')
            : c === 'parado'
              ? diasDesdeData(o.updatedAt)
              : o.createdAt
  const ordenados = [...ativos].sort((a, b) => {
    const va = valor(a, ordem.col)
    const vb = valor(b, ordem.col)
    const r = va < vb ? -1 : va > vb ? 1 : 0
    return ordem.desc ? -r : r
  })
  const Th = ({ col, children }: { col: Coluna; children: ReactNode }) => (
    <th className="text-left font-medium py-2 px-3">
      <button type="button" onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : false }))} className="inline-flex items-center gap-1 hover:text-dark-100">
        {children}
        {ordem.col === col && <span>{ordem.desc ? '↓' : '↑'}</span>}
      </button>
    </th>
  )
  function exportar() {
    baixarCsv('pedidos', [
      ['Pedido', 'Nº pedido', 'Cliente', 'Etapa', 'Vendedor', 'Prioridade', 'Dias na etapa', 'Criado em'],
      ...ordenados.map((o) => [
        o.id,
        o.detalhes?.numeroPedido ?? '',
        o.cliente?.razaoSocial ?? '',
        STAGE_LABELS[o.stage as Stage] ?? o.stage,
        o.vendedor?.name ?? '',
        o.detalhes?.prioridadeDespacho ? (PRIORIDADE_CONFIG[o.detalhes.prioridadeDespacho]?.label ?? o.detalhes.prioridadeDespacho) : '',
        diasDesdeData(o.updatedAt),
        formatDateTime(o.createdAt),
      ]),
    ])
  }
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-dark-700">
        <p className="text-sm text-dark-300">
          <span className="font-semibold text-dark-50">{ativos.length}</span> pedidos · clique no título da coluna para ordenar
        </p>
        <button type="button" onClick={exportar} className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300">
          <Download size={14} /> Baixar planilha (Excel)
        </button>
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 bg-dark-900/60 sticky top-0">
            <tr>
              <Th col="pedido">Pedido</Th>
              <Th col="cliente">Cliente</Th>
              <Th col="etapa">Etapa</Th>
              <Th col="vendedor">Vendedor</Th>
              <Th col="parado">Na etapa há</Th>
              <Th col="criado">Criado em</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {ordenados.map((o) => {
              const cor = COR_ETAPA_PEDIDO[o.stage] ?? '#94a3b8'
              const alerta = ETAPAS_FIM.includes(o.stage) ? null : nivelAlerta(o)
              const prioridade = o.detalhes?.prioridadeDespacho ? PRIORIDADE_CONFIG[o.detalhes.prioridadeDespacho] : null
              const dias = diasDesdeData(o.updatedAt)
              return (
                <tr key={o.id} onClick={() => aoAbrir(o.id)} className="cursor-pointer hover:bg-dark-700/40 text-dark-200">
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="font-medium">#{o.id}</span>
                    {o.detalhes?.numeroPedido && <span className="text-[11px] text-dark-500 ml-1.5">Nº {o.detalhes.numeroPedido}</span>}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {o.cliente && <AvatarIniciais nome={o.cliente.razaoSocial} tamanho={24} />}
                      <span className="truncate max-w-64">{o.cliente?.razaoSocial ?? '—'}</span>
                      {prioridade && o.detalhes?.prioridadeDespacho === 'urgente' && <Pilula cor="#e5534b">URGENTE</Pilula>}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[11px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap" style={{ color: cor, background: `${cor}1f` }}>
                      {STAGE_LABELS[o.stage as Stage] ?? o.stage}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-dark-400 whitespace-nowrap">{o.vendedor?.name ?? '—'}</td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    <span className={alerta === 'vermelho' ? 'text-red-400 font-semibold' : alerta === 'laranja' ? 'text-orange-400 font-semibold' : 'text-dark-400'}>
                      {dias} {dias === 1 ? 'dia' : 'dias'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-dark-400 whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!ativos.length && <p className="text-sm text-dark-500 text-center py-8">Nenhum pedido com esses filtros.</p>}
      </div>
    </div>
  )
}

export const NOVIDADES_PEDIDOS: Novidade[] = [
  { emoji: '🔢', titulo: 'Números clicáveis', texto: 'Em andamento, atrasados, atenção, urgentes, prontos para rastreio e concluídos no mês. Clique para ver só esses.' },
  { emoji: '🛤️', titulo: 'Trilha do pedido', texto: 'Todas as etapas em fila com quantos pedidos há em cada uma. Clique para ir direto à coluna.' },
  { emoji: '📊', titulo: 'Barra de progresso', texto: 'Cada card mostra em que passo do caminho o pedido está (ex.: passo 4 de 12).' },
  { emoji: '🚨', titulo: 'Atrasados primeiro', texto: 'Dentro de cada coluna, os atrasados ficam no topo, depois os de atenção e os urgentes.' },
  { emoji: '🎨', titulo: 'Cor por etapa', texto: 'Cada coluna e cada card têm a cor da etapa. O topo da coluna avisa quantos estão atrasados.' },
  { emoji: '📋', titulo: 'Modo lista', texto: 'Troque o quadro por uma tabela que ordena por qualquer coluna e baixa em planilha.' },
]

export function legendaPedidos(orderType: OrderType): SecaoLegenda[] {
  return [
    {
      titulo: 'Cor das etapas',
      texto: (
        <span className="flex flex-wrap gap-1.5">
          {getStageSequence(orderType).map((st) => (
            <Pilula key={st} cor={COR_ETAPA_PEDIDO[st] ?? '#94a3b8'}>
              {STAGE_LABELS[st as Stage]}
            </Pilula>
          ))}
        </span>
      ),
    },
    {
      titulo: 'Avisos no card',
      itens: [
        { marca: <Pilula cor="#e5534b">⚠ borda vermelha</Pilula>, texto: 'Atrasado: em Coleta há mais de 24h, em Preparação há mais de 72h.' },
        { marca: <Pilula cor="#f97316">🕒 borda laranja</Pilula>, texto: 'Atenção: mais de 48h parado na mesma etapa.' },
        { marca: <Pilula cor="#22a861">✔ PRONTO</Pilula>, texto: 'Coleta confirmada — pronto para rastreio.' },
        { marca: <span className="h-1 w-16 rounded-full bg-gold-500" />, texto: 'Barra de progresso: quanto do caminho o pedido já andou.' },
      ],
    },
    {
      titulo: 'Faixa colorida no topo do card (prioridade)',
      itens: Object.entries(PRIORIDADE_CONFIG).map(([chave, c]) => ({
        marca: <span className={`h-1.5 w-16 rounded-full ${c.barra}`} />,
        texto: orderType === 'peca' && c.labelPeca ? c.labelPeca : c.label || chave,
      })),
    },
  ]
}
