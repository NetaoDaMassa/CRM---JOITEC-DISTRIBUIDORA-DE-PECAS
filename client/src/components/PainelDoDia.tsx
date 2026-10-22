import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, Siren, Sun, Wallet, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda } from '../lib/moeda'
import type { Card } from './FunilBoard'

// "Painel do dia" no topo do Kanban — substituiu o quadro "Cobertura de
// contatos" (pedido do João, 2026-10-22, opção A do mockup). Três blocos:
// o mês, hoje e "precisa de você agora". Cada urgência é clicável e filtra o
// Kanban logo abaixo (ou leva pra tela de Leads/Agenda). Números do servidor
// em funil.painelDoDia; o que sai dos próprios cards (orçamento parado,
// WhatsApp sem confirmar, em negociação) é calculado aqui.

export type FiltroPainel = { chave: string; rotulo: string; cardIds: Set<number> } | null

const moeda = (v: number) => formatarMoeda(v, { casas: 0 })
const plural = (n: number, s: string, p: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? s : p}`
const DIAS_PARADO = 7

function diasDesde(dataSqlite: string) {
  const d = new Date(dataSqlite.replace(' ', 'T') + (dataSqlite.includes('Z') ? '' : 'Z'))
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function Anel({ percentual, ideal }: { percentual: number; ideal: number }) {
  const r = 46
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, percentual))
  const cor = percentual >= ideal ? '#34c46a' : percentual >= ideal - 15 ? '#f2a516' : '#f0555a'
  return (
    <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0" aria-hidden="true">
      <circle cx="56" cy="56" r={r} fill="none" stroke="var(--color-dark-700)" strokeWidth="12" />
      <circle
        cx="56"
        cy="56"
        r={r}
        fill="none"
        stroke={cor}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`}
        transform="rotate(-90 56 56)"
        style={{ transition: 'stroke-dasharray .8s ease' }}
      />
      {/* tracinho = onde era pra estar hoje */}
      <line x1="56" y1="3" x2="56" y2="19" stroke="var(--color-dark-50)" strokeWidth="2.5" transform={`rotate(${(Math.min(100, ideal) / 100) * 360} 56 56)`} opacity=".85" />
      <text x="56" y="58" textAnchor="middle" fill="var(--color-dark-50)" fontSize="24" fontWeight="700">
        {percentual}%
      </text>
      <text x="56" y="75" textAnchor="middle" fill="var(--color-dark-400)" fontSize="10.5">
        carteira
      </text>
    </svg>
  )
}

function Linha({ rotulo, children }: { rotulo: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-dark-700 first:border-t-0 text-[13px]">
      <span className="text-dark-300">{rotulo}</span>
      <span className="font-semibold text-dark-50 tabular-nums text-right">{children}</span>
    </div>
  )
}

function Barra({ percentual, cor, marca }: { percentual: number; cor: string; marca?: number }) {
  return (
    <div className="relative h-2 rounded-full bg-dark-700">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, percentual))}%`, background: cor }} />
      {marca !== undefined && <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-dark-50/80" style={{ left: `${Math.min(100, marca)}%` }} title="Onde era pra estar hoje" />}
    </div>
  )
}

function Mini({ rotulo, valor, detalhe, corDetalhe }: { rotulo: string; valor: string; detalhe: string; corDetalhe?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl px-3.5 py-3 min-w-0">
      <p className="text-xs text-dark-400">{rotulo}</p>
      <p className="text-lg font-bold text-dark-50 tabular-nums mt-0.5 truncate">{valor}</p>
      <p className={`text-xs mt-0.5 ${corDetalhe ?? 'text-dark-500'}`}>{detalhe}</p>
    </div>
  )
}

type Urgencia = { chave: string; n: number; texto: string; cor: string; acao: { tipo: 'filtro'; cardIds: Set<number> } | { tipo: 'link'; to: string } }

export default function PainelDoDia({
  cards,
  mes,
  vendedorId,
  todos,
  filtro,
  onFiltrar,
}: {
  cards: Card[]
  mes: string
  vendedorId?: number
  todos?: boolean
  filtro: FiltroPainel
  onFiltrar: (f: FiltroPainel) => void
}) {
  const { user } = useAuth()
  const [explicacao, setExplicacao] = useState(false)
  // Atualiza sozinho (a cobertura já atualizava a cada 10s — vendedor
  // reclamava que "não batia" sem dar F5).
  const { data } = trpc.funil.painelDoDia.useQuery({ vendedorId, todos, mesReferencia: mes }, { refetchInterval: 20_000 })
  if (!data) return <div className="mb-4 h-56 rounded-2xl bg-dark-800 border border-dark-600 animate-pulse" />

  const admin = user?.role === 'admin'
  const { cobertura, faturamento, hojeInfo, urgencias } = data

  // ── Números tirados dos cards na tela ──
  const negociacao = cards.filter((c) => c.etapa === 'negociacao')
  const valorNegociacao = negociacao.reduce((s, c) => s + (c.valorOrcado ?? 0), 0)
  const parados = negociacao.filter((c) => (c.diasSemContato ?? diasDesde(c.dataEntradaEtapa)) >= DIAS_PARADO)
  const whatsPendentes = cards.filter((c) => c.contatos.some((ct) => ct.origem !== 'manual' && ct.resultado == null))
  const idsPararam = new Set(urgencias.pararamDeComprar)
  const cardsPararam = cards.filter((c) => idsPararam.has(c.clienteId) && !['fechado', 'faturamento'].includes(c.etapa))
  const idsAgenda = new Set(urgencias.clientesCompromissosAtrasados)
  const cardsAgenda = cards.filter((c) => idsAgenda.has(c.clienteId))
  const ids = (l: Card[]) => new Set(l.map((c) => c.funilMensalId))

  const base = admin ? '/admin' : '/vendedor'
  const lista: Urgencia[] = [
    { chave: 'leads', n: urgencias.leadsNovos, texto: 'Leads novos esperando o 1º contato', cor: '#f0555a', acao: { tipo: 'link', to: `${base}/leads` } },
    {
      chave: 'agenda',
      n: urgencias.compromissosAtrasados,
      texto: 'Compromissos da agenda atrasados',
      cor: '#f0555a',
      acao: cardsAgenda.length ? { tipo: 'filtro', cardIds: ids(cardsAgenda) } : { tipo: 'link', to: `${base}/calendario` },
    },
    { chave: 'leadsAtrasados', n: urgencias.leadsAtrasados, texto: 'Leads com retorno atrasado', cor: '#f0555a', acao: { tipo: 'link', to: `${base}/leads` } },
    { chave: 'parados', n: parados.length, texto: `Orçamentos parados há ${DIAS_PARADO}+ dias sem contato`, cor: '#f2a516', acao: { tipo: 'filtro', cardIds: ids(parados) } },
    { chave: 'whats', n: whatsPendentes.length, texto: 'Contatos clicados sem confirmar', cor: '#f2a516', acao: { tipo: 'filtro', cardIds: ids(whatsPendentes) } },
    { chave: 'pararam', n: cardsPararam.length, texto: 'Clientes que compravam e estão há 60+ dias sem comprar', cor: '#24aff4', acao: { tipo: 'filtro', cardIds: ids(cardsPararam) } },
  ].filter((u) => u.n > 0) as Urgencia[]

  const metaHoje = hojeInfo.metaLigacoesDia
  const pctHoje = metaHoje ? (hojeInfo.ligacoes / metaHoje) * 100 : 0
  const horaAgora = new Date().getHours()
  const horasRestantes = Math.max(1, 18 - Math.max(8, horaAgora))
  const faltaHoje = Math.max(0, metaHoje - hojeInfo.ligacoes)
  const [anoM, mesM] = mes.split('-')
  const nomeHoje = new Date(`${data.hoje}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const conv = data.conversao

  const cardClasse = 'bg-dark-800 border border-dark-600 rounded-2xl p-4 min-w-0'
  const titulo = (icone: ReactNode, texto: ReactNode) => <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1.5">{icone}{texto}</p>

  return (
    <div className="mb-4 space-y-3">
      <div className={`grid gap-3 ${data.mesAtual ? 'lg:grid-cols-[1.15fr_1fr_1.25fr]' : 'lg:grid-cols-2'}`}>
        {/* ── O mês ── */}
        <div className={cardClasse}>
          <div className="flex items-center justify-between gap-2">
            {titulo(<Wallet size={14} />, data.mesAtual ? 'Este mês' : `Mês ${mesM}/${anoM}`)}
            <button type="button" onClick={() => setExplicacao((v) => !v)} className="text-xs text-gold-500 hover:underline">
              {explicacao ? 'fechar explicação' : 'ⓘ como é feita a conta?'}
            </button>
          </div>
          {/* Regras em lib/coberturaContatos.ts (server) — manter os dois iguais. */}
          {explicacao && (
            <ul className="mt-2 space-y-1.5 rounded-xl bg-dark-900 border border-dark-700 p-3 text-xs text-dark-300 leading-relaxed list-disc pl-7">
              <li>
                A cobertura é em cima da <b className="text-dark-100">carteira inteira</b>, não só da coluna Novo: cada cliente precisa de pelo menos{' '}
                <b className="text-dark-100">1 contato registrado neste mês</b> (ligação, WhatsApp, e-mail ou visita).
              </li>
              <li>
                <b className="text-dark-100">Por isso "sem contato" pode ser maior que o Novo:</b> card em Negociação que veio do mês passado (ou em Perdido,
                Fechado, Outras Linhas) também precisa de um contato novo este mês pra contar.
              </li>
              <li>
                <b className="text-dark-100">Clique no botão do WhatsApp só conta depois de confirmar</b> — abra o card e clique em "Confirmar" no contato.
              </li>
              <li>
                <b className="text-dark-100">Não entram na conta:</b> clientes parados em Consumidor Final (repassado), Consumidor Final da loja ou Faturamento que
                não tiveram contato no mês. Se tiverem contato, contam normal.
              </li>
              <li>CNPJs vinculados da sua carteira contam como 1 cliente só — contato em um vale pro outro.</li>
              <li>O tracinho branco marca onde era pra estar hoje, pelos dias úteis que já passaram.</li>
              <li>Faturamento = vendas registradas no mês nos cards do Kanban, contra a meta do vendedor (tela Metas).</li>
            </ul>
          )}
          <div className="flex items-center gap-4 mt-3">
            <Anel percentual={cobertura.percentual} ideal={cobertura.percentualIdealHoje} />
            <div className="flex-1 min-w-0">
              <Linha rotulo="Contatados">
                <span className="text-emerald-500">
                  {cobertura.contatados} de {cobertura.total}
                </span>
              </Linha>
              <Linha rotulo="Sem contato ainda">
                <span className={cobertura.semContato ? 'text-red-500' : 'text-dark-400'}>{cobertura.semContato}</span>
              </Linha>
              {data.mesAtual && (
                <Linha rotulo="Esperado pra hoje">
                  {cobertura.percentualIdealHoje}%{' '}
                  <span className={cobertura.naMedia ? 'text-emerald-500' : 'text-red-500'}>
                    · {cobertura.naMedia ? 'em dia' : `faltam ${cobertura.faltamParaMeta}`}
                  </span>
                </Linha>
              )}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2 text-[13px] mb-1.5">
              <span className="text-dark-300">Faturamento x meta</span>
              <span className="font-semibold text-dark-50 tabular-nums">
                {moeda(faturamento.valor)}
                {faturamento.meta ? <span className="text-dark-400 font-normal"> de {moeda(faturamento.meta)}</span> : null}
              </span>
            </div>
            <Barra percentual={faturamento.percentualMeta ?? 0} cor="#24aff4" marca={faturamento.meta && data.mesAtual ? faturamento.percentualIdealHoje : undefined} />
            <p className="text-xs text-dark-400 mt-1.5">
              {!faturamento.meta
                ? 'Sem meta de faturamento cadastrada.'
                : faturamento.falta <= 0
                  ? '✅ Meta do mês batida!'
                  : data.mesAtual
                    ? `${Math.round(faturamento.percentualMeta ?? 0)}% da meta · faltam ${moeda(faturamento.falta)} em ${plural(faturamento.diasUteisRestantes, 'dia útil', 'dias úteis')} (${moeda(faturamento.faltaPorDia)}/dia)`
                    : `${Math.round(faturamento.percentualMeta ?? 0)}% da meta`}
            </p>
          </div>
        </div>

        {/* ── Hoje ── */}
        {data.mesAtual && (
          <div className={cardClasse}>
            {titulo(<Sun size={14} />, `Hoje, ${nomeHoje}`)}
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-bold text-dark-50 tabular-nums">{hojeInfo.ligacoes}</span>
              <span className="text-xs text-dark-400">de {metaHoje} ligações (meta do dia)</span>
            </div>
            <div className="mt-2">
              <Barra percentual={pctHoje} cor={pctHoje >= 100 ? '#34c46a' : '#f2a516'} />
            </div>
            <p className={`text-xs mt-1.5 ${faltaHoje ? 'text-amber-500' : 'text-emerald-500'}`}>
              {!hojeInfo.diaUtil
                ? 'Hoje não é dia útil.'
                : faltaHoje
                  ? `Faltam ${faltaHoje}${horaAgora < 18 ? ` · ~${Math.ceil(faltaHoje / horasRestantes)} por hora até as 18h` : ''}`
                  : '✅ Meta de ligações de hoje batida'}
              <span className="text-dark-500"> · {plural(hojeInfo.contatos, 'contato', 'contatos')} no total hoje</span>
            </p>
            {hojeInfo.sequenciaDiasVendendo !== null && (
              <div className="mt-3 flex items-center gap-2.5">
                <span className="text-xl">🔥</span>
                <div>
                  <p className="text-sm font-semibold text-dark-50">{plural(hojeInfo.sequenciaDiasVendendo, 'dia útil seguido vendendo', 'dias úteis seguidos vendendo')}</p>
                  <p className="text-xs text-dark-500">{hojeInfo.sequenciaDiasVendendo ? 'Venda hoje pra não quebrar a sequência' : 'Uma venda hoje começa a sequência'}</p>
                </div>
              </div>
            )}
            <div className="mt-3">
              {titulo(<CalendarClock size={14} />, 'Agenda de hoje')}
              {data.agendaHoje.length === 0 ? (
                <p className="text-xs text-dark-500 mt-1.5">Nada marcado pra hoje.</p>
              ) : (
                <ul className="mt-1">
                  {data.agendaHoje.slice(0, 4).map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3 py-1 border-t border-dark-700 first:border-t-0 text-[13px]">
                      <span className="text-dark-200 truncate">
                        <span className="tabular-nums text-dark-400 mr-1.5">{new Date(c.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        {c.titulo}
                        {c.cliente && <span className="text-dark-500"> · {c.cliente}</span>}
                      </span>
                      <span className={`text-xs shrink-0 ${c.concluido ? 'text-emerald-500' : new Date(c.dataHora) < new Date() ? 'text-red-500' : 'text-dark-400'}`}>
                        {c.concluido ? 'feito' : new Date(c.dataHora) < new Date() ? 'atrasado' : 'a fazer'}
                      </span>
                    </li>
                  ))}
                  {data.agendaHoje.length > 4 && (
                    <li className="text-xs pt-1">
                      <Link to={`${base}/calendario`} className="text-gold-500 hover:underline">
                        + {data.agendaHoje.length - 4} na agenda
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ── Precisa de você agora ── */}
        <div className={cardClasse}>
          {titulo(<Siren size={14} />, 'Precisa de você agora')}
          {lista.length === 0 ? (
            <p className="text-sm text-emerald-500 mt-3">👏 Nada pendente. Tudo em dia!</p>
          ) : (
            <div className="grid gap-2 mt-2.5">
              {lista.map((u) => {
                const ativo = filtro?.chave === u.chave
                const conteudo = (
                  <>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: u.cor }} />
                    <span className="text-[17px] font-bold tabular-nums min-w-7" style={{ color: u.cor }}>
                      {u.n}
                    </span>
                    <span className="text-[13px] text-dark-100 text-left">{u.texto}</span>
                    {ativo ? <X size={15} className="ml-auto text-gold-500 shrink-0" /> : <ChevronRight size={15} className="ml-auto text-dark-500 shrink-0" />}
                  </>
                )
                const classe = `flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                  ativo ? 'border-gold-500 bg-gold-500/10' : 'border-dark-600 bg-dark-900 hover:border-gold-500/60'
                }`
                return u.acao.tipo === 'link' ? (
                  <Link key={u.chave} to={u.acao.to} className={classe}>
                    {conteudo}
                  </Link>
                ) : (
                  <button
                    key={u.chave}
                    type="button"
                    className={classe}
                    onClick={() => onFiltrar(ativo ? null : { chave: u.chave, rotulo: u.texto, cardIds: (u.acao as { cardIds: Set<number> }).cardIds })}
                    title={ativo ? 'Mostrar todos os cards de novo' : 'Mostrar só esses cards no Kanban'}
                  >
                    {conteudo}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini rotulo="Em negociação" valor={moeda(valorNegociacao)} detalhe={plural(negociacao.length, 'orçamento aberto', 'orçamentos abertos')} />
        <Mini rotulo="Vendas no mês" valor={plural(faturamento.qtdVendas, 'venda', 'vendas')} detalhe={faturamento.qtdVendas ? `ticket médio ${moeda(faturamento.ticket)}` : 'nenhuma venda ainda'} />
        <Mini
          rotulo="Conversão (vendas ÷ vendas + perdidos)"
          valor={conv.atual === null ? '—' : `${Math.round(conv.atual)}%`}
          detalhe={
            conv.atual === null || conv.anterior === null
              ? 'sem comparação com o mês anterior'
              : `${conv.atual >= conv.anterior ? '↑' : '↓'} ${Math.abs(Math.round(conv.atual - conv.anterior))} pontos vs mês anterior`
          }
          corDetalhe={conv.atual !== null && conv.anterior !== null ? (conv.atual >= conv.anterior ? 'text-emerald-500' : 'text-red-500') : undefined}
        />
        <Mini
          rotulo="Clientes que compraram no mês"
          valor={`${data.positivacao.compraram} de ${data.positivacao.carteira}`}
          detalhe={`${data.positivacao.carteira ? Math.round((data.positivacao.compraram / data.positivacao.carteira) * 100) : 0}% da carteira positivada`}
        />
      </div>

      {filtro && (
        <div className="flex items-center gap-2 rounded-xl border border-gold-500/50 bg-gold-500/10 px-3 py-2 text-sm text-dark-100">
          Mostrando só: <b>{filtro.rotulo}</b> ({filtro.cardIds.size})
          <button type="button" onClick={() => onFiltrar(null)} className="ml-auto text-gold-500 hover:underline flex items-center gap-1">
            <X size={14} /> Mostrar todos
          </button>
        </div>
      )}
    </div>
  )
}
