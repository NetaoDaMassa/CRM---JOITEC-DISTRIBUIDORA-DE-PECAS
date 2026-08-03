import { memo, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { formatElapsed } from '../lib/utils'
import AvatarMeta from '../components/ui/AvatarMeta'
import { useCelebrarMeta } from '../lib/useCelebrarMeta'
import CelebracaoPopup from '../components/ui/CelebracaoPopup'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PainelData = RouterOutputs['painel']['resumo']

// Cores validadas (script do skill de dataviz) contra a superfície escura real
// dos cards (#111e2d): azul neutro pra magnitude (vendas), âmbar pra
// contatos/ligações e verde "good" só quando bate a meta (cor de status,
// nunca usada como identidade de série). Âmbar vs verde tem ΔE 0.7 pra
// daltonismo vermelho-verde (praticamente idêntico) — não dá pra resolver
// trocando o matiz (qualquer cor quente vs verde falha do mesmo jeito). Um
// label customizado direto na barra pra marcar "bateu a meta" quebrava a
// renderização inteira do gráfico no recharts 3 (bug de upstream, não algo
// pra contornar aqui) — a codificação secundária fica por conta da tabela
// logo abaixo de cada gráfico, que já mostra número e emoji (🎯/🎉), nunca só
// a cor sozinha.
const COR_VENDAS = '#3987e5'
const COR_CONTATOS = '#c2691a'
const COR_META_BATIDA = '#0ca30c'

const SEGUNDOS_POR_SLIDE = 30

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function TooltipGrafico({
  active,
  payload,
  formatarValor,
}: {
  active?: boolean
  payload?: { payload: { nome: string; valor: number } }[]
  formatarValor: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const { nome, valor } = payload[0].payload
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium">{nome}</p>
      <p className="text-dark-400">{formatarValor(valor)}</p>
    </div>
  )
}

function TooltipHistorico({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
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

// Faturamento total da empresa não pode aparecer no painel de TV (fica visível
// pra qualquer um que passar perto) — por isso esse tile só recebe `quantidade`
// nos usos atuais (vendas hoje/mês agregadas), sem valor/ticketMedio.
function StatTile({ titulo, quantidade, valor, ticketMedio }: { titulo: string; quantidade: number; valor?: number; ticketMedio?: number }) {
  const mostrarFinanceiro = valor != null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6">
      <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">{titulo}</p>
      <p className="text-4xl font-bold text-dark-50 mt-1 font-mono tabular-nums">
        {mostrarFinanceiro ? formatarMoeda(valor as number) : quantidade}
      </p>
      {mostrarFinanceiro ? (
        <div className="flex items-center gap-5 mt-3 pt-3 border-t border-dark-700/60">
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Qtde</p>
            <p className="text-sm font-semibold text-dark-200 font-mono">{quantidade}</p>
          </div>
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-wide">Ticket médio</p>
            <p className="text-sm font-semibold text-dark-200 font-mono">{formatarMoeda(ticketMedio as number)}</p>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-dark-500 uppercase tracking-wide mt-3 pt-3 border-t border-dark-700/60">vendas fechadas</p>
      )}
    </div>
  )
}

function LabelUltimoPonto({
  x,
  y,
  index,
  value,
  ultimoIndice,
  formatarValor,
  cor,
}: {
  x?: number
  y?: number
  index?: number
  value?: number
  ultimoIndice: number
  formatarValor: (v: number) => string
  cor: string
}) {
  if (index !== ultimoIndice || x == null || y == null || value == null) return null
  return (
    <text x={x} y={y - 12} textAnchor="middle" fill={cor} fontSize={13} fontWeight={700}>
      {formatarValor(value)}
    </text>
  )
}

// Mesma ideia do LabelUltimoPonto, mas pra barra horizontal: o valor aparece
// escrito logo depois da ponta da barra. Usar `<LabelList>` direto no `<Bar>`
// quebra a renderização inteira do gráfico no recharts 3 (bug de upstream,
// ver comentário acima) — por isso o valor é desenhado via função customizada
// no próprio `label` do `<Bar>`, do mesmo jeito que já funciona nos LineChart.
function LabelFimDaBarra({
  x,
  y,
  width,
  height,
  value,
  formatarValor,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
  value?: number
  formatarValor: (v: number) => string
}) {
  if (x == null || y == null || width == null || height == null || value == null) return null
  return (
    <text x={x + width + 6} y={y + height / 2} dy={4} fill="#c3c2b7" fontSize={11}>
      {formatarValor(value)}
    </text>
  )
}

// Memoizados: o relógio no topo do painel atualiza o estado a cada 1s, e sem
// memo isso re-renderiza (e recria os arrays de dados dos gráficos) toda hora
// — o recharts trata isso como dado novo e reinicia a animação de entrada das
// barras a cada tick, fazendo elas piscarem entre renderizadas e vazias.
const SlideVisaoGeral = memo(function SlideVisaoGeral({ data }: { data: PainelData }) {
  const meta = data.metaEmpresa
  return (
    <div className="space-y-6">
      {meta && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_VENDAS}` }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-gold-400">🏢 Meta geral da empresa (mês)</h2>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full ${
                  meta.bateuMetaDia ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/20'
                }`}
              >
                Ritmo do dia {meta.percentualMetaDia}% {meta.bateuMetaDia ? '✅' : '❌'}
              </span>
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full ${
                  meta.bateuMetaFaturamento ? 'text-gold-400 bg-gold-900/20' : 'text-dark-400 bg-dark-700'
                }`}
              >
                Mês {meta.percentualMetaFaturamento}% {meta.bateuMetaFaturamento ? '✅' : ''}
              </span>
            </div>
          </div>
          <p className="text-4xl font-bold text-dark-50 font-mono tabular-nums">
            {meta.percentualMetaFaturamento}% <span className="text-lg text-dark-400 font-normal">da meta do mês</span>
          </p>
          <div className="h-3 bg-dark-900 rounded-full mt-4 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, meta.percentualMetaFaturamento)}%`,
                background: meta.bateuMetaFaturamento ? COR_META_BATIDA : COR_VENDAS,
              }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <StatTile titulo="Vendas hoje" quantidade={data.vendasHoje.quantidade} />
        <StatTile titulo="Vendas no mês" quantidade={data.vendasMes.quantidade} />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_VENDAS}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gold-400">🏆 Ranking de vendas (mês) · % da meta</h2>
          <span className="text-xs font-semibold text-green-400 bg-green-900/20 px-3 py-1 rounded-full">
            🎯 {data.vendedores.filter((v) => v.bateuMetaDia).length} de {data.vendedores.length} no ritmo da meta hoje
          </span>
        </div>
        {!!data.vendedores.length && (
          <ResponsiveContainer width="100%" height={data.vendedores.length * 30 + 10}>
            <BarChart
              data={data.vendedores.map((v) => ({ nome: v.nome, valor: v.valorFechadoMes, destaque: v.bateuMetaFaturamento }))}
              layout="vertical"
              margin={{ top: 0, right: 80, bottom: 0, left: 0 }}
              barCategoryGap={6}
            >
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip content={<TooltipGrafico formatarValor={formatarMoeda} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar
                dataKey="valor"
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
                isAnimationActive={false}
                label={(props: any) => <LabelFimDaBarra {...props} formatarValor={formatarMoeda} />}
              >
                {data.vendedores.map((v) => (
                  <Cell key={v.id} fill={v.bateuMetaFaturamento ? COR_META_BATIDA : COR_VENDAS} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="border-b border-dark-600 text-dark-400 text-[11px] uppercase tracking-wide">
              <th className="text-left font-semibold py-2">Vendedor</th>
              <th className="text-right font-semibold py-2">Ticket médio</th>
              <th className="text-right font-semibold py-2">Faturamento (mês)</th>
              <th className="text-right font-semibold py-2">% da meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {data.vendedores.map((v, i) => (
              <tr key={v.id}>
                <td className="py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-dark-500 font-mono text-xs">{i + 1}º</span>
                    <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaFaturamento} festa={v.bateuMetaDia} size="sm" />
                    <span className="font-medium text-dark-100">{v.nome}</span>
                    {v.sequenciaDiasVendendo >= 2 && (
                      <span
                        className="text-[11px] font-bold text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded-full"
                        title="Dias seguidos vendendo"
                      >
                        🔥{v.sequenciaDiasVendendo}
                      </span>
                    )}
                    {v.bateuMetaDia && <span className="text-xs" title="No ritmo da meta do dia">🎯</span>}
                    {v.bateuMetaFaturamento && <span className="text-xs">🎉</span>}
                  </div>
                </td>
                <td className="text-right font-mono tabular-nums text-dark-300">{formatarMoeda(v.ticketMedioMes)}</td>
                <td className={`text-right font-mono tabular-nums ${v.bateuMetaFaturamento ? 'text-gold-400 font-semibold' : 'text-dark-100'}`}>
                  {formatarMoeda(v.valorFechadoMes)}
                </td>
                <td className="text-right font-mono tabular-nums text-dark-300">{v.percentualMetaFaturamento}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-dark-600 font-semibold">
              <td className="py-2.5 text-dark-100">Total</td>
              <td className="text-right font-mono tabular-nums text-dark-300">—</td>
              <td className="text-right font-mono tabular-nums text-dark-300">—</td>
              <td className="text-right font-mono tabular-nums text-dark-300">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
})

// Ranking mensal reseta devagar (quem começou mal o mês fica sem chance de
// virar o jogo até o mês virar) — o ranking da semana dá uma disputa nova a
// cada poucos dias, sem esperar o mês inteiro.
const SlideRankingSemanal = memo(function SlideRankingSemanal({ data }: { data: PainelData }) {
  const semanal = data.rankingSemanal
  const liderValor = semanal[0]?.valorFechadoSemana ?? 0
  const maiorEvolucao = data.rankingEvolucao[0]

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_VENDAS}` }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gold-400">📅 Ranking da semana (segunda a hoje)</h2>
        {maiorEvolucao && maiorEvolucao.evolucaoSemana > 0 && (
          <span className="text-xs font-semibold text-green-400 bg-green-900/20 px-3 py-1 rounded-full">
            📈 Quem mais evoluiu: {maiorEvolucao.nome} (+{formatarMoeda(maiorEvolucao.evolucaoSemana)} vs semana passada)
          </span>
        )}
      </div>
      {!!semanal.length && (
        <ResponsiveContainer width="100%" height={semanal.length * 30 + 10}>
          <BarChart
            data={semanal.map((v) => ({ nome: v.nome, valor: v.valorFechadoSemana }))}
            layout="vertical"
            margin={{ top: 0, right: 80, bottom: 0, left: 0 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipGrafico formatarValor={formatarMoeda} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar
              dataKey="valor"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              isAnimationActive={false}
              label={(props: any) => <LabelFimDaBarra {...props} formatarValor={formatarMoeda} />}
            >
              {semanal.map((v) => (
                <Cell key={v.id} fill={liderValor > 0 && v.valorFechadoSemana === liderValor ? COR_META_BATIDA : COR_VENDAS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="space-y-3 mt-4">
        {semanal.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3">
            <span className="w-5 text-dark-500 font-mono text-xs">{i + 1}º</span>
            <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={i === 0 && v.valorFechadoSemana > 0} festa={v.bateuMetaDia} size="sm" />
            <span className="flex-1 font-medium text-dark-100">{v.nome}</span>
            {v.sequenciaDiasVendendo >= 2 && (
              <span className="text-[11px] font-bold text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded-full">
                🔥{v.sequenciaDiasVendendo}
              </span>
            )}
            <span className="text-sm font-mono tabular-nums text-dark-100 w-24 text-right">{formatarMoeda(v.valorFechadoSemana)}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

const SlideLigacoes = memo(function SlideLigacoes({ data }: { data: PainelData }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_CONTATOS}` }}>
      <h2 className="text-lg font-semibold text-gold-400 mb-4">📞 Ranking de ligações (hoje) · % da meta</h2>
      {!!data.rankingLigacoes.length && (
        <ResponsiveContainer width="100%" height={data.rankingLigacoes.length * 32 + 10}>
          <BarChart
            data={data.rankingLigacoes.map((v) => ({ nome: v.nome, valor: v.ligacoesHoje, destaque: v.bateuMetaLigacoesHoje }))}
            layout="vertical"
            margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipGrafico formatarValor={(v) => `${v} ligação(ões)`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar
              dataKey="valor"
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
              isAnimationActive={false}
              label={(props: any) => <LabelFimDaBarra {...props} formatarValor={(v: number) => `${v}`} />}
            >
              {data.rankingLigacoes.map((v) => (
                <Cell key={v.id} fill={v.bateuMetaLigacoesHoje ? COR_META_BATIDA : COR_CONTATOS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <table className="w-full text-sm mt-4">
        <thead>
          <tr className="border-b border-dark-600 text-dark-400 text-[11px] uppercase tracking-wide">
            <th className="text-left font-semibold py-2">Vendedor</th>
            <th className="text-right font-semibold py-2">Ligações hoje</th>
            <th className="text-right font-semibold py-2">Meta</th>
            <th className="text-right font-semibold py-2">% da meta</th>
            <th className="text-right font-semibold py-2">Ligações (mês)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700/60">
          {data.rankingLigacoes.map((v, i) => (
            <tr key={v.id}>
              <td className="py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-5 text-dark-500 font-mono text-xs">{i + 1}º</span>
                  <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaLigacoesHoje} size="sm" />
                  <span className="font-medium text-dark-100">{v.nome}</span>
                  {v.bateuMetaLigacoesHoje && <span className="text-xs">🎉</span>}
                </div>
              </td>
              <td className="text-right font-mono tabular-nums text-dark-100">{v.ligacoesHoje}</td>
              <td className="text-right font-mono tabular-nums text-dark-400">{v.metaLigacoesDia}</td>
              <td
                className={`text-right font-mono tabular-nums ${
                  v.bateuMetaLigacoesHoje ? 'text-green-400 font-semibold' : 'text-dark-300'
                }`}
              >
                {v.percentualMetaLigacoes}%
              </td>
              <td className="text-right font-mono tabular-nums text-dark-400">{v.ligacoesMes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

// Fechados / (fechados + perdidos) — não fechados / total da carteira, que
// deixaria todo mundo com % minúsculo e sem diferença nenhuma (a maioria dos
// leads de qualquer vendedor ainda está intocada em "Novo"). Só entra quem
// já decidiu pelo menos 1 negócio esse mês — sem isso, 1 venda solta vira
// "100%" e engana quem está vendo de longe.
const SlideConversao = memo(function SlideConversao({ data }: { data: PainelData }) {
  const conversao = data.rankingConversao

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_META_BATIDA}` }}>
      <h2 className="text-lg font-semibold text-gold-400 mb-1">🎯 Taxa de conversão (mês)</h2>
      <p className="text-xs text-dark-500 mb-4">Fechados ÷ (fechados + perdidos) · só quem já decidiu algum negócio esse mês</p>
      {!conversao.length && <p className="text-sm text-dark-500">Ninguém fechou ou perdeu negócio ainda esse mês.</p>}
      {!!conversao.length && (
        <ResponsiveContainer width="100%" height={conversao.length * 30 + 10}>
          <BarChart
            data={conversao.map((v) => ({ nome: v.nome, valor: v.taxaConversao ?? 0 }))}
            layout="vertical"
            margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide domain={[0, 100]} />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipGrafico formatarValor={(v) => `${v}%`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar
              dataKey="valor"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              isAnimationActive={false}
              label={(props: any) => <LabelFimDaBarra {...props} formatarValor={(v: number) => `${v}%`} />}
            >
              {conversao.map((v) => (
                <Cell key={v.id} fill={(v.taxaConversao ?? 0) >= 50 ? COR_META_BATIDA : COR_VENDAS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="space-y-3 mt-4">
        {conversao.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3">
            <span className="w-5 text-dark-500 font-mono text-xs">{i + 1}º</span>
            <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} size="sm" />
            <span className="flex-1 font-medium text-dark-100">{v.nome}</span>
            <span className="text-xs text-dark-500 font-mono">
              {v.qtdVendasMes} fechado{v.qtdVendasMes !== 1 ? 's' : ''} · {v.qtdPerdidosMes} perdido{v.qtdPerdidosMes !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-mono tabular-nums text-dark-100 w-14 text-right">{v.taxaConversao}%</span>
          </div>
        ))}
      </div>
    </div>
  )
})

const SlideTendencias = memo(function SlideTendencias({ data }: { data: PainelData }) {
  return (
    <div className="space-y-6">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_VENDAS}` }}>
        <h2 className="text-lg font-semibold text-gold-400 mb-4">📈 Vendas por dia (últimos 14 dias)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.historico} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradVendas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR_VENDAS} stopOpacity={0.5} />
                <stop offset="100%" stopColor={COR_VENDAS} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
            <XAxis dataKey="dia" tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
            <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
            <Area
              type="monotone"
              dataKey="vendas"
              name="Vendas"
              stroke={COR_VENDAS}
              strokeWidth={3}
              fill="url(#gradVendas)"
              dot={{ r: 5, fill: COR_VENDAS, strokeWidth: 0 }}
              activeDot={{ r: 7 }}
              label={(props: any) => (
                <LabelUltimoPonto {...props} ultimoIndice={data.historico.length - 1} formatarValor={(v) => `${v}`} cor={COR_VENDAS} />
              )}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_CONTATOS}` }}>
        <h2 className="text-lg font-semibold text-gold-400 mb-4">📞 Clientes chamados por dia (últimos 14 dias)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.historico} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradContatos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR_CONTATOS} stopOpacity={0.5} />
                <stop offset="100%" stopColor={COR_CONTATOS} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
            <XAxis dataKey="dia" tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
            <Tooltip content={<TooltipHistorico />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
            <Area
              type="monotone"
              dataKey="contatos"
              name="Contatos"
              stroke={COR_CONTATOS}
              strokeWidth={3}
              fill="url(#gradContatos)"
              dot={{ r: 5, fill: COR_CONTATOS, strokeWidth: 0 }}
              activeDot={{ r: 7 }}
              label={(props: any) => (
                <LabelUltimoPonto {...props} ultimoIndice={data.historico.length - 1} formatarValor={(v) => `${v}`} cor={COR_CONTATOS} />
              )}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

const SlideNegociacoes = memo(function SlideNegociacoes({ data }: { data: PainelData }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6" style={{ borderLeft: `4px solid ${COR_CONTATOS}` }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gold-400">⏱ Orçamentos em aberto</h2>
        <span className="text-sm font-bold text-amber-400 bg-amber-900/20 px-3 py-1 rounded-full">
          {data.orcamentosAbertos.quantidade} propostas · {formatarMoeda(data.orcamentosAbertos.valor)}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dark-600 text-dark-400 text-[11px] uppercase tracking-wide">
            <th className="text-left font-semibold py-2">Cliente</th>
            <th className="text-left font-semibold py-2">Vendedor</th>
            <th className="text-right font-semibold py-2">Orçamento</th>
            <th className="text-right font-semibold py-2">Tempo na etapa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700/50">
          {data.negociosAbertos.map((n) => (
            <tr key={n.clienteId}>
              <td className="py-2.5 text-dark-100">{n.razaoSocial}</td>
              <td className="py-2.5 text-dark-400">{n.vendedorNome}</td>
              <td className="py-2.5 text-right font-mono tabular-nums text-amber-400">
                {n.valorOrcado != null ? formatarMoeda(n.valorOrcado) : '—'}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums text-blue-400">há {formatElapsed(n.dataEntradaEtapa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.negociosAbertos.length && <p className="text-sm text-dark-500 mt-2">Nenhuma negociação em andamento.</p>}
    </div>
  )
})

export default function PainelTV() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // `refetchIntervalInBackground: true` é essencial aqui — um painel de TV
  // fica ligado numa tela sem mouse/teclado, então a aba nunca recebe foco
  // de verdade. Sem isso, o react-query pausa o refetch automático e o
  // painel trava nos números do primeiro carregamento.
  const { data } = trpc.painel.resumo.useQuery(undefined, { refetchInterval: 15000, refetchIntervalInBackground: true })
  const { celebracao, fecharCelebracao } = useCelebrarMeta(data?.vendedores)

  const slides = [
    { titulo: 'Visão geral', render: SlideVisaoGeral },
    { titulo: 'Semana', render: SlideRankingSemanal },
    { titulo: 'Ligações', render: SlideLigacoes },
    { titulo: 'Conversão', render: SlideConversao },
    { titulo: 'Tendências', render: SlideTendencias },
    { titulo: 'Orçamentos', render: SlideNegociacoes },
  ]
  const [slideAtual, setSlideAtual] = useState(0)
  const { data: segundosPorSlide } = trpc.configuracoes.painelTvSegundosPorSlide.useQuery()

  useEffect(() => {
    const segundos = segundosPorSlide ?? SEGUNDOS_POR_SLIDE
    const id = setInterval(() => setSlideAtual((s) => (s + 1) % slides.length), segundos * 1000)
    return () => clearInterval(id)
  }, [slides.length, segundosPorSlide])

  const Slide = slides[slideAtual].render

  return (
    <div className="min-h-screen bg-dark-950 text-dark-50 p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-heading text-3xl text-gold-400 font-bold">Joitec CRM · Painel</h1>
        <div className="text-right">
          <p className="text-2xl font-mono">{relogio.toLocaleTimeString('pt-BR')}</p>
          <p className="text-sm text-dark-400">
            {relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
      </div>

      {data ? <Slide data={data} /> : <p className="text-dark-500">Carregando...</p>}

      <div className="flex items-center justify-center gap-2 mt-8">
        {slides.map((s, i) => (
          <button
            key={s.titulo}
            onClick={() => setSlideAtual(i)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              i === slideAtual ? 'bg-gold-400 text-dark-950 font-semibold' : 'bg-dark-700 text-dark-400'
            }`}
          >
            {s.titulo}
          </button>
        ))}
      </div>

      <CelebracaoPopup celebracao={celebracao} onFechar={fecharCelebracao} />
    </div>
  )
}
