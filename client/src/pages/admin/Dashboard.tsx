import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { trpc } from '../../lib/trpc'
import { formatarPercentual } from '../../lib/utils'
import Button from '../../components/ui/Button'
import AvatarMeta from '../../components/ui/AvatarMeta'
import { useCelebrarMeta } from '../../lib/useCelebrarMeta'
import CelebracaoPopup from '../../components/ui/CelebracaoPopup'

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

export default function AdminDashboard() {
  const { user } = useAuth()
  const { data } = trpc.painel.resumo.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true })

  const resetMut = trpc.funil.rodarResetMensal.useMutation({
    onSuccess(data) {
      toast.success(data.criados > 0 ? `${data.criados} funil(is) criado(s) para o mês corrente.` : 'Nada pra criar — todos os clientes já têm funil este mês.')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const resumoMut = trpc.resumoDiario.rodarAgora.useMutation({
    onSuccess(data) {
      toast.success(data.criadas > 0 ? `${data.criadas} resumo(s) diário(s) enviado(s) pro sino de notificações.` : 'Nada pra enviar.')
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const top5Vendas = data?.vendedores.slice(0, 5) ?? []
  const noRitmoHoje = data?.vendedores.filter((v) => v.bateuMetaDia).length ?? 0

  const { celebracao, fecharCelebracao } = useCelebrarMeta(data?.vendedores)

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Olá, {user?.name}</h1>
        <p className="text-dark-400 text-sm">Visão geral da produção da Joitec, num relance.</p>
      </div>

      {data?.metaEmpresa && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5" style={{ borderLeft: '4px solid #24aff4' }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gold-400">🏢 Meta geral da empresa (mês)</h2>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                data.metaEmpresa.percentualMetaFaturamento >= (data.percentualIdealHoje ?? 0) ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/20'
              }`}
            >
              {data.metaEmpresa.percentualMetaFaturamento >= (data.percentualIdealHoje ?? 0) ? '✅ NO RITMO' : '❌ ABAIXO DO RITMO'}
            </span>
          </div>
          <div className="flex items-baseline gap-5">
            <p className="text-3xl font-bold text-dark-50 font-mono tabular-nums">
              {formatarPercentual(data.metaEmpresa.percentualMetaFaturamento)}%
              {data.metaEmpresa.bateuMetaFaturamento && <span className="text-lg ml-1">✅</span>}
            </p>
            <div>
              <p className="text-xl font-bold text-dark-400 font-mono tabular-nums">{formatarPercentual(data.percentualIdealHoje)}%</p>
              <p className="text-[10px] text-dark-500 uppercase tracking-wide">ideal pra hoje</p>
            </div>
          </div>
          <p className="text-sm text-dark-400 mt-1">
            {formatarMoeda(data.metaEmpresa.valorFechadoMes)} / {formatarMoeda(data.metaEmpresa.metaFaturamento)}
          </p>
          <div className="relative h-2.5 bg-dark-900 rounded-full mt-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, data.metaEmpresa.percentualMetaFaturamento)}%`,
                background: data.metaEmpresa.bateuMetaFaturamento ? COR_META_BATIDA : '#24aff4',
              }}
            />
            <div
              className="absolute top-0 h-2.5 w-0.5 bg-dark-50"
              style={{ left: `${Math.min(100, data.percentualIdealHoje ?? 0)}%` }}
              title={`Ideal pra hoje: ${data.percentualIdealHoje}%`}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
          <p className="text-xs text-dark-400">No ritmo da meta hoje</p>
          <p className="text-2xl font-bold text-gold-400">
            {noRitmoHoje}
            <span className="text-sm text-dark-400 font-normal">/{data?.vendedores.length ?? 0}</span>
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Orçamentos em aberto</p>
          <p className="text-2xl font-bold text-dark-50">{data?.orcamentosAbertos.quantidade ?? 0}</p>
          <p className="text-sm text-amber-400">{formatarMoeda(data?.orcamentosAbertos.valor ?? 0)}</p>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">🎯 Meta do dia e do mês — equipe</h2>
        <div className="space-y-1.5">
          {data?.vendedores.map((v) => {
            const falta = v.metaFaturamento ? Math.max(0, v.metaFaturamento - v.valorFechadoMes) : 0
            const vendasFaltantes = v.ticketMedioMes > 0 && falta > 0 ? Math.ceil(falta / v.ticketMedioMes) : null
            return (
            <div key={v.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg bg-dark-900/40">
              <div className="flex items-center gap-3">
                <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaFaturamento} festa={v.bateuMetaDia} size="sm" />
                <div>
                  <span className="text-dark-100 font-medium">{v.nome}</span>
                  {v.sequenciaDiasVendendo >= 2 && (
                    <span
                      className="text-[11px] font-bold text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded-full ml-2"
                      title="Dias seguidos vendendo"
                    >
                      🔥{v.sequenciaDiasVendendo}
                    </span>
                  )}
                  {vendasFaltantes !== null && (
                    <p className="text-[11px] text-dark-500">
                      Faltam ~{vendasFaltantes} venda{vendasFaltantes > 1 ? 's' : ''} pra bater a meta
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    v.percentualMetaFaturamento >= (data?.percentualIdealHoje ?? 0) ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/20'
                  }`}
                  title={`Ideal pra hoje: ${data?.percentualIdealHoje ?? 0}%`}
                >
                  {formatarPercentual(v.percentualMetaFaturamento)}% {v.percentualMetaFaturamento >= (data?.percentualIdealHoje ?? 0) ? '✅' : '❌'}
                </span>
                <span className="text-[11px] text-dark-400" title="Meta do mês">
                  ideal {formatarPercentual(data?.percentualIdealHoje)}% · meta {v.metaFaturamento ? formatarMoeda(v.metaFaturamento) : '—'}
                </span>
              </div>
            </div>
            )
          })}
          {!data?.vendedores.length && <p className="text-xs text-dark-500">Nenhum vendedor ativo.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">🏆 Top 5 vendas do mês</h2>
          <div className="space-y-2">
            {top5Vendas.map((v, i) => (
              <div key={v.id} className="flex items-center justify-between text-sm py-1">
                <span className="text-dark-200 flex items-center gap-1.5">
                  {i + 1}º {v.nome}
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      v.bateuMetaDia ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/20'
                    }`}
                    title="Meta diária (ritmo acumulado)"
                  >
                    {v.bateuMetaDia ? '✅ dia' : '❌ dia'}
                  </span>
                </span>
                <span className={v.bateuMetaFaturamento ? 'text-gold-400 font-medium' : 'text-dark-400'}>
                  {formatarMoeda(v.valorFechadoMes)} ({formatarPercentual(v.percentualMetaFaturamento)}%)
                </span>
              </div>
            ))}
            {!top5Vendas.length && <p className="text-xs text-dark-500">Nenhuma venda registrada ainda este mês.</p>}
          </div>
          <a href="/painel-tv" target="_blank" rel="noopener noreferrer" className="text-xs text-gold-400 underline mt-3 inline-block">
            Ver Painel de TV completo →
          </a>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-dark-100">⏱ Orçamentos em aberto</h2>
            <span className="text-xs font-semibold text-amber-400">{formatarMoeda(data?.orcamentosAbertos.valor ?? 0)}</span>
          </div>
          <div className="space-y-2">
            {data?.negociosAbertos.slice(0, 5).map((n) => (
              <div key={n.clienteId} className="flex items-center justify-between text-sm py-1">
                <span className="text-dark-200 truncate">{n.razaoSocial}</span>
                <span className="text-xs text-dark-400 shrink-0 ml-2">
                  {n.valorOrcado != null ? formatarMoeda(n.valorOrcado) : '—'} · {n.vendedorNome}
                </span>
              </div>
            ))}
            {!data?.negociosAbertos.length && <p className="text-xs text-dark-500">Nenhuma negociação em andamento.</p>}
          </div>
          <Link to="/admin/kanban" className="text-xs text-gold-400 underline mt-3 inline-block">
            Ver Kanban →
          </Link>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">📞 Ranking de ligações — tentativa x efetiva (hoje) e ritmo da meta (mês)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 text-dark-400 text-[11px] uppercase tracking-wide">
                <th className="text-left font-semibold py-2">Vendedor</th>
                <th className="text-right font-semibold py-2">Tentativas hoje</th>
                <th className="text-right font-semibold py-2">Efetivas hoje</th>
                <th className="text-right font-semibold py-2">% efetiva</th>
                <th className="text-right font-semibold py-2">Ritmo da meta (mês)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/60">
              {data?.rankingLigacoes.map((v) => (
                <tr key={v.id}>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaLigacoes} size="sm" />
                      <span className="text-dark-100">{v.nome}</span>
                    </div>
                  </td>
                  <td className="text-right font-mono tabular-nums text-dark-100">{v.ligacoesHoje}</td>
                  <td className="text-right font-mono tabular-nums text-dark-100">{v.ligacoesEfetivasHoje}</td>
                  <td className="text-right font-mono tabular-nums text-dark-300">{formatarPercentual(v.percentualEfetividadeHoje)}%</td>
                  <td className={`text-right font-mono tabular-nums ${v.bateuMetaLigacoes ? 'text-green-400 font-semibold' : 'text-dark-400'}`}>
                    {v.ligacoesMes}/{v.metaLigacoesAcumulada} ({formatarPercentual(v.percentualMetaLigacoes)}%) {v.bateuMetaLigacoes ? '✅' : ''}
                  </td>
                </tr>
              ))}
              {!data?.rankingLigacoes.length && (
                <tr>
                  <td colSpan={5} className="text-xs text-dark-500 py-2">Nenhum vendedor ativo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📈 Vendas da equipe (últimos 14 dias)</h2>
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
          <h2 className="text-sm font-semibold text-dark-100 mb-3">📞 Ligações da equipe (últimos 14 dias)</h2>
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

      <div className="flex flex-wrap gap-4">
        <Link to="/admin/clientes" className="text-sm text-gold-400 underline">
          Clientes →
        </Link>
        <Link to="/admin/usuarios" className="text-sm text-gold-400 underline">
          Gerenciar vendedores →
        </Link>
        <Link to="/admin/carteira" className="text-sm text-gold-400 underline">
          Atribuição de carteira →
        </Link>
        <Link to="/admin/importar" className="text-sm text-gold-400 underline">
          Importar clientes →
        </Link>
        <Link to="/admin/lixeira" className="text-sm text-gold-400 underline">
          Lixeira →
        </Link>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-4">
        <div>
          <p className="text-xs text-dark-500 mb-2">
            O reset mensal roda sozinho a cada hora, mas você pode forçar manualmente (útil logo após importar
            clientes novos, pra já criar o funil deles no mês corrente).
          </p>
          <Button size="sm" variant="secondary" onClick={() => resetMut.mutate()} loading={resetMut.isPending}>
            Rodar reset mensal agora
          </Button>
        </div>
        <div>
          <p className="text-xs text-dark-500 mb-2">
            O resumo diário é enviado sozinho (notificação no sino) a partir das 18h pra cada vendedor e pro admin.
            Forçar aqui envia na hora, útil pra testar.
          </p>
          <Button size="sm" variant="secondary" onClick={() => resumoMut.mutate()} loading={resumoMut.isPending}>
            Enviar resumo diário agora
          </Button>
        </div>
      </div>

      <CelebracaoPopup celebracao={celebracao} onFechar={fecharCelebracao} />
    </div>
  )
}
