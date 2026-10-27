import { useState } from 'react'
import type { ReactNode } from 'react'
import { Download, ThumbsDown, Trophy } from 'lucide-react'
import { formatDateTime } from '../../lib/utils'
import { PROPOSTA_STAGE_LABELS, isOverdue, type PropostaStage } from '../../lib/propostasShared'
import { AvatarIniciais } from '../ui/Visual'
import { COR_ETAPA_PROPOSTA, DIAS_PARADA_ALERTA, DIAS_PARADA_ATENCAO, ETAPAS_ABERTAS_PROPOSTA, type PropostaCard } from '../PropostasBoard'
import { Pilula, baixarCsv, corIdade, diasDesdeData } from '../painel/PainelVisual'
import type { Novidade, SecaoLegenda } from '../painel/PainelVisual'

// Painel das Propostas (visual novo, pedido do João 2026-10-22): filtros
// rápidos, ranking do mês, motivos de perda, modo lista, novidades e legenda.

export type FiltroProposta = 'abertas' | 'urgentes' | 'sem_pdf' | 'alteracao' | 'paradas' | 'retomar' | 'fechadas_mes'

export function temPdf(p: PropostaCard) {
  return p.arquivos.some((a) => a.fileCategory === 'proposta_pdf' || a.tipoArquivo?.includes('pdf'))
}

const doMes = (d: string) => d.slice(0, 7) === new Date().toISOString().slice(0, 7)
const aberta = (p: PropostaCard) => ETAPAS_ABERTAS_PROPOSTA.includes(p.stage)
const fechada = (p: PropostaCard) => p.stage === 'fechado' || p.stage === 'convertido'

export const TESTES_PROPOSTA: Record<FiltroProposta, (p: PropostaCard) => boolean> = {
  abertas: aberta,
  urgentes: (p) => aberta(p) && p.prioridade === 'urgente',
  sem_pdf: (p) => p.stage === 'proposta' && !temPdf(p),
  alteracao: (p) => aberta(p) && p.alteracoes.length > 0,
  paradas: (p) => aberta(p) && diasDesdeData(p.updatedAt) >= DIAS_PARADA_ALERTA,
  retomar: (p) => p.stage === 'chamar_depois' && !!p.dataRetorno && isOverdue(p.dataRetorno),
  fechadas_mes: (p) => fechada(p) && doMes(p.updatedAt),
}

export const ROTULO_FILTRO_PROPOSTA: Record<FiltroProposta, string> = {
  abertas: 'propostas em aberto (Proposta + Negociação)',
  urgentes: 'propostas urgentes em aberto',
  sem_pdf: 'propostas sem PDF anexado',
  alteracao: 'propostas com alteração pedida',
  paradas: `propostas paradas há ${DIAS_PARADA_ALERTA}+ dias`,
  retomar: 'propostas para retomar (data de retorno chegou)',
  fechadas_mes: 'propostas fechadas este mês',
}

export function conversaoMes(lista: PropostaCard[]) {
  const ganhas = lista.filter((p) => fechada(p) && doMes(p.updatedAt)).length
  const perdidas = lista.filter((p) => p.stage === 'perdido' && doMes(p.updatedAt)).length
  return { ganhas, perdidas, taxa: ganhas + perdidas ? Math.round((ganhas / (ganhas + perdidas)) * 100) : null }
}

function Bloco({ titulo, icone, children, sub }: { titulo: string; icone: ReactNode; children: ReactNode; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icone}
        <h2 className="text-sm font-semibold text-dark-50">{titulo}</h2>
        {sub && <span className="text-xs text-dark-500 truncate">{sub}</span>}
      </div>
      {children}
    </div>
  )
}

export function RankingPropostas({ lista }: { lista: PropostaCard[] }) {
  const mapa = new Map<string, { fechadas: number; abertas: number; perdidas: number }>()
  for (const p of lista) {
    const nome = p.vendedor?.name
    if (!nome) continue
    const v = mapa.get(nome) ?? { fechadas: 0, abertas: 0, perdidas: 0 }
    if (fechada(p) && doMes(p.updatedAt)) v.fechadas++
    if (aberta(p)) v.abertas++
    if (p.stage === 'perdido' && doMes(p.updatedAt)) v.perdidas++
    mapa.set(nome, v)
  }
  const itens = [...mapa.entries()].filter(([, v]) => v.fechadas || v.abertas || v.perdidas).sort((a, b) => b[1].fechadas - a[1].fechadas || b[1].abertas - a[1].abertas)
  const medalha = ['🥇', '🥈', '🥉']
  return (
    <Bloco titulo="Ranking do mês" icone={<Trophy size={16} className="text-gold-400" />} sub="propostas fechadas este mês">
      {itens.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {itens.map(([nome, v], i) => {
            const taxa = v.fechadas + v.perdidas ? Math.round((v.fechadas / (v.fechadas + v.perdidas)) * 100) : null
            return (
              <div key={nome} className="shrink-0 w-44 rounded-xl bg-dark-900 border border-dark-700 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <AvatarIniciais nome={nome} tamanho={26} />
                  <span className="text-[13px] font-semibold text-dark-100 truncate flex-1">{nome.split(' ')[0]}</span>
                  <span className="text-base">{v.fechadas > 0 ? (medalha[i] ?? '') : ''}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-2">
                  <span className="text-xl font-bold text-emerald-400 tabular-nums">{v.fechadas}</span>
                  <span className="text-[11px] text-dark-400">{v.fechadas === 1 ? 'fechada' : 'fechadas'}</span>
                  {taxa !== null && <span className="text-[11px] text-dark-300 ml-auto">{taxa}% conv.</span>}
                </div>
                <p className="text-[11px] text-dark-500 mt-0.5">
                  {v.abertas} em aberto · <span className={v.perdidas ? 'text-red-400' : ''}>{v.perdidas} perdidas</span>
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-dark-500">Nenhuma proposta com esses filtros.</p>
      )}
    </Bloco>
  )
}

// Motivo de perda é texto livre — agrupa pelo começo do texto (minúsculo,
// sem pontuação), que já junta "preço", "Preço." e "preço alto" parecidos.
export function MotivosPerda({ lista }: { lista: PropostaCard[] }) {
  const mapa = new Map<string, { texto: string; qtd: number }>()
  for (const p of lista) {
    if (p.stage !== 'perdido' || !p.motivoPerda?.trim()) continue
    const chave = p.motivoPerda
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .slice(0, 30)
    const item = mapa.get(chave) ?? { texto: p.motivoPerda.trim(), qtd: 0 }
    item.qtd++
    mapa.set(chave, item)
  }
  const itens = [...mapa.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 6)
  const max = itens[0]?.qtd ?? 0
  const total = lista.filter((p) => p.stage === 'perdido').length
  return (
    <Bloco titulo="Por que perdemos" icone={<ThumbsDown size={16} className="text-red-400" />} sub={`${total} perdidas`}>
      {itens.length ? (
        <ul className="space-y-2">
          {itens.map((m) => (
            <li key={m.texto}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-dark-200 truncate">{m.texto}</span>
                <span className="text-dark-50 font-semibold tabular-nums">{m.qtd}</span>
              </div>
              <div className="h-1.5 rounded-full bg-dark-700 mt-1 overflow-hidden">
                <div className="h-full rounded-full bg-red-500/80" style={{ width: `${(m.qtd / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-dark-500">Nenhum motivo de perda registrado.</p>
      )}
    </Bloco>
  )
}

type Coluna = 'cliente' | 'etapa' | 'vendedor' | 'parada' | 'criado'

export function TabelaPropostas({ lista, mostrarVendedor, aoAbrir }: { lista: PropostaCard[]; mostrarVendedor: boolean; aoAbrir: (id: number) => void }) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'criado', desc: true })
  const ordemEtapa = Object.keys(COR_ETAPA_PROPOSTA)
  const valor = (p: PropostaCard, c: Coluna): string | number =>
    c === 'cliente' ? p.clienteNome.toLowerCase() : c === 'etapa' ? ordemEtapa.indexOf(p.stage) : c === 'vendedor' ? (p.vendedor?.name ?? '') : c === 'parada' ? diasDesdeData(p.updatedAt) : p.createdAt
  const ordenados = [...lista].sort((a, b) => {
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
    baixarCsv('propostas', [
      ['Nº', 'Cliente', 'Etapa', 'Vendedor', 'Prioridade', 'PDF', 'Dias sem mudança', 'Criada em', 'Motivo da perda'],
      ...ordenados.map((p) => [
        p.id,
        p.clienteNome,
        PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage,
        p.vendedor?.name ?? '',
        p.prioridade === 'urgente' ? 'Urgente' : 'Normal',
        temPdf(p) ? 'Sim' : 'Não',
        diasDesdeData(p.updatedAt),
        formatDateTime(p.createdAt),
        p.motivoPerda ?? '',
      ]),
    ])
  }
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-dark-700">
        <p className="text-sm text-dark-300">
          <span className="font-semibold text-dark-50">{lista.length}</span> propostas · clique no título da coluna para ordenar
        </p>
        <button type="button" onClick={exportar} className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300">
          <Download size={14} /> Baixar planilha (Excel)
        </button>
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 bg-dark-900/60 sticky top-0">
            <tr>
              <Th col="cliente">Cliente</Th>
              <Th col="etapa">Etapa</Th>
              {mostrarVendedor && <Th col="vendedor">Vendedor</Th>}
              <Th col="parada">Sem mudança</Th>
              <Th col="criado">Criada em</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {ordenados.map((p) => {
              const cor = COR_ETAPA_PROPOSTA[p.stage] ?? '#94a3b8'
              const dias = diasDesdeData(p.updatedAt)
              const abertaP = aberta(p)
              return (
                <tr key={p.id} onClick={() => aoAbrir(p.id)} className="cursor-pointer hover:bg-dark-700/40 text-dark-200">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <AvatarIniciais nome={p.clienteNome} tamanho={26} />
                      <span className="truncate max-w-64">{p.clienteNome}</span>
                      <span className="text-[10px] font-mono text-dark-500">#{p.id}</span>
                      {p.prioridade === 'urgente' && <Pilula cor="#e5534b">URGENTE</Pilula>}
                      {!temPdf(p) && p.stage === 'proposta' && <Pilula cor="#eab308">sem PDF</Pilula>}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[11px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap" style={{ color: cor, background: `${cor}1f` }}>
                      {PROPOSTA_STAGE_LABELS[p.stage as PropostaStage] ?? p.stage}
                    </span>
                  </td>
                  {mostrarVendedor && <td className="py-2 px-3 text-xs text-dark-400 whitespace-nowrap">{p.vendedor?.name ?? '—'}</td>}
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    <span style={{ color: abertaP ? corIdade(dias, DIAS_PARADA_ATENCAO, DIAS_PARADA_ALERTA) : undefined }} className={abertaP ? 'font-semibold' : 'text-dark-500'}>
                      {dias} {dias === 1 ? 'dia' : 'dias'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-dark-400 whitespace-nowrap">{formatDateTime(p.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!lista.length && <p className="text-sm text-dark-500 text-center py-8">Nenhuma proposta com esses filtros.</p>}
      </div>
    </div>
  )
}

export const NOVIDADES_PROPOSTAS: Novidade[] = [
  { emoji: '🔢', titulo: 'Números clicáveis', texto: 'Em aberto, urgentes, sem PDF, com alteração, paradas, para retomar e fechadas no mês. Clique para ver só essas no quadro.' },
  { emoji: '🎨', titulo: 'Cor por etapa', texto: 'Cada coluna e cada card têm a cor da etapa. O topo da coluna avisa quantas estão paradas.' },
  { emoji: '⏳', titulo: 'Parada há X dias', texto: `Proposta ou Negociação sem nenhuma mudança: amarelo a partir de ${DIAS_PARADA_ATENCAO} dias, vermelho a partir de ${DIAS_PARADA_ALERTA}.` },
  { emoji: '🆕', titulo: 'Mais recentes primeiro', texto: 'Dentro de cada coluna, as propostas criadas por último ficam no topo.' },
  { emoji: '🏆', titulo: 'Ranking do mês', texto: 'Quantas cada vendedor fechou no mês, quantas tem em aberto e a % de conversão.' },
  { emoji: '👎', titulo: 'Por que perdemos', texto: 'Os motivos de perda que mais se repetem, para saber onde agir.' },
  { emoji: '📋', titulo: 'Modo lista', texto: 'Troque o quadro por uma tabela que ordena por qualquer coluna e baixa em planilha.' },
]

export const LEGENDA_PROPOSTAS: SecaoLegenda[] = [
  {
    titulo: 'Cor das etapas (topo da coluna e faixa do card)',
    texto: (
      <span className="flex flex-wrap gap-1.5">
        {Object.entries(COR_ETAPA_PROPOSTA).map(([s, cor]) => (
          <Pilula key={s} cor={cor}>
            {PROPOSTA_STAGE_LABELS[s as PropostaStage]}
          </Pilula>
        ))}
      </span>
    ),
  },
  {
    titulo: 'Avisos no card',
    itens: [
      { marca: <Pilula cor="#e8a33a">⏳ parada há 4 dias</Pilula>, texto: `Sem mudança há ${DIAS_PARADA_ATENCAO} a ${DIAS_PARADA_ALERTA - 1} dias.` },
      { marca: <Pilula cor="#e5534b">⏳ parada há 9 dias</Pilula>, texto: `Sem mudança há ${DIAS_PARADA_ALERTA} dias ou mais — retomar.` },
      { marca: <Pilula cor="#e5534b">⚡ URGENTE</Pilula>, texto: 'Marcada como urgente (borda vermelha à esquerda).' },
      { marca: <Pilula cor="#f59e0b">ALTERAÇÃO</Pilula>, texto: 'Alguém pediu alteração (borda amarela à esquerda).' },
      { marca: <Pilula cor="#eab308">⚠ sem PDF</Pilula>, texto: 'Ainda sem PDF — obrigatório para ir para Negociação.' },
      { marca: <Pilula cor="#f97316">Retomar</Pilula>, texto: 'Em "Chamar Depois": vermelho quando a data de retorno chegou.' },
    ],
  },
  {
    titulo: 'Números do topo',
    texto: 'Fechadas no mês conta Fechado + viraram Pedido. A conversão é fechadas ÷ (fechadas + perdidas) no mês, pela data da última mudança.',
  },
]
