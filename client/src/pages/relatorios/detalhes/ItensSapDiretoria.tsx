import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Crown, Sprout, TrendingDown, Warehouse } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { moeda, numero, pct } from '../../../components/relatorios/blocos'
import type { PropsDetalhe } from './tipos'
import { classeCampo, estiloTooltip, mesLongo, mesesAtras, moedaCurta, rotuloMes } from './itensSapComum'

// "Visão da diretoria" do relatório Itens do SAP (João, 2026-11-19: "quero
// algo novo, diferente"). Uma página só, lida de cima pra baixo como uma
// história, sem tabela grande:
//   1. Manchete: quanto faturou em itens no mês e a tendência do ano.
//   2. Mapa dos itens em 4 grupos (curva A = itens que fazem 80% do
//      faturamento × subiu/caiu): carros-chefe em alta, carros-chefe em queda
//      (o alerta), crescendo, perdendo força. Clicar abre os itens do grupo.
//   3. Calor mês a mês dos 20 maiores itens (cada linha comparada com ela
//      mesma: mais escuro = melhor mês daquele item).
//   4. Dinheiro parado no estoque.
// Os detalhes continuam nas outras abas.

type Props = Pick<PropsDetalhe, 'f' | 'mostrarResumo'> & { irPara: (aba: 'evolucao' | 'pouco' | 'parado') => void }
type Grupo = 'chefeAlta' | 'chefeQueda' | 'crescendo' | 'perdendo'

const GRUPOS: Record<Grupo, { titulo: string; frase: string; cor: string; fundo: string; icone: typeof Crown }> = {
  chefeQueda: { titulo: 'Carros-chefe em queda', frase: 'Itens que mais faturam e venderam menos. É aqui que a meta se perde.', cor: '#f87171', fundo: 'from-red-500/15 to-red-500/0', icone: AlertTriangle },
  chefeAlta: { titulo: 'Carros-chefe em alta', frase: 'Itens que mais faturam e venderam mais. Manter estoque e preço.', cor: '#34d399', fundo: 'from-emerald-500/15 to-emerald-500/0', icone: Crown },
  crescendo: { titulo: 'Pequenos crescendo', frase: 'Faturam pouco, mas estão subindo. Podem virar carro-chefe.', cor: '#38bdf8', fundo: 'from-sky-500/15 to-sky-500/0', icone: Sprout },
  perdendo: { titulo: 'Pequenos perdendo força', frase: 'Faturam pouco e caíram ou pararam. Pouco impacto na meta.', cor: '#fbbf24', fundo: 'from-amber-500/15 to-amber-500/0', icone: TrendingDown },
}
const ORDEM: Grupo[] = ['chefeQueda', 'chefeAlta', 'crescendo', 'perdendo']

export function VisaoDiretoria({ f, irPara }: Props) {
  const mesAtual = hojeBrString().slice(0, 7)
  const entrada = { mesInicio: mesesAtras(mesAtual, 11), mesFim: mesAtual, vendedorId: f.periodo.vendedorId, regiao: f.periodo.regiao }
  const { data, isLoading } = trpc.reports.itensSapPorMes.useQuery(entrada)
  const estoque = trpc.reports.itensSapEstoque.useQuery()

  const meses = useMemo(() => {
    const todos = data?.meses ?? []
    const primeiro = todos.findIndex((m) => (data?.itens ?? []).some((it) => (it.meses[m]?.valor ?? 0) > 0))
    return primeiro > 0 ? todos.slice(primeiro) : todos
  }, [data])
  const fechados = meses.filter((m) => m < mesAtual)
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null)
  const b = mesEscolhido && fechados.includes(mesEscolhido) ? mesEscolhido : fechados[fechados.length - 1] ?? mesAtual
  const a = mesesAtras(b, 1)
  const [aberto, setAberto] = useState<Grupo>('chefeQueda')

  const analise = useMemo(() => {
    const itens = (data?.itens ?? []).map((it) => {
      const va = it.meses[a]?.valor ?? 0
      const vb = it.meses[b]?.valor ?? 0
      return { chave: it.chave, codigo: it.codigo, descricao: it.descricao, meses: it.meses, va, vb, dif: vb - va }
    })
    // Curva A: os itens que somam 80% do faturamento dos dois meses.
    const ordenados = [...itens].sort((x, y) => y.va + y.vb - (x.va + x.vb))
    const total = ordenados.reduce((s, l) => s + l.va + l.vb, 0)
    const curvaA = new Set<string>()
    let acumulado = 0
    for (const l of ordenados) {
      if (acumulado >= total * 0.8) break
      curvaA.add(l.chave)
      acumulado += l.va + l.vb
    }
    const grupos: Record<Grupo, typeof itens> = { chefeAlta: [], chefeQueda: [], crescendo: [], perdendo: [] }
    for (const l of itens) {
      if (!l.va && !l.vb) continue
      const chefe = curvaA.has(l.chave)
      const caiu = l.dif < 0
      grupos[chefe ? (caiu ? 'chefeQueda' : 'chefeAlta') : caiu ? 'perdendo' : 'crescendo'].push(l)
    }
    for (const g of ORDEM) grupos[g].sort((x, y) => (g === 'chefeQueda' || g === 'perdendo' ? x.dif - y.dif : y.dif - x.dif))
    const totalA = itens.reduce((s, l) => s + l.va, 0)
    const totalB = itens.reduce((s, l) => s + l.vb, 0)
    // Só meses fechados: o mês em andamento parece uma queda.
    const serie = fechados.map((m) => ({ mes: m, rotulo: rotuloMes(m), valor: (data?.itens ?? []).reduce((s, it) => s + (it.meses[m]?.valor ?? 0), 0) }))
    // Calor: 20 maiores itens dos meses fechados.
    const fechadosSet = fechados
    const top = [...(data?.itens ?? [])]
      .map((it) => ({ ...it, soma: fechadosSet.reduce((s, m) => s + (it.meses[m]?.valor ?? 0), 0) }))
      .sort((x, y) => y.soma - x.soma)
      .slice(0, 20)
    return { grupos, totalA, totalB, serie, top, qtdCurvaA: curvaA.size }
  }, [data, a, b, meses, fechados])

  const parados = useMemo(() => {
    const hoje = hojeBrString()
    const lista = (estoque.data?.itens ?? []).filter((l) => !l.ultimaVenda || Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${l.ultimaVenda}T12:00:00Z`) >= 90 * 86_400_000)
    return { qtd: lista.length, valor: lista.reduce((s, l) => s + (l.valor ?? 0), 0), top: [...lista].sort((x, y) => (y.valor ?? y.estoque) - (x.valor ?? x.estoque)).slice(0, 4) }
  }, [estoque.data])

  if (isLoading) return <div className="h-96 rounded-3xl bg-dark-800/60 animate-pulse" />
  if (!data?.itens.length) return <p className="text-sm text-dark-400">Nenhum item do SAP para esta empresa.</p>

  const variacao = analise.totalA ? ((analise.totalB - analise.totalA) / analise.totalA) * 100 : 0
  const caiu = analise.totalB < analise.totalA
  const lista = analise.grupos[aberto]
  const maxGrupo = Math.max(1, ...lista.slice(0, 8).map((l) => Math.abs(l.dif)))

  return (
    <div className="space-y-6">
      {/* 1. Manchete */}
      <section className="relative overflow-hidden rounded-3xl border border-dark-600 bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 p-6 sm:p-8">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_1.1fr] items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-dark-400">
              Faturamento em itens em
              <select value={b} onChange={(e) => setMesEscolhido(e.target.value)} className={`${classeCampo} h-8 text-dark-100`} aria-label="Mês">
                {fechados.map((m) => (
                  <option key={m} value={m}>
                    {mesLongo(m)}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-3 text-5xl sm:text-6xl font-bold tracking-tight text-dark-50">{moedaCurta(analise.totalB)}</p>
            <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${caiu ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
              {caiu ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
              {variacao > 0 ? '+' : ''}
              {pct(variacao)} em relação a {mesLongo(a)} ({moedaCurta(analise.totalA)})
            </p>
            <p className="mt-4 text-sm text-dark-300 max-w-md">
              {numero(analise.qtdCurvaA)} itens fazem 80% desse faturamento.{' '}
              {analise.grupos.chefeQueda.length > 0 && (
                <>
                  <span className="text-red-400 font-semibold">{numero(analise.grupos.chefeQueda.length)} deles caíram</span>, somando{' '}
                  <span className="text-red-400 font-semibold">{moedaCurta(analise.grupos.chefeQueda.reduce((s, l) => s + l.dif, 0))}</span>.
                </>
              )}
            </p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analise.serie} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-itens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="rotulo" tick={{ fill: 'var(--color-dark-400)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={estiloTooltip} formatter={(v) => [moeda(Number(v)), 'Faturado']} labelFormatter={(_, p) => (p?.[0]?.payload?.mes ? `${mesLongo(p[0].payload.mes)}${p[0].payload.mes === mesAtual ? ' (até hoje)' : ''}` : '')} />
                <Area type="monotone" dataKey="valor" stroke="#14b8a6" strokeWidth={2} fill="url(#grad-itens)" isAnimationActive={false} dot={(p) => {
                  const m = (p.payload as { mes: string }).mes
                  const destaque = m === a || m === b
                  return <circle key={m} cx={p.cx} cy={p.cy} r={destaque ? 5 : 2.5} fill={destaque ? '#14b8a6' : 'var(--color-dark-500)'} stroke="var(--color-dark-800)" strokeWidth={2} />
                }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* 2. Mapa dos itens */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-base font-semibold text-dark-50">Onde a venda subiu e onde caiu</h3>
          <p className="text-xs text-dark-500">{rotuloMes(a)} → {rotuloMes(b)} · clique num grupo</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {ORDEM.map((g) => {
            const G = GRUPOS[g]
            const itens = analise.grupos[g]
            const soma = itens.reduce((s, l) => s + l.dif, 0)
            const Icone = G.icone
            const ativo = aberto === g
            return (
              <button
                key={g}
                type="button"
                onClick={() => setAberto(g)}
                className={`text-left rounded-2xl border p-4 bg-gradient-to-b ${G.fundo} transition-all ${ativo ? 'border-2 shadow-lg -translate-y-0.5' : 'border-dark-600 hover:border-dark-400'}`}
                style={ativo ? { borderColor: G.cor } : undefined}
              >
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: G.cor }}>
                  <Icone size={16} /> {G.titulo}
                </span>
                <span className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-dark-50">{numero(itens.length)}</span>
                  <span className="text-sm text-dark-400">itens</span>
                </span>
                <span className={`block mt-1 text-sm font-semibold ${soma < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {soma > 0 ? '+' : ''}
                  {moedaCurta(soma)} no mês
                </span>
                <span className="block mt-2 text-xs text-dark-400 leading-relaxed">{G.frase}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-3 rounded-2xl border border-dark-600 bg-dark-800 p-4 sm:p-5">
          <p className="text-sm font-semibold mb-3" style={{ color: GRUPOS[aberto].cor }}>
            {GRUPOS[aberto].titulo} — {lista.length > 8 ? `os 8 que mais ${aberto === 'chefeQueda' || aberto === 'perdendo' ? 'caíram' : 'subiram'}` : 'todos'}
          </p>
          {lista.length ? (
            <ul className="space-y-2.5">
              {lista.slice(0, 8).map((l) => (
                <li key={l.chave} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-dark-100" title={l.descricao}>{l.descricao}</span>
                    <span className="block text-[11px] text-dark-500">
                      {rotuloMes(a)} {moedaCurta(l.va)} → {rotuloMes(b)} {moedaCurta(l.vb)}
                    </span>
                  </span>
                  <span className="hidden sm:block h-2 rounded-full bg-dark-700 overflow-hidden">
                    <span className="block h-full rounded-full" style={{ width: `${(Math.abs(l.dif) / maxGrupo) * 100}%`, background: GRUPOS[aberto].cor, opacity: 0.8 }} />
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${l.dif < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {l.dif > 0 ? '+' : ''}
                    {moedaCurta(l.dif)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dark-400">Nenhum item neste grupo.</p>
          )}
          <button type="button" onClick={() => irPara('evolucao')} className="mt-4 text-sm text-gold-400 hover:text-gold-300">
            Ver todos os itens, mês a mês →
          </button>
        </div>
      </section>

      {/* 3. Calor mês a mês */}
      <section className="rounded-2xl border border-dark-600 bg-dark-800 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h3 className="text-base font-semibold text-dark-50">Os 20 maiores itens, mês a mês</h3>
          <p className="text-xs text-dark-500">Cada linha comparada com ela mesma: quanto mais forte a cor, melhor foi o mês daquele item.</p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(180px, 2.2fr) repeat(${fechados.length}, minmax(44px, 1fr)) 80px` }}>
              <span />
              {fechados.map((m) => (
                <span key={m} className={`text-center text-[11px] ${m === a || m === b ? 'text-dark-100 font-semibold' : 'text-dark-500'}`}>
                  {rotuloMes(m)}
                </span>
              ))}
              <span className="text-right text-[11px] text-dark-500">Total</span>
              {analise.top.map((it) => {
                const max = Math.max(1, ...fechados.map((m) => it.meses[m]?.valor ?? 0))
                return (
                  <Linha key={it.chave} descricao={it.descricao} total={it.soma}>
                    {fechados.map((m) => {
                      const v = it.meses[m]?.valor ?? 0
                      const forca = Math.max(0, v) / max
                      return (
                        <span
                          key={m}
                          title={`${it.descricao}\n${mesLongo(m)}: ${moeda(v)}`}
                          className="h-7 rounded-md"
                          style={{ background: v > 0 ? `rgba(20, 184, 166, ${0.12 + forca * 0.78})` : 'var(--color-dark-700)' }}
                        />
                      )
                    })}
                  </Linha>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Estoque parado */}
      {estoque.data?.temFilial && (
        <section className="rounded-2xl border border-dark-600 bg-gradient-to-r from-purple-500/10 to-transparent p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-purple-500/15 text-purple-300 flex items-center justify-center">
                <Warehouse size={22} />
              </span>
              <div>
                <p className="text-sm text-dark-300">Parado no estoque há mais de 90 dias</p>
                <p className="text-2xl font-bold text-dark-50">
                  {estoque.data.verValor ? moedaCurta(parados.valor) : `${numero(parados.qtd)} itens`}
                  {estoque.data.verValor && <span className="ml-2 text-sm font-normal text-dark-400">em {numero(parados.qtd)} itens (custo)</span>}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => irPara('parado')} className="text-sm text-gold-400 hover:text-gold-300">
              Ver o estoque parado →
            </button>
          </div>
          {parados.top.length > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {parados.top.map((l) => (
                <div key={l.codigo} className="rounded-xl bg-dark-800/80 border border-dark-700 px-3 py-2 min-w-0">
                  <p className="truncate text-sm text-dark-100" title={l.descricao}>{l.descricao}</p>
                  <p className="text-xs text-dark-400">
                    {estoque.data!.verValor && l.valor !== null ? `${moedaCurta(l.valor)} · ` : ''}
                    {numero(l.estoque)} un · {l.ultimaVenda ? `última venda ${l.ultimaVenda.slice(8, 10)}/${l.ultimaVenda.slice(5, 7)}` : 'sem venda desde o SAP'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-dark-500">
        Valores das notas de venda do SAP (clientes do CRM), já sem devoluções e sem impostos. "Carro-chefe" = itens que somam 80% do faturamento dos dois meses. Tubos e conexões de PPR contam só na Odin Tubos. Comparação sempre entre meses fechados.
      </p>
    </div>
  )
}

function Linha({ descricao, total, children }: { descricao: string; total: number; children: ReactNode }) {
  return (
    <>
      <span className="truncate text-xs text-dark-200 self-center pr-2" title={descricao}>
        {descricao}
      </span>
      {children}
      <span className="text-right text-xs text-dark-300 self-center tabular-nums">{moedaCurta(total)}</span>
    </>
  )
}
