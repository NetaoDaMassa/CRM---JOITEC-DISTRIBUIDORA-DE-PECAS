import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BadgePercent, HandCoins, BarChart3, Plus, Paperclip, History, Search, X, Wallet, ArrowRight, Trash2, FileText, Receipt, RotateCcw } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../../lib/trpc'
import { Input, Textarea } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ComoUsar from '../../components/ui/ComoUsar'
import {
  ETAPAS_CREDITO,
  ETAPAS_PAGAMENTO,
  ETAPAS_PAGAS,
  brl,
  corEtapaPagamento,
  dataBr,
  enviarAnexo,
  etapaCredito,
  etapasDoTipo,
  lerValor,
  rotuloEtapaPagamento,
} from '../../lib/revendaFinanceiroShared'

// Créditos Odin + Pagamentos Odin (Financeiro) — pedido do João, 2026-11-26.
// Créditos: revenda atendeu em garantia pela Odin → pede o valor como crédito
// pra abater em compras futuras (análise → aprovação, igual a Garantia).
// Pagamentos: o que a Odin paga às revendas — comissão de venda (nasce
// sozinha do Pedido) e serviço de garantia pago em dinheiro.

type Out = inferRouterOutputs<AppRouter>['revendaFinanceiro']
type Contexto = Out['contexto']
type Credito = Out['listarCreditos']['creditos'][number]
type Movimento = Out['listarCreditos']['movimentos'][number]
type Pagamento = Out['listarPagamentos'][number]
type Aba = 'creditos' | 'pagamentos' | 'indicadores'

interface Filtros {
  revendaId: string
  tipo: string
  pedido: string
  de: string
  ate: string
  responsavelId: string
  etapa: string
  busca: string
}
const FILTROS_VAZIOS: Filtros = { revendaId: '', tipo: '', pedido: '', de: '', ate: '', responsavelId: '', etapa: '', busca: '' }

function noPeriodo(data: string | null | undefined, f: Filtros) {
  if (!f.de && !f.ate) return true
  if (!data) return false
  const d = data.slice(0, 10)
  return (!f.de || d >= f.de) && (!f.ate || d <= f.ate)
}

function contem(txt: (string | null | undefined)[], busca: string) {
  if (!busca.trim()) return true
  const b = busca.trim().toLowerCase()
  return txt.some((t) => t?.toLowerCase().includes(b))
}

export default function RevendasFinanceiroOdin({ abaInicial }: { abaInicial: Aba }) {
  const navigate = useNavigate()
  const { data: ctx, isLoading, error } = trpc.revendaFinanceiro.contexto.useQuery()
  const [aba, setAba] = useState<Aba>(abaInicial)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS)

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  if (error || !ctx) return <p className="text-red-400 text-sm">{error?.message ?? 'Sem acesso'}</p>

  const abas: { id: Aba; label: string; icon: typeof Wallet; pode: boolean; rota: string }[] = [
    { id: 'creditos', label: 'Créditos Odin', icon: BadgePercent, pode: ctx.podeCreditos, rota: '/admin/creditos-odin' },
    { id: 'pagamentos', label: 'Pagamentos Odin', icon: HandCoins, pode: ctx.podePagamentos, rota: '/admin/pagamentos-odin' },
    { id: 'indicadores', label: 'Indicadores', icon: BarChart3, pode: true, rota: '' },
  ]
  const abaAtual = abas.find((a) => a.id === aba && a.pode) ? aba : abas.find((a) => a.pode)!.id

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <Wallet size={20} className="text-emerald-300" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-dark-100">Revendas Odin — Créditos e Pagamentos</h1>
          <p className="text-sm text-dark-400">Créditos de garantia pra abater em compras, comissões e serviços a pagar às revendas.</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {abas
          .filter((a) => a.pode)
          .map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setAba(a.id)
                setFiltros((f) => ({ ...f, etapa: '', tipo: '' }))
                if (a.rota) navigate(a.rota, { replace: true })
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${abaAtual === a.id ? 'border-gold-500 text-gold-300' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
            >
              <a.icon size={16} /> {a.label}
            </button>
          ))}
      </div>

      <BarraFiltros ctx={ctx} aba={abaAtual} filtros={filtros} setFiltros={setFiltros} />

      {abaAtual === 'creditos' && <AbaCreditos ctx={ctx} filtros={filtros} />}
      {abaAtual === 'pagamentos' && <AbaPagamentos ctx={ctx} filtros={filtros} />}
      {abaAtual === 'indicadores' && <AbaIndicadores ctx={ctx} filtros={filtros} />}
    </div>
  )
}

// ── Filtros ─────────────────────────────────────────────────────────────────
function BarraFiltros({ ctx, aba, filtros, setFiltros }: { ctx: Contexto; aba: Aba; filtros: Filtros; setFiltros: (f: Filtros | ((f: Filtros) => Filtros)) => void }) {
  const set = (k: keyof Filtros) => (e: { target: { value: string } }) => setFiltros((f) => ({ ...f, [k]: e.target.value }))
  const tipos =
    aba === 'pagamentos'
      ? [
          { value: 'comissao', label: 'Comissões' },
          { value: 'garantia', label: 'Garantias (pagar)' },
          { value: 'automatico', label: 'Gerados pelo CRM' },
          { value: 'manual', label: 'Cadastrados à mão' },
        ]
      : aba === 'creditos'
        ? [
            { value: 'credito', label: 'Solicitações de crédito' },
            { value: 'com_saldo', label: 'Créditos com saldo' },
          ]
        : [
            { value: 'credito', label: 'Créditos de garantia' },
            { value: 'comissao', label: 'Comissões' },
            { value: 'garantia', label: 'Garantias (pagar)' },
          ]
  const etapas =
    aba === 'pagamentos'
      ? [...ETAPAS_PAGAMENTO.map((e) => ({ value: e.value, label: e.label })), { value: 'cancelado', label: 'Cancelados' }]
      : aba === 'creditos'
        ? [...ETAPAS_CREDITO.map((e) => ({ value: e.value, label: e.label })), { value: 'cancelado', label: 'Cancelados' }]
        : []
  const algum = Object.values(filtros).some(Boolean)
  return (
    <div className="bg-dark-800/60 border border-dark-700 rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 items-end">
      <div className="col-span-2 relative">
        <Search size={14} className="absolute left-3 top-[34px] text-dark-500" />
        <Input label="Buscar" placeholder="Cliente, equipamento, serviço…" value={filtros.busca} onChange={set('busca')} className="pl-8" />
      </div>
      <Select label="Revenda" value={filtros.revendaId} onChange={set('revendaId')} placeholder="Todas" options={ctx.revendas.map((r) => ({ value: r.id, label: r.nome }))} />
      <Select label="Tipo de registro" value={filtros.tipo} onChange={set('tipo')} placeholder="Todos" options={tipos} />
      <Input label="Nº do pedido" value={filtros.pedido} onChange={set('pedido')} />
      <Input label="De" type="date" value={filtros.de} onChange={set('de')} />
      <Input label="Até" type="date" value={filtros.ate} onChange={set('ate')} />
      <Select label="Responsável" value={filtros.responsavelId} onChange={set('responsavelId')} placeholder="Todos" options={ctx.responsaveis.map((u) => ({ value: u.id, label: u.name }))} />
      {etapas.length > 0 && <Select label="Etapa atual" value={filtros.etapa} onChange={set('etapa')} placeholder="Todas" options={etapas} />}
      {algum && (
        <button onClick={() => setFiltros(FILTROS_VAZIOS)} className="text-xs text-dark-400 hover:text-dark-100 flex items-center gap-1 pb-2.5">
          <X size={12} /> Limpar filtros
        </button>
      )}
    </div>
  )
}

function filtrarCreditos(lista: Credito[], f: Filtros) {
  return lista.filter((c) => {
    if (f.revendaId && c.revendaId !== Number(f.revendaId)) return false
    if (f.responsavelId && c.responsavelId !== Number(f.responsavelId)) return false
    if (f.tipo === 'com_saldo' && !(c.stage === 'aprovado' && c.status === 'ativo' && (c.valorAprovado ?? 0) - c.utilizado > 0.005)) return false
    if (f.tipo && !['credito', 'com_saldo'].includes(f.tipo)) return false
    if (f.etapa === 'cancelado' ? c.status !== 'cancelado' : f.etapa && (c.stage !== f.etapa || c.status !== 'ativo')) return false
    if (f.pedido) return false // crédito não tem nº de pedido (o abatimento tem)
    if (!noPeriodo(c.createdAt, f)) return false
    return contem([c.clienteNome, c.equipamento, c.numeroSerie, c.servicoExecutado, c.revendaNome, String(c.id)], f.busca)
  })
}

function filtrarMovimentos(lista: Movimento[], f: Filtros) {
  return lista.filter((m) => {
    if (f.revendaId && m.revendaId !== Number(f.revendaId)) return false
    if (f.pedido && !m.numeroPedido?.toLowerCase().includes(f.pedido.toLowerCase())) return false
    if (!noPeriodo(m.data, f)) return false
    return contem([m.descricao, m.numeroPedido, m.revendaNome], f.busca)
  })
}

function filtrarPagamentos(lista: Pagamento[], f: Filtros) {
  return lista.filter((p) => {
    if (f.revendaId && p.revendaId !== Number(f.revendaId)) return false
    if (f.responsavelId && p.responsavelId !== Number(f.responsavelId)) return false
    if (f.tipo === 'comissao' || f.tipo === 'garantia') {
      if (p.tipo !== f.tipo) return false
    } else if (f.tipo === 'automatico' || f.tipo === 'manual') {
      if (p.origem !== f.tipo) return false
    } else if (f.tipo) return false
    if (f.etapa === 'cancelado' ? p.status !== 'cancelado' : f.etapa && (p.stage !== f.etapa || p.status !== 'ativo')) return false
    if (f.pedido && !(p.numeroPedido?.toLowerCase().includes(f.pedido.toLowerCase()) || String(p.ordemId ?? '') === f.pedido.replace('#', ''))) return false
    if (!noPeriodo(p.createdAt, f)) return false
    return contem([p.clienteNome, p.equipamento, p.descricao, p.revendaNome, p.numeroPedido, String(p.id)], f.busca)
  })
}

// ── Indicadores ─────────────────────────────────────────────────────────────
function AbaIndicadores({ ctx, filtros }: { ctx: Contexto; filtros: Filtros }) {
  const cred = trpc.revendaFinanceiro.listarCreditos.useQuery(undefined, { enabled: ctx.podeCreditos })
  const pag = trpc.revendaFinanceiro.listarPagamentos.useQuery(undefined, { enabled: ctx.podePagamentos })
  const f = filtros
  const mostraCred = ctx.podeCreditos && (!f.tipo || f.tipo === 'credito')
  const mostraPag = ctx.podePagamentos && f.tipo !== 'credito'
  const porRevendaOk = (id: number | null) => !f.revendaId || id === Number(f.revendaId)
  const porResp = (id: number | null) => !f.responsavelId || id === Number(f.responsavelId)

  const saldos = (cred.data?.saldos ?? []).filter((s) => porRevendaOk(s.revendaId))
  const creditosFiltrados = (cred.data?.creditos ?? []).filter((c) => c.status === 'ativo' && porRevendaOk(c.revendaId) && porResp(c.responsavelId) && contem([c.clienteNome, c.equipamento, c.servicoExecutado], f.busca))
  const emAnalise = creditosFiltrados.filter((c) => c.stage === 'analise' || c.stage === 'aprovacao')
  const abatidoPeriodo = (cred.data?.movimentos ?? []).filter((m) => m.tipo === 'abatimento' && porRevendaOk(m.revendaId) && noPeriodo(m.data, f) && (!f.pedido || m.numeroPedido?.includes(f.pedido)))
  const pags = (pag.data ?? []).filter(
    (p) =>
      p.status === 'ativo' &&
      porRevendaOk(p.revendaId) &&
      porResp(p.responsavelId) &&
      (f.tipo === 'comissao' || f.tipo === 'garantia' ? p.tipo === f.tipo : true) &&
      (!f.pedido || p.numeroPedido?.includes(f.pedido) || String(p.ordemId ?? '') === f.pedido) &&
      contem([p.clienteNome, p.equipamento, p.descricao, p.revendaNome], f.busca)
  )
  const pendentes = pags.filter((p) => !ETAPAS_PAGAS.includes(p.stage))
  const comissoesPend = pendentes.filter((p) => p.tipo === 'comissao')
  const garantiasPend = pendentes.filter((p) => p.tipo === 'garantia')
  const agendados = pags.filter((p) => p.stage === 'pagamento_agendado')
  const pagos = pags.filter((p) => ETAPAS_PAGAS.includes(p.stage) && noPeriodo(p.dataPagamento, f))
  const soma = <T,>(xs: T[], fn: (x: T) => number) => xs.reduce((a, x) => a + fn(x), 0)
  const periodo = f.de || f.ate ? `${f.de ? dataBr(f.de) : '…'} a ${f.ate ? dataBr(f.ate) : '…'}` : 'todo o período'

  const cards = [
    mostraCred && { label: 'Créditos de garantia em aberto', valor: soma(saldos, (s) => s.saldo), sub: `${saldos.filter((s) => s.saldo > 0.005).length} revenda(s) com saldo pra abater`, cor: 'text-emerald-300' },
    mostraCred && { label: 'Créditos em análise / aprovação', valor: soma(emAnalise, (c) => c.valorSolicitado), sub: `${emAnalise.length} solicitação(ões)`, cor: 'text-sky-300' },
    mostraPag && (!f.tipo || f.tipo === 'comissao') && { label: 'Comissões pendentes', valor: soma(comissoesPend, (p) => p.valor), sub: `${comissoesPend.length} a pagar`, cor: 'text-amber-300' },
    mostraPag && (!f.tipo || f.tipo === 'garantia') && { label: 'Garantias a pagar pendentes', valor: soma(garantiasPend, (p) => p.valor), sub: `${garantiasPend.length} a pagar`, cor: 'text-orange-300' },
    mostraPag && { label: 'Pagamentos agendados', valor: soma(agendados, (p) => p.valor), sub: `${agendados.length} agendado(s)`, cor: 'text-violet-300' },
    mostraPag && { label: 'Valores pagos', valor: soma(pagos, (p) => p.valor), sub: `${pagos.length} pagamento(s) — ${periodo}`, cor: 'text-green-300' },
    mostraCred && { label: 'Créditos abatidos em compras', valor: soma(abatidoPeriodo, (m) => m.valor), sub: `${abatidoPeriodo.length} abatimento(s) — ${periodo}`, cor: 'text-teal-300' },
  ].filter(Boolean) as { label: string; valor: number; sub: string; cor: string }[]

  // Por revenda
  const linhas = new Map<string, { nome: string; saldo: number; aprovado: number; utilizado: number; aPagar: number; pago: number }>()
  const linha = (nome: string) => {
    let l = linhas.get(nome)
    if (!l) linhas.set(nome, (l = { nome, saldo: 0, aprovado: 0, utilizado: 0, aPagar: 0, pago: 0 }))
    return l
  }
  if (mostraCred) for (const s of saldos) Object.assign(linha(ctx.revendas.find((r) => r.id === s.revendaId)?.nome ?? `#${s.revendaId}`), { saldo: s.saldo, aprovado: s.aprovado, utilizado: s.utilizado })
  if (mostraPag) {
    for (const p of pendentes) linha(p.revendaNome).aPagar += p.valor
    for (const p of pagos) linha(p.revendaNome).pago += p.valor
  }
  const tabela = [...linhas.values()].filter((l) => l.saldo || l.aprovado || l.aPagar || l.pago).sort((a, b) => b.saldo + b.aPagar - (a.saldo + a.aPagar))

  if (cred.isLoading || pag.isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-dark-800 border border-dark-700 rounded-xl p-4">
            <p className="text-xs text-dark-400">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.cor}`}>{brl(c.valor)}</p>
            <p className="text-xs text-dark-500 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>
      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-x-auto">
        <p className="px-4 pt-3 pb-2 text-sm font-semibold text-dark-200">Por revenda</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 border-y border-dark-700">
            <tr>
              <th className="text-left px-4 py-2">Revenda</th>
              {mostraCred && <th className="text-right px-3 py-2">Crédito liberado</th>}
              {mostraCred && <th className="text-right px-3 py-2">Já abatido</th>}
              {mostraCred && <th className="text-right px-3 py-2">Saldo de crédito</th>}
              {mostraPag && <th className="text-right px-3 py-2">A pagar (pendente)</th>}
              {mostraPag && <th className="text-right px-4 py-2">Pago ({periodo})</th>}
            </tr>
          </thead>
          <tbody>
            {tabela.map((l) => (
              <tr key={l.nome} className="border-b border-dark-700/60">
                <td className="px-4 py-2 text-dark-100">{l.nome}</td>
                {mostraCred && <td className="text-right px-3 py-2 text-dark-300">{brl(l.aprovado)}</td>}
                {mostraCred && <td className="text-right px-3 py-2 text-dark-300">{brl(l.utilizado)}</td>}
                {mostraCred && <td className="text-right px-3 py-2 font-semibold text-emerald-300">{brl(l.saldo)}</td>}
                {mostraPag && <td className="text-right px-3 py-2 text-amber-300">{brl(l.aPagar)}</td>}
                {mostraPag && <td className="text-right px-4 py-2 text-green-300">{brl(l.pago)}</td>}
              </tr>
            ))}
            {tabela.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-dark-500">Nada lançado ainda com esses filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Créditos ────────────────────────────────────────────────────────────────
function AbaCreditos({ ctx, filtros }: { ctx: Contexto; filtros: Filtros }) {
  const { data, isLoading } = trpc.revendaFinanceiro.listarCreditos.useQuery()
  const [sub, setSub] = useState<'solicitacoes' | 'movimentos'>('solicitacoes')
  const [novo, setNovo] = useState(false)
  const [abrir, setAbrir] = useState<number | null>(null)
  const [movimento, setMovimento] = useState<{ revendaId?: number; tipo: 'abatimento' | 'estorno' } | null>(null)
  const [extrato, setExtrato] = useState<number | null>(null)

  const creditos = useMemo(() => filtrarCreditos(data?.creditos ?? [], filtros), [data, filtros])
  const movimentos = useMemo(() => filtrarMovimentos(data?.movimentos ?? [], filtros), [data, filtros])
  const comSaldo = (data?.saldos ?? []).filter((s) => s.saldo > 0.005 && (!filtros.revendaId || s.revendaId === Number(filtros.revendaId)))
  const nomeRevenda = (id: number) => ctx.revendas.find((r) => r.id === id)?.nome ?? `#${id}`
  const selecionado = data?.creditos.find((c) => c.id === abrir) ?? null

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return (
    <div className="space-y-4">
      <ComoUsar
        chave="creditos_odin"
        passos={[
          <>A revenda fez um atendimento em garantia pela Odin? Clique em <b>Nova solicitação</b> e preencha revenda, cliente atendido, equipamento, serviço executado e o <b>valor solicitado</b>. Anexe o que a revenda mandou (orçamento, fotos, NF).</>,
          <>Na solicitação, escreva o <b>parecer da análise</b> e clique em <b>Enviar pra aprovação</b>.</>,
          <>Quem aprova escolhe: <b>Aprovar</b> (com o valor aprovado, que pode ser menor que o pedido), <b>Devolver pra análise</b> ou <b>Recusar</b> — sempre com observação.</>,
          <>Aprovado, o valor vira <b>saldo de crédito</b> da revenda. Quando ela usar numa compra, clique em <b>Lançar abatimento</b> com o nº do pedido — o saldo baixa sozinho.</>,
        ]}
        dicas={[<>Clique no saldo de uma revenda (cartões verdes) para ver o <b>extrato</b>: créditos liberados, abatimentos e estornos, com saldo linha a linha.</>, <>Compra cancelada depois do abatimento? Use <b>Estorno</b> (devolve o valor ao saldo) ou desfaça o abatimento na aba Abatimentos.</>]}
      />

      {comSaldo.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {comSaldo.map((s) => (
            <button key={s.revendaId} onClick={() => setExtrato(s.revendaId)} className="text-left bg-emerald-500/10 border border-emerald-500/30 hover:border-emerald-400/60 rounded-xl px-3 py-2">
              <p className="text-xs text-dark-300">{nomeRevenda(s.revendaId)}</p>
              <p className="text-base font-bold text-emerald-300">{brl(s.saldo)}</p>
              <p className="text-[11px] text-dark-500">saldo · ver extrato</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 bg-dark-800 rounded-lg p-1 border border-dark-700">
          {(
            [
              ['solicitacoes', `Solicitações (${creditos.length})`],
              ['movimentos', `Abatimentos e estornos (${movimentos.length})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setSub(id)} className={`px-3 py-1.5 text-sm rounded-md ${sub === id ? 'bg-dark-600 text-dark-100' : 'text-dark-400 hover:text-dark-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMovimento({ tipo: 'abatimento' })}>
            <Receipt size={16} className="mr-1" /> Lançar abatimento
          </Button>
          <Button onClick={() => setNovo(true)}>
            <Plus size={16} className="mr-1" /> Nova solicitação
          </Button>
        </div>
      </div>

      {sub === 'solicitacoes' ? (
        <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-dark-400 border-b border-dark-700">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Revenda</th>
                <th className="text-left px-3 py-2">Cliente / equipamento</th>
                <th className="text-left px-3 py-2">Serviço</th>
                <th className="text-right px-3 py-2">Solicitado</th>
                <th className="text-right px-3 py-2">Aprovado</th>
                <th className="text-right px-3 py-2">Saldo</th>
                <th className="text-left px-3 py-2">Etapa</th>
                <th className="text-left px-3 py-2">Responsável</th>
                <th className="text-left px-3 py-2">Data</th>
              </tr>
            </thead>
            <tbody>
              {creditos.map((c) => {
                const et = etapaCredito(c.stage)
                const saldo = c.stage === 'aprovado' && c.status === 'ativo' ? (c.valorAprovado ?? 0) - c.utilizado : null
                return (
                  <tr key={c.id} onClick={() => setAbrir(c.id)} className={`border-b border-dark-700/60 hover:bg-dark-700/40 cursor-pointer ${c.status === 'cancelado' ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 text-dark-400">{c.id}</td>
                    <td className="px-3 py-2 text-dark-100">{c.revendaNome}</td>
                    <td className="px-3 py-2">
                      <p className="text-dark-100">{c.clienteNome ?? '—'}</p>
                      <p className="text-xs text-dark-500">{[c.equipamento, c.numeroSerie && `série ${c.numeroSerie}`].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-dark-300 max-w-[260px] truncate" title={c.servicoExecutado}>
                      {c.servicoExecutado}
                      {c.anexos > 0 && <Paperclip size={12} className="inline ml-1 text-dark-500" />}
                    </td>
                    <td className="px-3 py-2 text-right text-dark-200">{brl(c.valorSolicitado)}</td>
                    <td className="px-3 py-2 text-right text-dark-200">{brl(c.valorAprovado)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-300">{saldo == null ? '—' : brl(saldo)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${c.status === 'cancelado' ? 'bg-dark-700 text-dark-400 border-dark-600' : et.cor}`}>{c.status === 'cancelado' ? 'Cancelado' : et.label}</span>
                    </td>
                    <td className="px-3 py-2 text-dark-400">{c.responsavelNome ?? '—'}</td>
                    <td className="px-3 py-2 text-dark-400">{dataBr(c.createdAt)}</td>
                  </tr>
                )
              })}
              {creditos.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-dark-500">Nenhuma solicitação de crédito com esses filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <TabelaMovimentos movimentos={movimentos} onEstorno={() => setMovimento({ tipo: 'estorno' })} />
      )}

      {novo && <ModalCredito ctx={ctx} onClose={() => setNovo(false)} />}
      {selecionado && <DetalheCredito ctx={ctx} credito={selecionado} onClose={() => setAbrir(null)} onExtrato={() => setExtrato(selecionado.revendaId)} />}
      {movimento && <ModalMovimento ctx={ctx} inicial={movimento} saldos={data?.saldos ?? []} onClose={() => setMovimento(null)} />}
      {extrato && <ModalExtrato revendaId={extrato} nome={nomeRevenda(extrato)} onClose={() => setExtrato(null)} onAbater={() => { setMovimento({ revendaId: extrato, tipo: 'abatimento' }); setExtrato(null) }} />}
    </div>
  )
}

function TabelaMovimentos({ movimentos, onEstorno }: { movimentos: Movimento[]; onEstorno: () => void }) {
  const utils = trpc.useUtils()
  const excluir = trpc.revendaFinanceiro.excluirMovimento.useMutation({
    onSuccess: () => { toast.success('Desfeito'); utils.revendaFinanceiro.listarCreditos.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={onEstorno} className="text-xs text-dark-400 hover:text-dark-100 flex items-center gap-1">
          <RotateCcw size={12} /> Lançar estorno (devolver crédito)
        </button>
      </div>
      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 border-b border-dark-700">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Revenda</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Pedido / NF</th>
              <th className="text-left px-3 py-2">Descrição</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-left px-3 py-2">Lançado por</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {movimentos.map((m) => (
              <tr key={m.id} className="border-b border-dark-700/60">
                <td className="px-3 py-2 text-dark-300">{dataBr(m.data)}</td>
                <td className="px-3 py-2 text-dark-100">{m.revendaNome}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${m.tipo === 'abatimento' ? 'bg-teal-500/15 text-teal-300 border-teal-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>{m.tipo === 'abatimento' ? 'Abatimento' : 'Estorno'}</span>
                </td>
                <td className="px-3 py-2 text-dark-300">{m.numeroPedido ?? '—'}</td>
                <td className="px-3 py-2 text-dark-400">{m.descricao ?? '—'}</td>
                <td className={`px-3 py-2 text-right font-semibold ${m.tipo === 'abatimento' ? 'text-teal-300' : 'text-amber-300'}`}>{m.tipo === 'abatimento' ? '−' : '+'} {brl(m.valor)}</td>
                <td className="px-3 py-2 text-dark-400">{m.criadoPorNome ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    title="Desfazer"
                    onClick={() => {
                      const motivo = window.prompt('Motivo para desfazer este lançamento:')
                      if (motivo && motivo.trim().length >= 3) excluir.mutate({ id: m.id, motivo })
                    }}
                    className="text-dark-500 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {movimentos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-dark-500">Nenhum abatimento ou estorno com esses filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Busca de cliente da Odin Compressores (ou nome livre, se não tem cadastro).
function CampoCliente({ clienteId, clienteNome, onChange }: { clienteId: number | null; clienteNome: string; onChange: (v: { clienteId: number | null; clienteNome: string }) => void }) {
  const [q, setQ] = useState('')
  const { data } = trpc.revendaFinanceiro.buscarClientes.useQuery({ q }, { enabled: q.trim().length >= 2 && !clienteId })
  if (clienteId)
    return (
      <div>
        <label className="text-sm text-dark-200 font-medium mb-1 block">Cliente atendido *</label>
        <div className="flex items-center justify-between bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm">
          <span className="text-dark-100">{clienteNome}</span>
          <button type="button" onClick={() => onChange({ clienteId: null, clienteNome: '' })} className="text-dark-500 hover:text-dark-200">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  return (
    <div className="relative">
      <Input
        label="Cliente atendido *"
        placeholder="Digite nome, código ou CNPJ…"
        value={q || clienteNome}
        onChange={(e) => {
          setQ(e.target.value)
          onChange({ clienteId: null, clienteNome: e.target.value })
        }}
      />
      {q.trim().length >= 2 && (data?.length ?? 0) > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {data!.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({ clienteId: c.id, clienteNome: c.razaoSocial })
                setQ('')
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-dark-700"
            >
              <span className="text-dark-100">{c.razaoSocial}</span>
              <span className="text-dark-500 text-xs ml-2">{[c.codigo, c.cidade].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          <p className="px-3 py-1.5 text-[11px] text-dark-500 border-t border-dark-700">Não achou? Deixe o nome digitado (cliente sem cadastro).</p>
        </div>
      )}
    </div>
  )
}

function CampoAnexosNovos({ anexos, setAnexos, comCategoria }: { anexos: (Awaited<ReturnType<typeof enviarAnexo>> & { categoria?: string })[]; setAnexos: (a: any[]) => void; comCategoria?: boolean }) {
  const [enviando, setEnviando] = useState(false)
  const [categoria, setCategoria] = useState<'nf' | 'comprovante' | 'outro'>('outro')
  return (
    <div>
      <label className="text-sm text-dark-200 font-medium mb-1 block">Anexos</label>
      <div className="space-y-1">
        {anexos.map((a, i) => (
          <div key={i} className="flex items-center justify-between text-xs bg-dark-900/60 rounded px-2 py-1">
            <span className="text-dark-200 truncate">{a.nomeOriginal}</span>
            <button type="button" onClick={() => setAnexos(anexos.filter((_, j) => j !== i))} className="text-dark-500 hover:text-red-400">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-center mt-1.5">
        {comCategoria && (
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as any)} className="bg-dark-800 border border-dark-600 rounded-lg px-2 py-1.5 text-xs text-dark-100">
            <option value="nf">Nota fiscal</option>
            <option value="comprovante">Comprovante de pagamento</option>
            <option value="outro">Outro</option>
          </select>
        )}
        <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
          <Paperclip size={12} /> {enviando ? 'Enviando...' : 'Anexar arquivo'}
          <input
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.xml"
            disabled={enviando}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setEnviando(true)
              try {
                const a = await enviarAnexo(file)
                setAnexos([...anexos, { ...a, categoria }])
              } catch (err: any) {
                toast.error(err.message)
              } finally {
                setEnviando(false)
              }
            }}
          />
        </label>
      </div>
    </div>
  )
}

function ModalCredito({ ctx, credito, onClose }: { ctx: Contexto; credito?: Credito; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [revendaId, setRevendaId] = useState(credito ? String(credito.revendaId) : '')
  const [cliente, setCliente] = useState({ clienteId: credito?.clienteId ?? null, clienteNome: credito?.clienteNome ?? '' })
  const [equipamento, setEquipamento] = useState(credito?.equipamento ?? '')
  const [numeroSerie, setNumeroSerie] = useState(credito?.numeroSerie ?? '')
  const [servico, setServico] = useState(credito?.servicoExecutado ?? '')
  const [dataAtendimento, setDataAtendimento] = useState(credito?.dataAtendimento ?? '')
  const [valor, setValor] = useState(credito ? String(credito.valorSolicitado).replace('.', ',') : '')
  const [garantiaId, setGarantiaId] = useState(credito?.garantiaId ? String(credito.garantiaId) : '')
  const [responsavelId, setResponsavelId] = useState(String(credito?.responsavelId ?? ctx.meuId))
  const [obs, setObs] = useState('')
  const [anexos, setAnexos] = useState<any[]>([])
  const { data: garantiasLista } = trpc.revendaFinanceiro.buscarGarantias.useQuery({ clienteId: cliente.clienteId })
  const ok = () => {
    utils.revendaFinanceiro.listarCreditos.invalidate()
    utils.revendaFinanceiro.historico.invalidate()
    onClose()
  }
  const criar = trpc.revendaFinanceiro.criarCredito.useMutation({ onSuccess: () => { toast.success('Solicitação registrada'); ok() }, onError: (e) => toast.error(e.message) })
  const editar = trpc.revendaFinanceiro.editarCredito.useMutation({ onSuccess: () => { toast.success('Salvo'); ok() }, onError: (e) => toast.error(e.message) })

  function salvar() {
    const v = lerValor(valor)
    if (!revendaId) return toast.error('Escolha a revenda')
    if (!cliente.clienteId && !cliente.clienteNome.trim()) return toast.error('Informe o cliente atendido')
    if (!v || Number.isNaN(v) || v <= 0) return toast.error('Informe o valor solicitado')
    const base = {
      revendaId: Number(revendaId),
      clienteId: cliente.clienteId,
      clienteNome: cliente.clienteNome,
      equipamento,
      numeroSerie,
      servicoExecutado: servico,
      dataAtendimento: dataAtendimento || null,
      garantiaId: garantiaId ? Number(garantiaId) : null,
      valorSolicitado: v,
      responsavelId: responsavelId ? Number(responsavelId) : null,
    }
    if (credito) editar.mutate({ id: credito.id, ...base })
    else criar.mutate({ ...base, observacao: obs, anexos })
  }

  return (
    <Modal open onClose={onClose} title={credito ? `Editar crédito #${credito.id}` : 'Nova solicitação de crédito'} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Revenda *" value={revendaId} onChange={(e) => setRevendaId(e.target.value)} placeholder="Escolha…" options={ctx.revendas.map((r) => ({ value: r.id, label: r.nome }))} />
          <CampoCliente clienteId={cliente.clienteId} clienteNome={cliente.clienteNome} onChange={setCliente} />
          <Input label="Equipamento" placeholder="Modelo do compressor" value={equipamento} onChange={(e) => setEquipamento(e.target.value)} />
          <Input label="Nº de série" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} />
          <Input label="Data do atendimento" type="date" value={dataAtendimento} onChange={(e) => setDataAtendimento(e.target.value)} />
          <Input label="Valor solicitado (R$) *" inputMode="decimal" placeholder="Ex.: 850,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <Textarea label="Serviço executado *" placeholder="O que a revenda fez no atendimento (peças trocadas, mão de obra, deslocamento…)" value={servico} onChange={(e) => setServico(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Processo de garantia (opcional)"
            value={garantiaId}
            onChange={(e) => setGarantiaId(e.target.value)}
            placeholder="Nenhum"
            options={(garantiasLista ?? []).map((g) => ({ value: g.id, label: `#${g.id} — ${g.clienteNome ?? ''}${g.modelo ? ` · ${g.modelo}` : ''}` }))}
          />
          <Select label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} options={ctx.responsaveis.map((u) => ({ value: u.id, label: u.name }))} />
        </div>
        {!credito && (
          <>
            <Textarea label="Observações (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
            <CampoAnexosNovos anexos={anexos} setAnexos={setAnexos} />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={criar.isPending || editar.isPending}>{credito ? 'Salvar' : 'Registrar solicitação'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function DetalheCredito({ ctx, credito: c, onClose, onExtrato }: { ctx: Contexto; credito: Credito; onClose: () => void; onExtrato: () => void }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [analise, setAnalise] = useState(c.analiseObservacao ?? '')
  const [valorAprovado, setValorAprovado] = useState(String(c.valorSolicitado).replace('.', ','))
  const [obsDecisao, setObsDecisao] = useState('')
  const refresh = () => {
    utils.revendaFinanceiro.listarCreditos.invalidate()
    utils.revendaFinanceiro.historico.invalidate({ tipo: 'credito', refId: c.id })
  }
  const salvarAnalise = trpc.revendaFinanceiro.salvarAnalise.useMutation({ onSuccess: (_, v) => { toast.success(v.enviarParaAprovacao ? 'Enviado pra aprovação' : 'Análise salva'); refresh() }, onError: (e) => toast.error(e.message) })
  const decidir = trpc.revendaFinanceiro.decidirCredito.useMutation({ onSuccess: () => { toast.success('Decisão registrada'); setObsDecisao(''); refresh() }, onError: (e) => toast.error(e.message) })
  const cancelar = trpc.revendaFinanceiro.cancelarCredito.useMutation({ onSuccess: () => { toast.success('Cancelado'); refresh() }, onError: (e) => toast.error(e.message) })
  const et = etapaCredito(c.stage)
  const ativo = c.status === 'ativo'
  const saldo = c.stage === 'aprovado' && ativo ? (c.valorAprovado ?? 0) - c.utilizado : null

  if (editando) return <ModalCredito ctx={ctx} credito={c} onClose={() => setEditando(false)} />
  return (
    <Modal open onClose={onClose} title={`Crédito #${c.id} — ${c.revendaNome}`} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs border ${ativo ? et.cor : 'bg-dark-700 text-dark-400 border-dark-600'}`}>{ativo ? et.label : `Cancelado: ${c.cancelMotivo ?? ''}`}</span>
          <span className="text-xs text-dark-500">Registrado por {c.criadoPorNome ?? '—'} em {dataBr(c.createdAt)} · Responsável: {c.responsavelNome ?? '—'}</span>
          <div className="flex-1" />
          {ativo && (c.stage === 'analise' || c.stage === 'aprovacao') && (
            <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>Editar dados</Button>
          )}
          <Button size="sm" variant="secondary" onClick={onExtrato}>Extrato da revenda</Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Cliente atendido" valor={c.clienteNome} />
          <Info label="Equipamento" valor={[c.equipamento, c.numeroSerie && `série ${c.numeroSerie}`].filter(Boolean).join(' · ')} />
          <Info label="Data do atendimento" valor={dataBr(c.dataAtendimento)} />
          <Info label="Garantia ligada" valor={c.garantiaId ? `#${c.garantiaId}` : null} />
          <Info label="Valor solicitado" valor={brl(c.valorSolicitado)} destaque />
          <Info label="Valor aprovado" valor={brl(c.valorAprovado)} destaque />
          <Info label="Já abatido" valor={c.stage === 'aprovado' ? brl(c.utilizado) : null} />
          <Info label="Saldo deste crédito" valor={saldo == null ? null : brl(saldo)} destaque />
        </div>
        <div className="bg-dark-900/50 border border-dark-700 rounded-lg p-3">
          <p className="text-xs text-dark-400 mb-1">Serviço executado</p>
          <p className="text-sm text-dark-100 whitespace-pre-wrap">{c.servicoExecutado}</p>
        </div>

        {/* Análise */}
        <div className="border border-dark-700 rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-dark-200">1. Análise</p>
          {ativo && c.stage === 'analise' ? (
            <>
              {c.decisaoObservacao && c.decididoEm && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">Devolvido por {c.decididoPorNome}: {c.decisaoObservacao}</p>}
              <Textarea placeholder="Parecer da análise: o atendimento procede? O valor está de acordo?" value={analise} onChange={(e) => setAnalise(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="secondary" loading={salvarAnalise.isPending} onClick={() => salvarAnalise.mutate({ id: c.id, observacao: analise })}>Salvar análise</Button>
                <Button size="sm" loading={salvarAnalise.isPending} onClick={() => salvarAnalise.mutate({ id: c.id, observacao: analise, enviarParaAprovacao: true })}>
                  Enviar pra aprovação <ArrowRight size={14} className="ml-1" />
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-dark-300 whitespace-pre-wrap">{c.analiseObservacao || '—'}</p>
          )}
        </div>

        {/* Aprovação */}
        <div className="border border-dark-700 rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-dark-200">2. Aprovação</p>
          {ativo && c.stage === 'aprovacao' ? (
            ctx.podeAprovar ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Input label="Valor aprovado (R$)" inputMode="decimal" value={valorAprovado} onChange={(e) => setValorAprovado(e.target.value)} />
                  <div className="col-span-2">
                    <Input label="Observação" placeholder="Obrigatória para devolver ou recusar" value={obsDecisao} onChange={(e) => setObsDecisao(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="danger" loading={decidir.isPending} onClick={() => decidir.mutate({ id: c.id, decisao: 'recusar', observacao: obsDecisao })}>Recusar</Button>
                  <Button size="sm" variant="secondary" loading={decidir.isPending} onClick={() => decidir.mutate({ id: c.id, decisao: 'nova_analise', observacao: obsDecisao })}>Devolver pra análise</Button>
                  <Button
                    size="sm"
                    loading={decidir.isPending}
                    onClick={() => {
                      const v = lerValor(valorAprovado)
                      if (!v || Number.isNaN(v) || v <= 0) return toast.error('Informe o valor aprovado')
                      decidir.mutate({ id: c.id, decisao: 'aprovar', valorAprovado: v, observacao: obsDecisao })
                    }}
                  >
                    Aprovar crédito
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-amber-300">Aguardando quem aprova créditos.</p>
            )
          ) : c.decididoEm && c.stage !== 'analise' ? (
            <p className="text-sm text-dark-300">
              {c.stage === 'aprovado' ? 'Aprovado' : 'Recusado'} por {c.decididoPorNome ?? '—'} em {dataBr(c.decididoEm)}
              {c.decisaoObservacao ? ` — ${c.decisaoObservacao}` : ''}
            </p>
          ) : (
            <p className="text-sm text-dark-500">—</p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <PainelAnexos tipo="credito" refId={c.id} />
          <PainelHistorico tipo="credito" refId={c.id} />
        </div>

        {ativo && (
          <div className="flex justify-end">
            <button
              onClick={() => {
                const motivo = window.prompt('Motivo do cancelamento:')
                if (motivo && motivo.trim().length >= 3) cancelar.mutate({ id: c.id, motivo })
              }}
              className="text-xs text-dark-500 hover:text-red-400"
            >
              Cancelar esta solicitação
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Info({ label, valor, destaque }: { label: string; valor: string | null | undefined; destaque?: boolean }) {
  return (
    <div>
      <p className="text-xs text-dark-500">{label}</p>
      <p className={`${destaque ? 'font-semibold text-dark-100' : 'text-dark-200'}`}>{valor || '—'}</p>
    </div>
  )
}

function ModalMovimento({ ctx, inicial, saldos, onClose }: { ctx: Contexto; inicial: { revendaId?: number; tipo: 'abatimento' | 'estorno' }; saldos: { revendaId: number; saldo: number }[]; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: hoje } = trpc.revendaFinanceiro.hoje.useQuery()
  const [tipo, setTipo] = useState(inicial.tipo)
  const [revendaId, setRevendaId] = useState(inicial.revendaId ? String(inicial.revendaId) : '')
  const [valor, setValor] = useState('')
  const [data, setData] = useState('')
  const [pedido, setPedido] = useState('')
  const [descricao, setDescricao] = useState('')
  const saldo = saldos.find((s) => s.revendaId === Number(revendaId))?.saldo ?? 0
  const revendasOpcoes = tipo === 'abatimento' ? ctx.revendas.filter((r) => (saldos.find((s) => s.revendaId === r.id)?.saldo ?? 0) > 0.005) : ctx.revendas
  const lancar = trpc.revendaFinanceiro.registrarMovimento.useMutation({
    onSuccess: () => { toast.success(tipo === 'abatimento' ? 'Abatimento lançado' : 'Estorno lançado'); utils.revendaFinanceiro.listarCreditos.invalidate(); utils.revendaFinanceiro.extratoRevenda.invalidate(); onClose() },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title={tipo === 'abatimento' ? 'Lançar abatimento (crédito usado numa compra)' : 'Lançar estorno (devolver crédito)'}>
      <div className="space-y-3">
        <div className="flex gap-1 bg-dark-900 rounded-lg p-1 border border-dark-700">
          {(['abatimento', 'estorno'] as const).map((t) => (
            <button key={t} onClick={() => setTipo(t)} className={`flex-1 py-1.5 text-sm rounded-md ${tipo === t ? 'bg-dark-600 text-dark-100' : 'text-dark-400'}`}>
              {t === 'abatimento' ? 'Abatimento' : 'Estorno'}
            </button>
          ))}
        </div>
        <Select label="Revenda *" value={revendaId} onChange={(e) => setRevendaId(e.target.value)} placeholder={revendasOpcoes.length ? 'Escolha…' : 'Nenhuma revenda com saldo'} options={revendasOpcoes.map((r) => ({ value: r.id, label: r.nome }))} />
        {revendaId && <p className="text-xs text-dark-400">Saldo atual: <b className="text-emerald-300">{brl(saldo)}</b></p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor (R$) *" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          <Input label="Data *" type="date" value={data || hoje || ''} onChange={(e) => setData(e.target.value)} />
        </div>
        <Input label={tipo === 'abatimento' ? 'Nº do pedido / NF da compra *' : 'Nº do pedido / NF (se tiver)'} value={pedido} onChange={(e) => setPedido(e.target.value)} />
        <Textarea label={tipo === 'abatimento' ? 'Observação' : 'Motivo do estorno *'} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            loading={lancar.isPending}
            onClick={() => {
              const v = lerValor(valor)
              if (!revendaId) return toast.error('Escolha a revenda')
              if (!v || Number.isNaN(v) || v <= 0) return toast.error('Informe o valor')
              lancar.mutate({ revendaId: Number(revendaId), tipo, valor: v, data: data || hoje || '', numeroPedido: pedido, descricao })
            }}
          >
            Lançar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ModalExtrato({ revendaId, nome, onClose, onAbater }: { revendaId: number; nome: string; onClose: () => void; onAbater: () => void }) {
  const { data, isLoading } = trpc.revendaFinanceiro.extratoRevenda.useQuery({ revendaId })
  const saldo = data?.length ? data[data.length - 1].saldo : 0
  return (
    <Modal open onClose={onClose} title={`Extrato de crédito — ${nome}`} size="xl">
      {isLoading ? (
        <p className="text-dark-500 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-dark-300">Saldo disponível: <b className="text-emerald-300 text-lg">{brl(saldo)}</b></p>
            {saldo > 0.005 && <Button size="sm" onClick={onAbater}><Receipt size={14} className="mr-1" /> Lançar abatimento</Button>}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-dark-400 border-b border-dark-700">
              <tr>
                <th className="text-left py-2">Data</th>
                <th className="text-left py-2">Movimentação</th>
                <th className="text-left py-2">Por</th>
                <th className="text-right py-2">Valor</th>
                <th className="text-right py-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((l, i) => (
                <tr key={i} className={`border-b border-dark-700/60 ${l.cancelado ? 'opacity-50 line-through' : ''}`}>
                  <td className="py-1.5 text-dark-400">{dataBr(l.data)}</td>
                  <td className="py-1.5 text-dark-200">{l.descricao}{l.cancelado ? ` (${l.cancelado})` : ''}</td>
                  <td className="py-1.5 text-dark-400">{l.por ?? '—'}</td>
                  <td className={`py-1.5 text-right ${l.valor < 0 ? 'text-teal-300' : 'text-emerald-300'}`}>{l.valor < 0 ? `− ${brl(-l.valor)}` : brl(l.valor)}</td>
                  <td className="py-1.5 text-right text-dark-100 font-semibold">{brl(l.saldo)}</td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-dark-500">Sem movimentação.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// ── Anexos e histórico (créditos e pagamentos) ───────────────────────────────
function PainelAnexos({ tipo, refId, comCategoria }: { tipo: 'credito' | 'pagamento'; refId: number; comCategoria?: boolean }) {
  const utils = trpc.useUtils()
  const { data } = trpc.revendaFinanceiro.anexos.useQuery({ tipo, refId })
  const [categoria, setCategoria] = useState<'nf' | 'comprovante' | 'outro'>(comCategoria ? 'nf' : 'outro')
  const [enviando, setEnviando] = useState(false)
  const refresh = () => {
    utils.revendaFinanceiro.anexos.invalidate({ tipo, refId })
    utils.revendaFinanceiro.historico.invalidate({ tipo, refId })
    utils.revendaFinanceiro.listarPagamentos.invalidate()
    utils.revendaFinanceiro.listarCreditos.invalidate()
  }
  const adicionar = trpc.revendaFinanceiro.adicionarAnexo.useMutation({ onSuccess: () => { toast.success('Anexado'); refresh() }, onError: (e) => toast.error(e.message) })
  const remover = trpc.revendaFinanceiro.removerAnexo.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) })
  const rotulo = { nf: 'NF', comprovante: 'Comprovante', outro: 'Arquivo' }
  return (
    <div className="border border-dark-700 rounded-lg p-3">
      <p className="text-sm font-semibold text-dark-200 mb-2 flex items-center gap-1"><Paperclip size={14} /> Anexos</p>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {(data ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs">
            {comCategoria && <span className={`px-1.5 py-0.5 rounded border ${a.categoria === 'nf' ? 'border-sky-500/40 text-sky-300' : a.categoria === 'comprovante' ? 'border-emerald-500/40 text-emerald-300' : 'border-dark-600 text-dark-400'}`}>{rotulo[a.categoria]}</span>}
            <a href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate flex-1">
              <FileText size={12} className="inline mr-1" />
              {a.nomeOriginal}
            </a>
            <span className="text-dark-500">{a.userName ?? ''} · {dataBr(a.createdAt)}</span>
            <button
              onClick={() => {
                if (window.confirm(`Tirar o anexo "${a.nomeOriginal}"?`)) remover.mutate({ id: a.id })
              }}
              className="text-dark-500 hover:text-red-400"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {!data?.length && <p className="text-xs text-dark-500">Nenhum anexo.</p>}
      </div>
      <div className="flex gap-2 items-center mt-2">
        {comCategoria && (
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as any)} className="bg-dark-800 border border-dark-600 rounded-lg px-2 py-1.5 text-xs text-dark-100">
            <option value="nf">Nota fiscal</option>
            <option value="comprovante">Comprovante de pagamento</option>
            <option value="outro">Outro</option>
          </select>
        )}
        <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
          <Plus size={12} /> {enviando ? 'Enviando...' : 'Anexar'}
          <input
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.xml"
            disabled={enviando}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setEnviando(true)
              try {
                const a = await enviarAnexo(file)
                adicionar.mutate({ tipo, refId, anexo: { ...a, categoria } })
              } catch (err: any) {
                toast.error(err.message)
              } finally {
                setEnviando(false)
              }
            }}
          />
        </label>
      </div>
    </div>
  )
}

function PainelHistorico({ tipo, refId }: { tipo: 'credito' | 'pagamento'; refId: number }) {
  const { data } = trpc.revendaFinanceiro.historico.useQuery({ tipo, refId })
  return (
    <div className="border border-dark-700 rounded-lg p-3">
      <p className="text-sm font-semibold text-dark-200 mb-2 flex items-center gap-1"><History size={14} /> Histórico</p>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {(data ?? []).map((h) => (
          <div key={h.id} className="text-xs">
            <span className="text-dark-500">{dataBr(h.createdAt)} {h.createdAt.slice(11, 16)} · {h.userName ?? 'sistema'}</span>
            <p className="text-dark-200">{h.descricao}</p>
          </div>
        ))}
        {!data?.length && <p className="text-xs text-dark-500">Sem histórico.</p>}
      </div>
    </div>
  )
}

// ── Pagamentos ──────────────────────────────────────────────────────────────
function AbaPagamentos({ ctx, filtros }: { ctx: Contexto; filtros: Filtros }) {
  const { data, isLoading } = trpc.revendaFinanceiro.listarPagamentos.useQuery()
  const [novo, setNovo] = useState<'comissao' | 'garantia' | null>(null)
  const [abrir, setAbrir] = useState<number | null>(null)
  const [etapaChip, setEtapaChip] = useState('')
  const base = useMemo(() => filtrarPagamentos(data ?? [], filtros), [data, filtros])
  const lista = etapaChip ? base.filter((p) => (etapaChip === 'pendentes' ? p.status === 'ativo' && !ETAPAS_PAGAS.includes(p.stage) : p.status === 'ativo' && p.stage === etapaChip)) : base
  const contagem = (s: string) => base.filter((p) => p.status === 'ativo' && p.stage === s)
  const pendentes = base.filter((p) => p.status === 'ativo' && !ETAPAS_PAGAS.includes(p.stage))
  const selecionado = data?.find((p) => p.id === abrir) ?? null

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return (
    <div className="space-y-4">
      <ComoUsar
        chave="pagamentos_odin"
        passos={[
          <>Comissão de venda aparece aqui <b>sozinha</b>: quando o pedido (Pedidos Odin → etapa Pedido) tem <b>revenda responsável</b>, <b>valor do pedido</b> e <b>comissão</b> (% ou R$) preenchidos e salvos.</>,
          <>Pagamento que não passou pelo CRM? Use <b>+ Comissão</b> ou <b>+ Garantia</b> e preencha revenda, cliente, equipamento, motivo/serviço e valor.</>,
          <>Abra o pagamento e use <b>Avançar</b> para seguir as etapas (instalação → NF de serviço → conferência → pagamento). Garantia não passa pela instalação. Dá pra pular etapa pelo <b>Mover pra etapa</b>.</>,
          <>Anexe a <b>NF de serviço</b> da revenda e o <b>comprovante de pagamento</b>. Ao agendar, informe a data prevista; ao pagar, a data em que foi pago.</>,
        ]}
        dicas={[<>Se o valor ou a revenda mudar no pedido, o pagamento é atualizado sozinho (até ser pago). Depois de pago, só fica um aviso no histórico.</>, <>Pedido cancelado: a comissão que ainda não andou é cancelada junto.</>]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip ativo={!etapaChip} onClick={() => setEtapaChip('')} label="Todos" qtd={base.length} />
          <Chip ativo={etapaChip === 'pendentes'} onClick={() => setEtapaChip('pendentes')} label="A pagar" qtd={pendentes.length} valor={pendentes.reduce((a, p) => a + p.valor, 0)} />
          {ETAPAS_PAGAMENTO.map((e) => {
            const xs = contagem(e.value)
            if (!xs.length) return null
            return <Chip key={e.value} ativo={etapaChip === e.value} onClick={() => setEtapaChip(e.value)} label={e.label} qtd={xs.length} valor={xs.reduce((a, p) => a + p.valor, 0)} />
          })}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setNovo('garantia')}><Plus size={16} className="mr-1" /> Garantia</Button>
          <Button onClick={() => setNovo('comissao')}><Plus size={16} className="mr-1" /> Comissão</Button>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400 border-b border-dark-700">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Revenda</th>
              <th className="text-left px-3 py-2">Cliente / equipamento</th>
              <th className="text-left px-3 py-2">Pedido</th>
              <th className="text-right px-3 py-2">Venda</th>
              <th className="text-right px-3 py-2">Comissão</th>
              <th className="text-right px-3 py-2">A pagar</th>
              <th className="text-left px-3 py-2">Etapa</th>
              <th className="text-left px-3 py-2">Previsto / pago</th>
              <th className="text-left px-3 py-2">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} onClick={() => setAbrir(p.id)} className={`border-b border-dark-700/60 hover:bg-dark-700/40 cursor-pointer ${p.status === 'cancelado' ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 text-dark-400">{p.id}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${p.tipo === 'comissao' ? 'bg-gold-600/10 text-gold-300 border-gold-600/30' : 'bg-orange-500/10 text-orange-300 border-orange-500/30'}`}>{p.tipo === 'comissao' ? 'Comissão' : 'Garantia'}</span>
                  <p className="text-[10px] text-dark-500 mt-0.5">{p.origem === 'automatico' ? 'gerado pelo CRM' : 'cadastrado à mão'}</p>
                </td>
                <td className="px-3 py-2 text-dark-100">{p.revendaNome}</td>
                <td className="px-3 py-2">
                  <p className="text-dark-100">{p.clienteNome ?? '—'}</p>
                  <p className="text-xs text-dark-500 max-w-[220px] truncate">{p.equipamento ?? p.descricao ?? '—'}</p>
                </td>
                <td className="px-3 py-2 text-dark-300">
                  {p.numeroPedido ?? '—'}
                  {p.ordemId && <p className="text-[10px] text-dark-500">Pedido #{p.ordemId}{p.ordemStatus === 'cancelado' ? ' · CANCELADO' : ''}</p>}
                </td>
                <td className="px-3 py-2 text-right text-dark-300">{brl(p.valorVenda)}</td>
                <td className="px-3 py-2 text-right text-dark-300">{p.comissaoModalidade === 'percentual' ? `${String(p.comissaoPercentual ?? '').replace('.', ',')}%` : p.comissaoModalidade === 'fixo' ? 'Fixo' : '—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-dark-100">{brl(p.valor)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${p.status === 'cancelado' ? 'bg-dark-700 text-dark-400 border-dark-600' : corEtapaPagamento(p.stage)}`}>{p.status === 'cancelado' ? 'Cancelado' : rotuloEtapaPagamento(p.stage, p.tipo)}</span>
                  {(p.anexos.nf > 0 || p.anexos.comprovante > 0) && (
                    <p className="text-[10px] text-dark-500 mt-0.5">{[p.anexos.nf && 'NF ✓', p.anexos.comprovante && 'comprovante ✓'].filter(Boolean).join(' · ')}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-dark-400 text-xs">
                  {p.dataPagamento ? <span className="text-green-300">pago {dataBr(p.dataPagamento)}</span> : p.dataPrevistaPagamento ? `prev. ${dataBr(p.dataPrevistaPagamento)}` : '—'}
                </td>
                <td className="px-3 py-2 text-dark-400">{p.responsavelNome ?? '—'}</td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-dark-500">Nenhum pagamento com esses filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {novo && <ModalPagamento ctx={ctx} tipo={novo} onClose={() => setNovo(null)} />}
      {selecionado && <DetalhePagamento ctx={ctx} pagamento={selecionado} onClose={() => setAbrir(null)} />}
    </div>
  )
}

function Chip({ ativo, onClick, label, qtd, valor }: { ativo: boolean; onClick: () => void; label: string; qtd: number; valor?: number }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${ativo ? 'bg-gold-600/15 border-gold-600/50 text-gold-200' : 'bg-dark-800 border-dark-700 text-dark-300 hover:border-dark-500'}`}>
      {label} <b className="ml-1">{qtd}</b>
      {valor != null && <span className="ml-1 text-dark-400">· {brl(valor)}</span>}
    </button>
  )
}

function ModalPagamento({ ctx, tipo, pagamento, onClose }: { ctx: Contexto; tipo: 'comissao' | 'garantia'; pagamento?: Pagamento; onClose: () => void }) {
  const utils = trpc.useUtils()
  const auto = pagamento?.origem === 'automatico'
  const pago = pagamento ? ETAPAS_PAGAS.includes(pagamento.stage) : false
  const travado = auto || pago
  const [revendaId, setRevendaId] = useState(pagamento?.revendaId ? String(pagamento.revendaId) : '')
  const [cliente, setCliente] = useState({ clienteId: pagamento?.clienteId ?? null, clienteNome: pagamento?.clienteNome ?? '' })
  const [numeroPedido, setNumeroPedido] = useState(pagamento?.numeroPedido ?? '')
  const [equipamento, setEquipamento] = useState(pagamento?.equipamento ?? '')
  const [descricao, setDescricao] = useState(pagamento?.descricao ?? '')
  const [valorVenda, setValorVenda] = useState(pagamento?.valorVenda != null ? String(pagamento.valorVenda).replace('.', ',') : '')
  const [modalidade, setModalidade] = useState<'percentual' | 'fixo'>(pagamento?.comissaoModalidade ?? 'fixo')
  const [percentual, setPercentual] = useState(pagamento?.comissaoPercentual != null ? String(pagamento.comissaoPercentual).replace('.', ',') : '')
  const [valor, setValor] = useState(pagamento ? String(pagamento.valor).replace('.', ',') : '')
  const [observacoes, setObservacoes] = useState(pagamento?.observacoes ?? '')
  const [responsavelId, setResponsavelId] = useState(String(pagamento?.responsavelId ?? ctx.meuId))
  const [dataPrevista, setDataPrevista] = useState(pagamento?.dataPrevistaPagamento ?? '')
  const [nf, setNf] = useState(pagamento?.nfNumero ?? '')
  const [anexos, setAnexos] = useState<any[]>([])
  const vv = lerValor(valorVenda)
  const pc = lerValor(percentual)
  const calculado = tipo === 'comissao' && modalidade === 'percentual' && vv && pc && !Number.isNaN(vv) && !Number.isNaN(pc) ? Math.round(vv * pc) / 100 : null
  const ok = () => {
    utils.revendaFinanceiro.listarPagamentos.invalidate()
    utils.revendaFinanceiro.historico.invalidate()
    onClose()
  }
  const criar = trpc.revendaFinanceiro.criarPagamento.useMutation({ onSuccess: () => { toast.success('Pagamento cadastrado'); ok() }, onError: (e) => toast.error(e.message) })
  const editar = trpc.revendaFinanceiro.editarPagamento.useMutation({ onSuccess: () => { toast.success('Salvo'); ok() }, onError: (e) => toast.error(e.message) })

  function salvar() {
    const v = calculado ?? lerValor(valor)
    if (!travado) {
      if (!revendaId && !pagamento?.revendaNome) return toast.error('Escolha a revenda')
      if (!v || Number.isNaN(v) || v <= 0) return toast.error('Informe o valor a pagar')
      if (!descricao.trim()) return toast.error(tipo === 'garantia' ? 'Descreva o serviço prestado' : 'Escreva o motivo do pagamento')
    }
    const dados = {
      tipo,
      revendaId: revendaId ? Number(revendaId) : null,
      revendaNome: pagamento?.revendaNome,
      clienteId: cliente.clienteId,
      clienteNome: cliente.clienteNome,
      numeroPedido,
      equipamento,
      descricao,
      valorVenda: vv && !Number.isNaN(vv) ? vv : null,
      comissaoModalidade: tipo === 'comissao' ? modalidade : null,
      comissaoPercentual: tipo === 'comissao' && modalidade === 'percentual' && pc && !Number.isNaN(pc) ? pc : null,
      valor: v && !Number.isNaN(v) ? v : undefined,
      observacoes,
      responsavelId: responsavelId ? Number(responsavelId) : null,
      dataPrevistaPagamento: dataPrevista || null,
      nfNumero: nf,
    }
    if (pagamento) editar.mutate({ id: pagamento.id, ...dados })
    else criar.mutate({ ...dados, anexos })
  }

  const titulo = pagamento ? `Editar pagamento #${pagamento.id}` : tipo === 'comissao' ? 'Novo pagamento de comissão' : 'Novo pagamento de garantia'
  return (
    <Modal open onClose={onClose} title={titulo} size="lg">
      <div className="space-y-3">
        {travado && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            {auto ? 'Gerado pelo pedido: revenda, cliente, valores e equipamento mudam lá no Pedido.' : 'Já pago: os valores não mudam mais.'} Aqui dá pra mudar responsável, NF, data prevista e observações.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {travado ? (
            <Info label="Revenda" valor={pagamento?.revendaNome} />
          ) : (
            <Select label="Revenda *" value={revendaId} onChange={(e) => setRevendaId(e.target.value)} placeholder={pagamento?.revendaNome ?? 'Escolha…'} options={ctx.revendas.map((r) => ({ value: r.id, label: r.nome }))} />
          )}
          {travado ? <Info label="Cliente" valor={pagamento?.clienteNome} /> : <CampoCliente clienteId={cliente.clienteId} clienteNome={cliente.clienteNome} onChange={setCliente} />}
          {!travado && (
            <>
              <Input label="Nº do pedido" value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} />
              <Input label="Equipamento" value={equipamento} onChange={(e) => setEquipamento(e.target.value)} />
            </>
          )}
        </div>
        {!travado && (
          <>
            <Textarea label={tipo === 'garantia' ? 'Serviço prestado *' : 'Motivo do pagamento *'} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            {tipo === 'comissao' && (
              <div className="grid grid-cols-3 gap-3 items-end">
                <Input label="Valor da venda (R$)" inputMode="decimal" value={valorVenda} onChange={(e) => setValorVenda(e.target.value)} />
                <div>
                  <label className="text-sm text-dark-200 font-medium mb-1 block">Modalidade</label>
                  <div className="flex rounded-lg border border-dark-600 overflow-hidden">
                    {(['percentual', 'fixo'] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setModalidade(m)} className={`flex-1 py-2 text-sm ${modalidade === m ? 'bg-gold-600/20 text-gold-300' : 'text-dark-400'}`}>
                        {m === 'percentual' ? 'Percentual' : 'Valor fixo'}
                      </button>
                    ))}
                  </div>
                </div>
                {modalidade === 'percentual' ? <Input label="Percentual (%)" inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} /> : <div />}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {calculado != null ? <Info label="Valor a pagar (calculado)" valor={brl(calculado)} destaque /> : <Input label="Valor a pagar (R$) *" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
            </div>
          </>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Select label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} options={ctx.responsaveis.map((u) => ({ value: u.id, label: u.name }))} />
          <Input label="Data prevista do pagamento" type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} />
          <Input label="Nº da NF de serviço" value={nf} onChange={(e) => setNf(e.target.value)} />
        </div>
        <Textarea label="Observações" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        {!pagamento && <CampoAnexosNovos anexos={anexos} setAnexos={setAnexos} comCategoria />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={criar.isPending || editar.isPending}>{pagamento ? 'Salvar' : 'Cadastrar'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function DetalhePagamento({ ctx, pagamento: p, onClose }: { ctx: Contexto; pagamento: Pagamento; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: hoje } = trpc.revendaFinanceiro.hoje.useQuery()
  const [editando, setEditando] = useState(false)
  const [destino, setDestino] = useState<string | null>(null)
  const [dataPrevista, setDataPrevista] = useState(p.dataPrevistaPagamento ?? '')
  const [dataPagamento, setDataPagamento] = useState(p.dataPagamento ?? '')
  const [nf, setNf] = useState(p.nfNumero ?? '')
  const [obs, setObs] = useState('')
  const refresh = () => {
    utils.revendaFinanceiro.listarPagamentos.invalidate()
    utils.revendaFinanceiro.historico.invalidate({ tipo: 'pagamento', refId: p.id })
  }
  const mover = trpc.revendaFinanceiro.moverPagamento.useMutation({ onSuccess: () => { toast.success('Etapa atualizada'); setDestino(null); setObs(''); refresh() }, onError: (e) => toast.error(e.message) })
  const cancelar = trpc.revendaFinanceiro.cancelarPagamento.useMutation({ onSuccess: () => { toast.success('Cancelado'); refresh() }, onError: (e) => toast.error(e.message) })
  const reabrir = trpc.revendaFinanceiro.reabrirPagamento.useMutation({ onSuccess: () => { toast.success('Reaberto'); refresh() }, onError: (e) => toast.error(e.message) })
  const etapas = etapasDoTipo(p.tipo)
  const idx = etapas.findIndex((e) => e.value === p.stage)
  const proxima = idx >= 0 ? etapas[idx + 1] : etapas[0]
  const ativo = p.status === 'ativo'
  const idxGlobal = (s: string) => ETAPAS_PAGAMENTO.findIndex((e) => e.value === s)
  const precisaPrevista = destino ? idxGlobal(destino) >= idxGlobal('pagamento_agendado') : false
  const precisaPagamento = destino ? idxGlobal(destino) >= idxGlobal('pagamento_realizado') : false
  const pedeNf = destino ? idxGlobal(destino) >= idxGlobal('nf_conferencia') && !p.nfNumero : false

  function confirmar() {
    if (!destino) return
    if (precisaPrevista && !dataPrevista) return toast.error('Informe a data prevista do pagamento')
    if (precisaPagamento && !(dataPagamento || hoje)) return toast.error('Informe a data do pagamento')
    mover.mutate({
      id: p.id,
      stage: destino as any,
      dataPrevistaPagamento: dataPrevista || undefined,
      dataPagamento: precisaPagamento ? dataPagamento || hoje || undefined : undefined,
      nfNumero: nf || undefined,
      observacao: obs || undefined,
    })
  }

  if (editando) return <ModalPagamento ctx={ctx} tipo={p.tipo} pagamento={p} onClose={() => setEditando(false)} />
  return (
    <Modal open onClose={onClose} title={`Pagamento #${p.id} — ${p.tipo === 'comissao' ? 'Comissão' : 'Garantia'} · ${p.revendaNome}`} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs border ${ativo ? corEtapaPagamento(p.stage) : 'bg-dark-700 text-dark-400 border-dark-600'}`}>{ativo ? rotuloEtapaPagamento(p.stage, p.tipo) : `Cancelado: ${p.cancelMotivo ?? ''}`}</span>
          <span className="text-xs text-dark-500">
            {p.origem === 'automatico' ? `Gerado pelo Pedido #${p.ordemId}` : `Cadastrado por ${p.criadoPorNome ?? '—'}`} em {dataBr(p.createdAt)} · Responsável: {p.responsavelNome ?? '—'}
          </span>
          {p.ordemStatus === 'cancelado' && <span className="px-2 py-0.5 rounded-full text-xs border border-red-500/40 text-red-300">Pedido cancelado</span>}
          <div className="flex-1" />
          {ativo && <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>Editar</Button>}
        </div>

        {/* Linha do tempo das etapas */}
        <div className="flex flex-wrap gap-1">
          {etapas.map((e, i) => (
            <button
              key={e.value}
              disabled={!ativo || e.value === p.stage}
              onClick={() => setDestino(e.value)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${e.value === p.stage ? `${e.cor} font-semibold` : i < idx ? 'border-emerald-700/40 text-emerald-400/80' : 'border-dark-700 text-dark-500 hover:border-dark-500 hover:text-dark-300'}`}
              title={e.value === p.stage ? 'Etapa atual' : 'Mover pra esta etapa'}
            >
              {i < idx ? '✓ ' : ''}
              {rotuloEtapaPagamento(e.value, p.tipo)}
            </button>
          ))}
        </div>

        {ativo && (
          <div className="flex flex-wrap gap-2 items-center">
            {proxima && (
              <Button onClick={() => setDestino(proxima.value)}>
                <ArrowRight size={16} className="mr-1" /> Avançar pra "{rotuloEtapaPagamento(proxima.value, p.tipo)}"
              </Button>
            )}
            <select value="" onChange={(e) => e.target.value && setDestino(e.target.value)} className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100">
              <option value="">Mover pra etapa…</option>
              {etapas.filter((e) => e.value !== p.stage).map((e) => (
                <option key={e.value} value={e.value}>{rotuloEtapaPagamento(e.value, p.tipo)}</option>
              ))}
            </select>
          </div>
        )}

        {destino && (
          <div className="border border-gold-600/40 bg-gold-600/5 rounded-lg p-3 space-y-2">
            <p className="text-sm text-dark-100">Mover para <b>{rotuloEtapaPagamento(destino, p.tipo)}</b></p>
            <div className="grid grid-cols-3 gap-3">
              {(precisaPrevista || destino === 'pagamento_agendado') && <Input label="Data prevista do pagamento *" type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} />}
              {precisaPagamento && <Input label="Pago em *" type="date" value={dataPagamento || hoje || ''} onChange={(e) => setDataPagamento(e.target.value)} />}
              {pedeNf && <Input label="Nº da NF de serviço" value={nf} onChange={(e) => setNf(e.target.value)} />}
            </div>
            <Input label="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
            {precisaPagamento && p.anexos.comprovante === 0 && <p className="text-xs text-amber-300">Lembre de anexar o comprovante de pagamento (aqui embaixo, em Anexos).</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDestino(null)}>Voltar</Button>
              <Button size="sm" loading={mover.isPending} onClick={confirmar}>Confirmar</Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Cliente" valor={p.clienteNome} />
          <Info label="Nº do pedido" valor={[p.numeroPedido, p.ordemId && `#${p.ordemId} no CRM`].filter(Boolean).join(' · ')} />
          <Info label="Equipamento" valor={p.equipamento} />
          <Info label="Valor da venda" valor={brl(p.valorVenda)} />
          <Info label="Modalidade" valor={p.comissaoModalidade === 'percentual' ? `Percentual (${String(p.comissaoPercentual ?? '').replace('.', ',')}%)` : p.comissaoModalidade === 'fixo' ? 'Valor fixo' : null} />
          <Info label="Valor a pagar" valor={brl(p.valor)} destaque />
          <Info label="Previsto para" valor={dataBr(p.dataPrevistaPagamento)} />
          <Info label="Pago em" valor={dataBr(p.dataPagamento)} />
          <Info label="Nº da NF de serviço" valor={p.nfNumero} />
        </div>
        {(p.descricao || p.observacoes) && (
          <div className="grid md:grid-cols-2 gap-3">
            {p.descricao && <div className="bg-dark-900/50 border border-dark-700 rounded-lg p-3"><p className="text-xs text-dark-400 mb-1">{p.tipo === 'garantia' ? 'Serviço prestado' : 'Motivo'}</p><p className="text-sm text-dark-100 whitespace-pre-wrap">{p.descricao}</p></div>}
            {p.observacoes && <div className="bg-dark-900/50 border border-dark-700 rounded-lg p-3"><p className="text-xs text-dark-400 mb-1">Observações</p><p className="text-sm text-dark-100 whitespace-pre-wrap">{p.observacoes}</p></div>}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <PainelAnexos tipo="pagamento" refId={p.id} comCategoria />
          <PainelHistorico tipo="pagamento" refId={p.id} />
        </div>

        <div className="flex justify-end">
          {ativo ? (
            <button
              onClick={() => {
                const motivo = window.prompt('Motivo do cancelamento:')
                if (motivo && motivo.trim().length >= 3) cancelar.mutate({ id: p.id, motivo })
              }}
              className="text-xs text-dark-500 hover:text-red-400"
            >
              Cancelar este pagamento
            </button>
          ) : (
            <button onClick={() => reabrir.mutate({ id: p.id })} className="text-xs text-dark-400 hover:text-dark-100">Reabrir</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
