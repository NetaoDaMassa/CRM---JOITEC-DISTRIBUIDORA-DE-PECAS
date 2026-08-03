import { Link } from 'react-router-dom'
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../lib/trpc'
import { hojeBrString } from '../../lib/utils'

// Mesma paleta validada (skill de dataviz) já usada no Painel de TV — azul
// neutro pra vendas, âmbar pra contatos/ligações, verde de status só quando
// bate a meta.
const COR_VENDAS = '#3987e5'
const COR_CONTATOS = '#c2691a'
const COR_META_BATIDA = '#0ca30c'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
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

export default function VendorDashboard() {
  const { user } = useAuth()
  const { data } = trpc.painel.meuResumo.useQuery()
  const hoje = hojeBrString()
  const { data: compromissosHoje } = trpc.compromissos.listar.useQuery({ dataInicio: hoje, dataFim: hoje })

  // "Faltam N vendas" traduz o % da meta pra algo acionável — em vez de só
  // "62%", dá pra saber exatamente quantas vendas do tamanho médio de vocês
  // ainda faltam fechar. Sem ticket médio (mês sem venda ainda) não dá pra
  // estimar, então fica só null (escondido).
  const faltaFaturamento = data?.metaFaturamento ? Math.max(0, data.metaFaturamento - data.vendasMes.valor) : 0
  const vendasFaltantes =
    data && data.vendasMes.ticketMedio > 0 && faltaFaturamento > 0 ? Math.ceil(faltaFaturamento / data.vendasMes.ticketMedio) : null

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Olá, {user?.name}</h1>
          <p className="text-dark-400 text-sm">Sua produção do mês, num relance.</p>
        </div>
        {!!data?.sequenciaDiasVendendo && data.sequenciaDiasVendendo >= 2 && (
          <span className="text-sm font-bold text-amber-400 bg-amber-900/20 px-3 py-1.5 rounded-full">
            🔥 {data.sequenciaDiasVendendo} dias seguidos vendendo
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Vendas hoje</p>
          <p className="text-2xl font-bold text-dark-50">{data?.vendasHoje.quantidade ?? 0}</p>
          <p className="text-sm text-green-400">{formatarMoeda(data?.vendasHoje.valor ?? 0)}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Vendas no mês</p>
          <p className="text-2xl font-bold text-dark-50">{data?.vendasMes.quantidade ?? 0}</p>
          <p className="text-sm text-green-400">{formatarMoeda(data?.vendasMes.valor ?? 0)}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Ticket médio (mês)</p>
          <p className="text-2xl font-bold text-dark-50">{formatarMoeda(data?.vendasMes.ticketMedio ?? 0)}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Ranking do time</p>
          <p className="text-2xl font-bold text-gold-400">
            {data?.posicaoRanking ?? '—'}
            <span className="text-sm text-dark-400 font-normal">/{data?.totalVendedores ?? 0}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`rounded-2xl p-5 border-2 ${(data?.percentualMetaFaturamento ?? 0) >= 100 ? 'border-green-500 bg-green-900/10' : 'border-dark-600 bg-dark-800'}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-dark-100">🎯 Meta mensal de faturamento</p>
            {(data?.percentualMetaFaturamento ?? 0) >= 100 ? (
              <span className="text-xs font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded-full">✅ BATENDO</span>
            ) : (
              <span className="text-xs font-bold text-amber-400 bg-amber-900/20 px-2 py-1 rounded-full">EM ANDAMENTO</span>
            )}
          </div>
          <p className="text-3xl font-bold text-dark-50 mt-1">{data?.percentualMetaFaturamento ?? 0}%</p>
          <BarraProgresso percentual={data?.percentualMetaFaturamento ?? 0} destaque={(data?.percentualMetaFaturamento ?? 0) >= 100} />
          <p className="text-xs text-dark-500 mt-1.5">
            {formatarMoeda(data?.vendasMes.valor ?? 0)} de {formatarMoeda(data?.metaFaturamento ?? 0)} no mês
          </p>
          {vendasFaltantes !== null && (
            <p className="text-xs text-gold-300 mt-1">
              Faltam ~{vendasFaltantes} venda{vendasFaltantes > 1 ? 's' : ''} (do seu ticket médio) pra bater a meta
            </p>
          )}
        </div>

        <div className={`rounded-2xl p-5 border-2 ${(data?.percentualRitmo ?? 0) >= 100 ? 'border-green-500 bg-green-900/10' : 'border-dark-600 bg-dark-800'}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-dark-100">📅 Meta diária (ritmo acumulado)</p>
            {(data?.percentualRitmo ?? 0) >= 100 ? (
              <span className="text-xs font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded-full">✅ BATEU HOJE</span>
            ) : (
              <span className="text-xs font-bold text-red-400 bg-red-900/20 px-2 py-1 rounded-full">❌ NÃO BATEU AINDA</span>
            )}
          </div>
          <p className="text-3xl font-bold text-dark-50 mt-1">{data?.percentualRitmo ?? 0}%</p>
          <BarraProgresso percentual={data?.percentualRitmo ?? 0} destaque={(data?.percentualRitmo ?? 0) >= 100} />
          <p className="text-xs text-dark-500 mt-1.5">
            Acumulado até hoje: {formatarMoeda(data?.metaAcumuladaAteHoje ?? 0)} · você fechou {formatarMoeda(data?.vendasMes.valor ?? 0)}
          </p>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-dark-100">📞 Ligações hoje</p>
          <span className="text-sm font-mono text-dark-300">
            {data?.ligacoesHoje ?? 0}/{data?.metaLigacoesDia ?? 25}
          </span>
        </div>
        <BarraProgresso percentual={data?.percentualMetaLigacoes ?? 0} destaque={(data?.percentualMetaLigacoes ?? 0) >= 100} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📈 Suas vendas (últimos 14 dias)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data?.historico ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
              <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Line type="monotone" dataKey="vendas" name="Vendas" stroke={COR_VENDAS} strokeWidth={2} dot={{ r: 2 }}>
                <LabelList dataKey="vendas" position="top" fill="#898781" fontSize={10} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📞 Suas ligações (últimos 14 dias)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data?.historico ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
              <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Line type="monotone" dataKey="contatos" name="Contatos" stroke={COR_CONTATOS} strokeWidth={2} dot={{ r: 2 }}>
                <LabelList dataKey="contatos" position="top" fill="#898781" fontSize={10} />
              </Line>
            </LineChart>
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
