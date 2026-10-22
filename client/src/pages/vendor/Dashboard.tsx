import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../lib/trpc'
import { formatarPercentual } from '../../lib/utils'
import { hojeBrString } from '../../lib/utils'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'
import { AnelProgresso, Esqueleto, EsqueletoCards, primeiroNome, saudacao } from '../../components/ui/Visual'

// Mesma paleta validada (skill de dataviz) já usada no Painel de TV — azul
// neutro pra vendas, âmbar pra contatos/ligações, verde de status só quando
// bate a meta.
const COR_VENDAS = '#3987e5'
const COR_CONTATOS = '#c2691a'
const COR_META_BATIDA = '#0ca30c'
const COR_ABAIXO = '#e5484d'

function formatarMoeda(v: number): string {
  return formatarMoedaBr(v, { casas: 0 })
}

function TooltipHistorico({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

function BarraProgresso({ percentual, destaque }: { percentual: number; destaque: boolean }) {
  return (
    <div className="w-full bg-dark-700 rounded-full h-2 mt-1.5">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${Math.min(100, percentual)}%`, backgroundColor: destaque ? COR_META_BATIDA : COR_VENDAS }}
      />
    </div>
  )
}

function AcaoHoje({ to, icone, cor, titulo, valor, detalhe }: { to: string; icone: string; cor: string; titulo: string; valor: number; detalhe: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-2xl border border-dark-600 bg-dark-800 p-3.5 hover:border-dark-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 transition-all"
    >
      <span className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: `${cor}22` }}>
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-dark-400">{titulo}</span>
        <span className="block text-xs text-dark-500 truncate">{detalhe}</span>
      </span>
      <span className="text-2xl font-bold" style={{ color: cor }}>
        {valor}
      </span>
      <span className="text-dark-500 group-hover:text-dark-200 group-hover:translate-x-0.5 transition-all">›</span>
    </Link>
  )
}

function MiniStat({ rotulo, valor, detalhe }: { rotulo: string; valor: React.ReactNode; detalhe?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 hover:border-dark-500 transition-colors">
      <p className="text-xs text-dark-400">{rotulo}</p>
      <p className="text-2xl font-bold text-dark-50 mt-0.5">{valor}</p>
      {detalhe && <p className="text-sm text-green-400">{detalhe}</p>}
    </div>
  )
}

export default function VendorDashboard() {
  const { user } = useAuth()
  const { data } = trpc.painel.meuResumo.useQuery()
  const hoje = hojeBrString()
  const { data: compromissosHoje } = trpc.compromissos.listar.useQuery({ dataInicio: hoje, dataFim: hoje })
  const { data: leadsStats } = trpc.leads.stats.useQuery()

  // "Faltam N vendas" traduz o % da meta pra algo acionável — em vez de só
  // "62%", dá pra saber exatamente quantas vendas do tamanho médio de vocês
  // ainda faltam fechar. Sem ticket médio (mês sem venda ainda) não dá pra
  // estimar, então fica só null (escondido).
  const faltaFaturamento = data?.metaFaturamento ? Math.max(0, data.metaFaturamento - data.vendasMes.valor) : 0
  const vendasFaltantes =
    data && data.vendasMes.ticketMedio > 0 && faltaFaturamento > 0 ? Math.ceil(faltaFaturamento / data.vendasMes.ticketMedio) : null

  const pctMeta = data?.percentualMetaFaturamento ?? 0
  const pctIdeal = data?.percentualIdealHoje ?? 0
  const noRitmo = pctMeta >= pctIdeal
  const corMeta = pctMeta >= 100 ? COR_META_BATIDA : noRitmo ? COR_VENDAS : COR_ABAIXO
  const compromissosAbertos = (compromissosHoje ?? []).filter((c) => !c.concluido)
  const dataExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })

  if (!data) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-6xl">
        <Esqueleto className="h-16 w-72" />
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
          <Esqueleto className="h-56 rounded-2xl" />
          <div className="grid gap-3">
            <EsqueletoCards quantidade={3} className="h-[66px]" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <EsqueletoCards quantidade={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-dark-500 first-letter:uppercase">{dataExtenso}</p>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-dark-50 mt-0.5">
            {saudacao()}, {primeiroNome(user?.name)} <span className="inline-block origin-[70%_70%] animate-[aceno_1.8s_ease-in-out_1]">👋</span>
          </h1>
          <p className="text-dark-400 text-sm mt-0.5">Aqui está o que importa hoje.</p>
        </div>
        {!!data.sequenciaDiasVendendo && data.sequenciaDiasVendendo >= 2 && (
          <span className="text-sm font-bold text-amber-300 bg-gradient-to-r from-amber-500/20 to-orange-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full">
            🔥 {data.sequenciaDiasVendendo} dias seguidos vendendo
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        <div
          className="relative overflow-hidden rounded-2xl border border-dark-600 bg-dark-800 p-5 flex flex-col sm:flex-row items-center gap-6"
          style={{ backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${corMeta}1f, transparent 60%)` }}
        >
          <AnelProgresso percentual={pctMeta} marcador={pctIdeal} cor={corMeta}>
            <span className="text-3xl font-bold text-dark-50 leading-none">{formatarPercentual(pctMeta)}%</span>
            <span className="text-[10px] uppercase tracking-wider text-dark-400 mt-1">da meta</span>
          </AnelProgresso>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-sm font-semibold text-dark-100">Meta do mês</p>
            <p className="text-2xl font-bold text-dark-50 mt-1">{formatarMoeda(data.vendasMes.valor)}</p>
            <p className="text-xs text-dark-400">de {formatarMoeda(data.metaFaturamento ?? 0)}</p>
            <span
              className={`inline-flex items-center gap-1.5 mt-3 text-xs font-semibold px-2.5 py-1 rounded-full ${
                pctMeta >= 100 ? 'bg-green-500/15 text-green-400' : noRitmo ? 'bg-sky-500/15 text-sky-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {pctMeta >= 100 ? '🏆 Meta batida!' : noRitmo ? '✅ No ritmo' : `⚠️ Abaixo do ritmo · ideal hoje ${formatarPercentual(pctIdeal)}%`}
            </span>
            {vendasFaltantes !== null && (
              <p className="text-xs text-gold-300 mt-2">
                Faltam ~{vendasFaltantes} venda{vendasFaltantes > 1 ? 's' : ''} do seu ticket médio
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <AcaoHoje
            to="/vendedor/fila-hoje"
            icone="📞"
            cor="#3987e5"
            titulo="Quem ligar hoje"
            valor={data.paraLigarHoje}
            detalhe={`clientes há 3+ dias sem contato · de ${data.totalCarteira}`}
          />
          <AcaoHoje
            to="/vendedor/kanban"
            icone="💬"
            cor="#e8a33a"
            titulo="Orçamentos esperando resposta"
            valor={data.orcamentosAguardando.quantidade}
            detalhe={data.orcamentosAguardando.valor ? `${formatarMoeda(data.orcamentosAguardando.valor)} em negociação` : 'em Negociação no Kanban'}
          />
          <AcaoHoje
            to="/vendedor/calendario"
            icone="🗓️"
            cor="#8b5cf6"
            titulo="Compromissos de hoje"
            valor={compromissosAbertos.length}
            detalhe={compromissosAbertos[0] ? `Próximo: ${compromissosAbertos[0].titulo}` : 'Nada pendente pra hoje'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <MiniStat rotulo="Vendas hoje" valor={String(data.vendasHoje.quantidade)} detalhe={formatarMoeda(data.vendasHoje.valor)} />
        <MiniStat rotulo="Vendas no mês" valor={String(data.vendasMes.quantidade)} detalhe={formatarMoeda(data.vendasMes.valor)} />
        <MiniStat rotulo="Ticket médio" valor={formatarMoeda(data.vendasMes.ticketMedio)} />
        <MiniStat
          rotulo="Ranking do time"
          valor={
            <>
              {data.posicaoRanking === 1 ? '🥇 ' : data.posicaoRanking === 2 ? '🥈 ' : data.posicaoRanking === 3 ? '🥉 ' : ''}
              {data.posicaoRanking ?? '—'}
              <span className="text-sm text-dark-400 font-normal">/{data.totalVendedores}</span>
            </>
          }
        />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-dark-100">📞 Ligações (ritmo do mês)</p>
          <span className="text-sm font-mono text-dark-300">
            {data?.ligacoesMes ?? 0}/{data?.metaLigacoesAcumulada ?? 0}
          </span>
        </div>
        <BarraProgresso percentual={data?.percentualMetaLigacoes ?? 0} destaque={(data?.percentualMetaLigacoes ?? 0) >= 100} />
        <p className="text-xs text-dark-500 mt-1.5">
          Meta: {data?.metaLigacoesDia ?? 25}/dia útil · hoje: {data?.ligacoesEfetivasHoje ?? 0} efetiva
          {(data?.ligacoesEfetivasHoje ?? 0) !== 1 ? 's' : ''} de {data?.ligacoesHoje ?? 0} tentativa
          {(data?.ligacoesHoje ?? 0) !== 1 ? 's' : ''} ({formatarPercentual(data?.percentualEfetividadeHoje)}%)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📈 Suas vendas (últimos 14 dias)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data?.historico ?? []} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="grad-vendas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COR_VENDAS} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COR_VENDAS} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
              <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Area type="monotone" dataKey="vendas" name="Vendas" stroke={COR_VENDAS} strokeWidth={2.5} fill="url(#grad-vendas)" dot={{ r: 2.5, strokeWidth: 0, fill: COR_VENDAS }} activeDot={{ r: 5 }}>
                <LabelList dataKey="vendas" position="top" fill="#898781" fontSize={10} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📞 Suas ligações (últimos 14 dias)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data?.historico ?? []} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="grad-contatos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COR_CONTATOS} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COR_CONTATOS} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
              <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Area type="monotone" dataKey="contatos" name="Contatos" stroke={COR_CONTATOS} strokeWidth={2.5} fill="url(#grad-contatos)" dot={{ r: 2.5, strokeWidth: 0, fill: COR_CONTATOS }} activeDot={{ r: 5 }}>
                <LabelList dataKey="contatos" position="top" fill="#898781" fontSize={10} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">🗓️ Compromissos de hoje</h2>
          <div className="space-y-2">
            {!compromissosHoje?.length && <p className="text-xs text-dark-500">Nada agendado pra hoje.</p>}
            {compromissosHoje?.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b border-dark-700/50 last:border-0">
                <span className={c.concluido ? 'text-dark-500 line-through' : 'text-dark-100'}>{c.titulo}</span>
                <span className="text-xs text-dark-400">{c.cliente?.razaoSocial ?? ''}</span>
              </div>
            ))}
          </div>
          <Link to="/vendedor/calendario" className="text-xs text-gold-400 underline mt-3 inline-block">
            Ver agenda completa →
          </Link>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">⏰ Clientes há mais tempo sem contato</h2>
          <div className="space-y-2">
            {!data?.clientesSemContato.length && <p className="text-xs text-dark-500">Tudo em dia — nenhum cliente pendente.</p>}
            {data?.clientesSemContato.map((c) => (
              <Link
                key={c.clienteId}
                to={`/vendedor/clientes/${c.clienteId}`}
                className="flex items-center justify-between text-sm py-1 border-b border-dark-700/50 last:border-0 hover:text-gold-400"
              >
                <span className="text-dark-100">{c.razaoSocial}</span>
                <span className="text-xs text-red-400">{c.dias} dia(s)</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">🧲 Meus leads (site)</h2>
          <Link to="/vendedor/leads" className="text-xs text-gold-400 underline">
            Ver Leads →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-dark-400">Total</p>
            <p className="text-2xl font-bold text-dark-50">{leadsStats?.total ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-dark-400">Novos</p>
            <p className="text-2xl font-bold text-dark-50">{leadsStats?.byStatus?.novo ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-dark-400">Em negociação</p>
            <p className="text-2xl font-bold text-dark-50">{leadsStats?.byStatus?.em_negociacao ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-dark-400">Conversão</p>
            <p className="text-2xl font-bold text-gold-400">{leadsStats?.conversion ?? 0}%</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link to="/vendedor/kanban" className="text-sm text-gold-400 underline">
          Ver Kanban →
        </Link>
        <Link to="/vendedor/clientes" className="text-sm text-gold-400 underline">
          Meus clientes →
        </Link>
        <Link to="/vendedor/relatorios" className="text-sm text-gold-400 underline">
          Relatórios →
        </Link>
      </div>
    </div>
  )
}
