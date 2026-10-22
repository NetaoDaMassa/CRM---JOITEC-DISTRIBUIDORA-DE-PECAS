import { useState } from 'react'
import type { ReactNode } from 'react'
import { Download, Info, MessageCircle, Sparkles, Trophy, X } from 'lucide-react'
import { formatElapsed, timeAgo } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'
import { LEAD_STATUS_LABELS, getLeadContactUrgency, isLeadTerminalStatus, leadTelefoneCompleto, leadTelefoneFormatado } from '../../lib/leadsShared'
import { AvatarIniciais } from '../ui/Visual'

// Peças das ideias novas do Kanban de Leads (pedido do João, 2026-10-22:
// "pode construir as novas ideias ... tem que explicar o que foi feito e já
// deixar legenda"): temperatura do lead, relógio do "Novo", mensagens
// prontas de WhatsApp, ranking da semana, modo lista, novidades e legenda.

export type LeadKanban = {
  id: number
  name: string
  phone: string | null
  ddd: number | null
  email: string | null
  company: string | null
  status: string
  negotiationTag: string | null
  nextContactAt: string | null
  createdAt: string
  updatedAt: string
  statusChangedAt: string | null
  assignedAt?: string | null
  lastContactAt?: string | null
  attemptCount?: number | null
  orderValue?: number | null
  finalOrderValue?: number | null
  fromSite?: boolean
  source?: string | null
  observations?: string | null
  vendor?: { name: string } | null
  attachments?: { mimeType: string }[]
}

export const COR_ETAPA_LEAD: Record<string, string> = {
  novo: '#3987e5',
  novo_consumidor_final: '#5b6cf0',
  abordagem: '#e8a33a',
  qualificado: '#8b5cf6',
  em_negociacao: '#f97316',
  ganho: '#22a861',
  perdido: '#e5534b',
  desqualificado: '#64748b',
  consumidor_final: '#0ea5a4',
}

export const DIAS_ESFRIANDO = 5

export function paraData(d: string) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d.replace(' ', 'T')}Z`)
}

// "Esquecido" = lead em andamento SEM próximo contato marcado e sem nenhuma
// mudança há DIAS_ESFRIANDO dias (quem tem contato atrasado já aparece como
// ATRASADO, não entra aqui).
export function diasEsquecido(lead: Pick<LeadKanban, 'status' | 'updatedAt' | 'statusChangedAt' | 'nextContactAt'>) {
  if (isLeadTerminalStatus(lead.status) || lead.nextContactAt) return 0
  const ultima = [lead.updatedAt, lead.statusChangedAt].filter((d): d is string => !!d).map((d) => paraData(d).getTime())
  return Math.floor((Date.now() - Math.max(...ultima)) / 86400000)
}

export function urgenciaLead(lead: Pick<LeadKanban, 'nextContactAt' | 'status'>) {
  return lead.nextContactAt ? getLeadContactUrgency(lead.nextContactAt, lead.status) : null
}

// ── Temperatura ─────────────────────────────────────────────────────────
// Nota simples, só com o que o card já sabe — sem IA. Soma pontos e diz o
// motivo de cada um (aparece ao passar o mouse no selo).
export type Temperatura = { nivel: 'quente' | 'morno' | 'frio'; pontos: number; motivos: string[] }

export const TEMPERATURA_VISUAL: Record<Temperatura['nivel'], { rotulo: string; emoji: string; cor: string }> = {
  quente: { rotulo: 'Quente', emoji: '🔥', cor: '#f97316' },
  morno: { rotulo: 'Morno', emoji: '🌤️', cor: '#e8a33a' },
  frio: { rotulo: 'Frio', emoji: '🧊', cor: '#38bdf8' },
}

export function temperaturaLead(lead: LeadKanban): Temperatura | null {
  if (isLeadTerminalStatus(lead.status)) return null
  let pontos = 0
  const motivos: string[] = []
  const somar = (p: number, motivo: string) => {
    pontos += p
    motivos.push(`${p > 0 ? '+' : ''}${p} ${motivo}`)
  }
  if (lead.source === 'meta_ads_lead' || lead.fromSite) somar(1, 'veio de anúncio ou do site (procurou a gente)')
  if (lead.observations?.trim() || (lead.attachments ?? []).length) somar(1, 'mandou mensagem, foto ou áudio')
  const diasRecebido = Math.floor((Date.now() - paraData(lead.createdAt).getTime()) / 86400000)
  if (diasRecebido <= 2) somar(2, 'chegou há até 2 dias')
  else if (diasRecebido <= 7) somar(1, 'chegou há até 7 dias')
  if (lead.status === 'qualificado' || lead.status === 'em_negociacao') somar(2, `já está em "${LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS]}"`)
  else if (lead.status === 'abordagem') somar(1, 'já está em "Abordagem"')
  if (lead.negotiationTag === 'vermelho') somar(-2, 'marcado como 🔴 Risco')
  if (lead.negotiationTag === 'amarelo') somar(-1, 'marcado como 🟡 Atenção')
  if (diasEsquecido(lead) >= DIAS_ESFRIANDO) somar(-2, 'esquecido (sem próximo contato)')
  if (urgenciaLead(lead)?.atrasado) somar(-1, 'contato atrasado')
  const nivel = pontos >= 4 ? 'quente' : pontos >= 2 ? 'morno' : 'frio'
  return { nivel, pontos, motivos }
}

export function SeloTemperatura({ t }: { t: Temperatura }) {
  const v = TEMPERATURA_VISUAL[t.nivel]
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 cursor-help"
      style={{ color: v.cor, background: `${v.cor}1f` }}
      title={`${v.rotulo} (${t.pontos} pontos)\n${t.motivos.join('\n') || 'nenhum ponto'}`}
    >
      {v.emoji} {v.rotulo}
    </span>
  )
}

// ── Relógio do "Novo" ───────────────────────────────────────────────────
// Tempo desde que o lead caiu na mão do vendedor sem nenhum contato
// registrado. Verde até 1h, amarelo até 4h, vermelho depois (horas
// corridas).
export function relogioNovo(lead: LeadKanban): { texto: string; cor: string } | null {
  if (lead.status !== 'novo' || lead.lastContactAt || (lead.attemptCount ?? 0) > 0) return null
  const desde = lead.assignedAt || lead.createdAt
  const horas = (Date.now() - paraData(desde).getTime()) / 3600000
  const cor = horas < 1 ? '#22a861' : horas < 4 ? '#e8a33a' : '#e5534b'
  return { texto: `${formatElapsed(paraData(desde))} sem 1º contato`, cor }
}

// ── Mensagens prontas de WhatsApp ───────────────────────────────────────
const MENSAGENS: { titulo: string; etapas: string[] | null; texto: string }[] = [
  {
    titulo: 'Primeiro contato',
    etapas: ['novo', 'novo_consumidor_final'],
    texto: 'Olá {nome}, tudo bem? Aqui é {vendedor}, da {empresa}. Recebi seu contato e já posso te ajudar. O que você está procurando?',
  },
  { titulo: 'Retomar contato', etapas: ['abordagem'], texto: 'Oi {nome}, tudo bem? Passando para saber se conseguiu ver minha mensagem. Posso te mandar um orçamento?' },
  { titulo: 'Montar orçamento', etapas: ['qualificado'], texto: '{nome}, já separei as informações do que você precisa. Quer que eu monte o orçamento hoje?' },
  {
    titulo: 'Cobrar retorno do orçamento',
    etapas: ['em_negociacao'],
    texto: 'Oi {nome}! Conseguiu avaliar o orçamento? Se precisar, consigo ver uma condição de pagamento ou prazo melhor.',
  },
  { titulo: 'Agradecer a compra', etapas: ['ganho'], texto: 'Obrigado pela compra, {nome}! Qualquer coisa que precisar é só me chamar aqui.' },
  { titulo: 'Ainda tem interesse?', etapas: null, texto: 'Oi {nome}, tudo certo? Ainda tem interesse? Fico à disposição para te ajudar.' },
]

function preencher(texto: string, lead: LeadKanban, vendedor: string, empresa: string) {
  const primeiro = (s: string) => s.trim().split(/\s+/)[0] ?? ''
  return texto.replace('{nome}', primeiro(lead.name)).replace('{vendedor}', primeiro(vendedor) || 'a equipe').replace('{empresa}', empresa || 'nossa empresa')
}

export function MensagensProntas({ lead, vendedor, empresa }: { lead: LeadKanban; vendedor: string; empresa: string }) {
  const [aberto, setAberto] = useState(false)
  const telefone = leadTelefoneCompleto(lead.ddd, lead.phone).replace(/\D/g, '')
  if (!telefone) return null
  const daEtapa = MENSAGENS.filter((m) => !m.etapas || m.etapas.includes(lead.status))
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md px-2 py-1 transition-colors"
        title="Mandar uma mensagem pronta no WhatsApp"
      >
        <MessageCircle size={12} /> Mensagem pronta
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute left-0 bottom-full mb-1 w-72 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/50 z-50 p-2 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dark-500 px-2 pt-1">Abre o WhatsApp com o texto pronto — você ainda pode editar</p>
            {daEtapa.map((m) => {
              const texto = preencher(m.texto, lead, vendedor, empresa)
              return (
                <a
                  key={m.titulo}
                  href={`https://wa.me/55${telefone}?text=${encodeURIComponent(texto)}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setAberto(false)}
                  className="block rounded-lg px-2 py-1.5 hover:bg-dark-700 transition-colors"
                >
                  <span className="block text-xs font-semibold text-dark-100">{m.titulo}</span>
                  <span className="block text-[11px] text-dark-400 line-clamp-2">{texto}</span>
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Ranking da semana ───────────────────────────────────────────────────
export function RankingSemana({ leads }: { leads: LeadKanban[] }) {
  const seteDias = Date.now() - 7 * 86400000
  const porVendedor = new Map<string, { ganhos: number; valor: number; andamento: number; atrasados: number }>()
  for (const l of leads) {
    const nome = l.vendor?.name
    if (!nome) continue
    const v = porVendedor.get(nome) ?? { ganhos: 0, valor: 0, andamento: 0, atrasados: 0 }
    if (l.status === 'ganho' && l.statusChangedAt && paraData(l.statusChangedAt).getTime() >= seteDias) {
      v.ganhos++
      v.valor += l.finalOrderValue ?? 0
    }
    if (!isLeadTerminalStatus(l.status)) v.andamento++
    if (urgenciaLead(l)?.atrasado) v.atrasados++
    porVendedor.set(nome, v)
  }
  const lista = [...porVendedor.entries()].filter(([, v]) => v.ganhos > 0 || v.andamento > 0).sort((a, b) => b[1].ganhos - a[1].ganhos || b[1].valor - a[1].valor || a[1].atrasados - b[1].atrasados).slice(0, 8)
  if (!lista.length) return null
  const medalha = ['🥇', '🥈', '🥉']
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-gold-400" />
        <h2 className="text-sm font-semibold text-dark-50">Ranking da semana</h2>
        <span className="text-xs text-dark-500">leads ganhos nos últimos 7 dias · atrasados = contatos vencidos agora</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {lista.map(([nome, v], i) => (
          <div key={nome} className="shrink-0 w-44 rounded-xl bg-dark-900 border border-dark-700 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <AvatarIniciais nome={nome} tamanho={26} />
              <span className="text-[13px] font-semibold text-dark-100 truncate flex-1">{nome.split(' ')[0]}</span>
              <span className="text-base">{v.ganhos > 0 ? (medalha[i] ?? '') : ''}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className="text-xl font-bold text-emerald-400 tabular-nums">{v.ganhos}</span>
              <span className="text-[11px] text-dark-400">{v.ganhos === 1 ? 'ganho' : 'ganhos'}</span>
              {v.valor > 0 && <span className="text-[11px] text-dark-300 ml-auto">{formatarMoeda(v.valor, { casas: 0 })}</span>}
            </div>
            <p className="text-[11px] text-dark-500 mt-0.5">
              {v.andamento} em andamento · <span className={v.atrasados ? 'text-red-400 font-semibold' : ''}>{v.atrasados} atrasados</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Modo lista ──────────────────────────────────────────────────────────
type Coluna = 'nome' | 'etapa' | 'vendedor' | 'temperatura' | 'proximo' | 'recebido' | 'origem'

function origemDe(l: LeadKanban) {
  return l.source === 'meta_ads_lead' ? 'Meta Ads' : l.fromSite ? 'Site' : 'Outros'
}

export function TabelaLeads({ leads, mostrarVendedor, aoAbrir }: { leads: LeadKanban[]; mostrarVendedor: boolean; aoAbrir: (id: number) => void }) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'proximo', desc: false })
  const pesoTemp = { quente: 3, morno: 2, frio: 1 }
  const valor = (l: LeadKanban, c: Coluna): string | number => {
    switch (c) {
      case 'nome':
        return l.name.toLowerCase()
      case 'etapa':
        return Object.keys(COR_ETAPA_LEAD).indexOf(l.status)
      case 'vendedor':
        return l.vendor?.name ?? ''
      case 'temperatura': {
        const t = temperaturaLead(l)
        return t ? pesoTemp[t.nivel] : 0
      }
      case 'proximo':
        return l.nextContactAt ?? '9999'
      case 'recebido':
        return l.createdAt
      case 'origem':
        return origemDe(l)
    }
  }
  const ordenados = [...leads].sort((a, b) => {
    const va = valor(a, ordem.col)
    const vb = valor(b, ordem.col)
    const r = va < vb ? -1 : va > vb ? 1 : 0
    return ordem.desc ? -r : r
  })

  function exportar() {
    const linhas = [['Lead', 'Empresa', 'Telefone', 'E-mail', 'Etapa', 'Vendedor', 'Temperatura', 'Próximo contato', 'Recebido em', 'Origem']]
    for (const l of ordenados) {
      const t = temperaturaLead(l)
      linhas.push([
        l.name,
        l.company ?? '',
        leadTelefoneFormatado(l.ddd, l.phone),
        l.email ?? '',
        LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS] ?? l.status,
        l.vendor?.name ?? '',
        t ? TEMPERATURA_VISUAL[t.nivel].rotulo : '',
        l.nextContactAt?.slice(0, 16).replace('T', ' ') ?? '',
        l.createdAt.slice(0, 10),
        origemDe(l),
      ])
    }
    const csv = '﻿' + linhas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const Th = ({ col, children, className = '' }: { col: Coluna; children: ReactNode; className?: string }) => (
    <th className={`text-left font-medium py-2 px-3 ${className}`}>
      <button type="button" onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : false }))} className="inline-flex items-center gap-1 hover:text-dark-100">
        {children}
        {ordem.col === col && <span>{ordem.desc ? '↓' : '↑'}</span>}
      </button>
    </th>
  )

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-dark-700">
        <p className="text-sm text-dark-300">
          <span className="font-semibold text-dark-50">{leads.length}</span> leads · clique no título da coluna para ordenar
        </p>
        <button type="button" onClick={exportar} className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300">
          <Download size={14} /> Baixar planilha (Excel)
        </button>
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 bg-dark-900/60 sticky top-0">
            <tr>
              <Th col="nome">Lead</Th>
              <Th col="etapa">Etapa</Th>
              {mostrarVendedor && <Th col="vendedor">Vendedor</Th>}
              <Th col="temperatura">Temperatura</Th>
              <Th col="proximo">Próximo contato</Th>
              <Th col="recebido" className="hidden md:table-cell">
                Recebido
              </Th>
              <Th col="origem" className="hidden md:table-cell">
                Origem
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {ordenados.map((l) => {
              const t = temperaturaLead(l)
              const u = urgenciaLead(l)
              const cor = COR_ETAPA_LEAD[l.status] ?? '#94a3b8'
              return (
                <tr key={l.id} onClick={() => aoAbrir(l.id)} className="cursor-pointer hover:bg-dark-700/40 text-dark-200">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <AvatarIniciais nome={l.company || l.name} tamanho={26} />
                      <div className="min-w-0">
                        <p className="text-dark-100 truncate max-w-56">{l.name}</p>
                        {l.company && <p className="text-[11px] text-dark-500 truncate max-w-56">{l.company}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[11px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap" style={{ color: cor, background: `${cor}1f` }}>
                      {LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS] ?? l.status}
                    </span>
                  </td>
                  {mostrarVendedor && <td className="py-2 px-3 text-xs text-dark-400 whitespace-nowrap">{l.vendor?.name ?? '—'}</td>}
                  <td className="py-2 px-3">{t ? <SeloTemperatura t={t} /> : <span className="text-dark-600">—</span>}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {l.nextContactAt ? (
                      <span className={`text-xs ${u?.atrasado ? 'text-red-400 font-semibold' : u?.label === 'HOJE' ? 'text-orange-400 font-semibold' : 'text-dark-300'}`}>
                        {u?.label ? `${u.label} · ` : ''}
                        {timeAgo(l.nextContactAt)}
                      </span>
                    ) : (
                      <span className="text-dark-600 text-xs">sem data</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-dark-400 hidden md:table-cell whitespace-nowrap">há {formatElapsed(paraData(l.createdAt))}</td>
                  <td className="py-2 px-3 text-xs text-dark-400 hidden md:table-cell">{origemDe(l)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!leads.length && <p className="text-sm text-dark-500 text-center py-8">Nenhum lead com esses filtros.</p>}
      </div>
    </div>
  )
}

// ── Novidades (o que foi feito) ─────────────────────────────────────────
export const NOVIDADES: { emoji: string; titulo: string; texto: string }[] = [
  { emoji: '🎯', titulo: 'Meu dia', texto: 'Um clique mostra só o que precisa de você hoje: atrasados, contatos de hoje, novos e esquecidos.' },
  { emoji: '✋', titulo: 'Arrastar o card', texto: 'Arraste um card para outra coluna para mudar a etapa. Abre a janelinha de sempre, pedindo só o que aquela etapa exige.' },
  { emoji: '⏱️', titulo: 'Relógio do Novo', texto: 'Lead em "Novo" sem nenhum contato mostra há quanto tempo está esperando: verde até 1h, amarelo até 4h, vermelho depois.' },
  { emoji: '🔥', titulo: 'Quente, morno ou frio', texto: 'Cada lead em andamento ganha uma nota automática. Passe o mouse no selo para ver o porquê.' },
  { emoji: '⚡', titulo: 'Botões rápidos', texto: '"Registrar contato" e "Mensagem pronta" direto no card, sem precisar abrir o lead.' },
  { emoji: '💬', titulo: 'Mensagens prontas', texto: 'Textos de WhatsApp para cada etapa, já com o nome do cliente. Abre o WhatsApp para você revisar antes de enviar.' },
  { emoji: '🏆', titulo: 'Ranking da semana', texto: 'Quem ganhou mais leads nos últimos 7 dias e quantos contatos atrasados cada um tem agora.' },
  { emoji: '💰', titulo: 'Valor em jogo', texto: 'No topo de "Em Negociação" aparece a soma dos orçamentos; em "Ganho", a soma das vendas.' },
  { emoji: '📋', titulo: 'Modo lista', texto: 'Troque o quadro por uma tabela que ordena por qualquer coluna e baixa em planilha.' },
]

// Ranking só aparece pra quem vê a equipe toda (admin/gestor).
export function NovidadesLeads({ aoFechar, comRanking }: { aoFechar: () => void; comRanking: boolean }) {
  return (
    <div className="relative rounded-2xl border border-gold-500/30 bg-gradient-to-br from-gold-500/10 to-transparent p-4 mb-3">
      <button type="button" onClick={aoFechar} className="absolute right-3 top-3 text-dark-400 hover:text-dark-100" title="Fechar (dá para rever em Legenda)">
        <X size={16} />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-gold-400" />
        <h2 className="text-sm font-semibold text-dark-50">O que tem de novo neste Kanban</h2>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2.5">
        {NOVIDADES.filter((n) => comRanking || n.titulo !== 'Ranking da semana').map((n) => (
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

// ── Legenda ─────────────────────────────────────────────────────────────
function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-dark-500 font-semibold mb-1.5">{titulo}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Item({ marca, children }: { marca: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-dark-300">
      <span className="shrink-0 w-16 flex justify-center">{marca}</span>
      <span>{children}</span>
    </div>
  )
}

function Pilula({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 whitespace-nowrap" style={{ color: cor, background: `${cor}22` }}>
      {children}
    </span>
  )
}

export function LegendaLeads({ aoRever }: { aoRever?: () => void }) {
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
            <Bloco titulo="Cor das etapas (topo da coluna e faixa do card)">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COR_ETAPA_LEAD).map(([s, cor]) => (
                  <Pilula key={s} cor={cor}>
                    {LEAD_STATUS_LABELS[s as keyof typeof LEAD_STATUS_LABELS]}
                  </Pilula>
                ))}
              </div>
            </Bloco>
            <Bloco titulo="Topo da coluna">
              <Item marca={<Pilula cor="#3987e5">42</Pilula>}>Quantos leads estão nessa etapa.</Item>
              <Item marca={<Pilula cor="#e5534b">5 atrasados</Pilula>}>Quantos dessa etapa estão com o contato vencido.</Item>
              <Item marca={<span className="text-emerald-400 font-semibold">R$</span>}>Valor em jogo: soma dos orçamentos (Em Negociação) ou das vendas (Ganho).</Item>
              <Item marca={<span className="text-dark-400">tira fina</span>}>Coluna recolhida (Perdido, Desqualificado…). Clique para abrir.</Item>
            </Bloco>
            <Bloco titulo="Temperatura do lead (nota automática)">
              <Item marca={<SeloTemperatura t={{ nivel: 'quente', pontos: 4, motivos: [] }} />}>4 pontos ou mais: grande chance, priorize.</Item>
              <Item marca={<SeloTemperatura t={{ nivel: 'morno', pontos: 2, motivos: [] }} />}>2 ou 3 pontos.</Item>
              <Item marca={<SeloTemperatura t={{ nivel: 'frio', pontos: 0, motivos: [] }} />}>1 ponto ou menos.</Item>
              <p className="text-dark-500">
                Ganha ponto: veio de anúncio/site (+1), mandou mensagem/foto/áudio (+1), chegou há até 2 dias (+2) ou 7 dias (+1), está em Qualificado/Em Negociação (+2) ou
                Abordagem (+1). Perde: 🔴 Risco (−2), 🟡 Atenção (−1), esquecido (−2), contato atrasado (−1). Passe o mouse no selo para ver a conta.
              </p>
            </Bloco>
            <Bloco titulo="Avisos no card">
              <Item marca={<Pilula cor="#22a861">⏱ 40min</Pilula>}>Relógio do Novo: tempo sem o 1º contato. Verde até 1h, amarelo até 4h, vermelho depois.</Item>
              <Item marca={<Pilula cor="#38bdf8">❄ esquecido</Pilula>}>Sem próximo contato marcado e parado há {DIAS_ESFRIANDO}+ dias.</Item>
              <Item marca={<Pilula cor="#e5534b">ATRASADO</Pilula>}>O próximo contato era para um dia que já passou.</Item>
              <Item marca={<Pilula cor="#f97316">HOJE</Pilula>}>Próximo contato é hoje.</Item>
              <Item marca={<Pilula cor="#eab308">AMANHÃ</Pilula>}>Próximo contato é amanhã.</Item>
              <Item marca={<Pilula cor="#e5534b">borda vermelha</Pilula>}>Lead marcado como 🔴 Risco (amarela = 🟡 Atenção).</Item>
              <Item marca={<Pilula cor="#eab308">Anexo</Pilula>}>Anexo obrigatório pendente.</Item>
              <Item marca={<Pilula cor="#22d3ee">↻ Recebeu</Pilula>}>Lead que veio de outro vendedor por rodízio ou transferência.</Item>
              <Item marca={<Pilula cor="#a855f7">📱 Meta Ads</Pilula>}>Veio dos anúncios do Facebook/Instagram (🌐 = veio do site).</Item>
            </Bloco>
            <Bloco titulo="Ordem dos cards">
              <p className="text-dark-300">Dentro de cada coluna: atrasados primeiro, depois hoje, amanhã e o resto (mais recentes em cima).</p>
            </Bloco>
            <Bloco titulo="Botões do card">
              <Item marca={<Pilula cor="#e8a33a">📝 Registrar</Pilula>}>Registra ligação/WhatsApp/e-mail e já marca o próximo contato.</Item>
              <Item marca={<Pilula cor="#22a861">💬 Mensagem</Pilula>}>Escolhe um texto pronto e abre o WhatsApp com ele.</Item>
              <Item marca={<span className="text-dark-400">arrastar</span>}>Segure o card e solte em outra coluna para mudar a etapa.</Item>
            </Bloco>
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
