import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingDown, DollarSign, Receipt, Target, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import { KpiCard, Ranking, Secao, moeda, numero } from '../../components/relatorios/blocos'
import { EsqueletoCards } from '../../components/ui/Visual'
import { ROTULO_CATEGORIA_PERDA, SETOR_DA_CATEGORIA } from '../../lib/motivosPerda'

// Painel de perdas (tipo Power BI) pros gerentes — João, 2026-11-27.
// Quantas perdas, quanto em R$ (valor orçado do card), por qual motivo, de
// quem, pra quem perdemos e quais itens. Clicar num motivo / vendedor filtra
// o painel inteiro. "Cadastro errado" não é perda e fica de fora.

const COR: Record<string, string> = {
  preco_concorrente: '#f59e0b',
  falta_peca: '#38bdf8',
  prazo_entrega: '#6366f1',
  restricao_credito: '#ef4444',
  sem_retorno: '#94a3b8',
  cliente_final: '#a855f7',
  adiou: '#14b8a6',
  estoque: '#0ea5e9',
  financeiro: '#f87171',
  compras: '#818cf8',
  pendente: '#eab308',
  sem_categoria: '#64748b',
}
const rotulo = (k: string) => (k === 'pendente' ? 'Aguardando vendedor reclassificar' : k === 'sem_categoria' ? 'Sem categoria' : ROTULO_CATEGORIA_PERDA[k] ?? k)

const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const eixoY = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.', ',')}mi` : v >= 1000 ? `${Math.round(v / 1000)}mil` : String(v))
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`

function mesesAtras(n: number) {
  const d = new Date(Date.now() - 3 * 3600e3)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 7)
}

export default function PainelPerdas() {
  const [periodo, setPeriodo] = useState(5) // meses pra trás além do atual
  const [todasEmpresas, setTodasEmpresas] = useState(false)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [vendedor, setVendedor] = useState<string>('')
  const de = mesesAtras(periodo)
  const ate = mesesAtras(0)
  const { data, isLoading } = trpc.motivosPerda.painel.useQuery({ de, ate, todasEmpresas })

  const base = useMemo(
    () =>
      (data?.perdas ?? []).map((p) => ({
        ...p,
        mes: p.data.slice(0, 7),
        valor: p.valor ?? 0,
        cat: p.reclassificar ? 'pendente' : p.categoria ?? 'sem_categoria',
      })),
    [data]
  )
  const vendedores = useMemo(() => [...new Set(base.map((p) => p.vendedorNome))].sort(), [base])
  const filtradas = useMemo(() => base.filter((p) => (!motivo || p.cat === motivo) && (!vendedor || p.vendedorNome === vendedor)), [base, motivo, vendedor])
  // Pro gráfico de motivo: respeita o vendedor, mas mostra todos os motivos (pra dar pra clicar em outro).
  const doVendedor = useMemo(() => base.filter((p) => !vendedor || p.vendedorNome === vendedor), [base, vendedor])

  const r = useMemo(() => {
    const soma = (l: typeof base) => l.reduce((s, p) => s + p.valor, 0)
    const agrupar = (l: typeof base, chave: (p: (typeof base)[number]) => string | null | undefined) => {
      const m = new Map<string, { qtd: number; valor: number }>()
      for (const p of l) {
        const k = chave(p)?.trim()
        if (!k) continue
        const a = m.get(k) ?? { qtd: 0, valor: 0 }
        a.qtd++
        a.valor += p.valor
        m.set(k, a)
      }
      return [...m.entries()].map(([k, v]) => ({ chave: k, ...v }))
    }
    const total = soma(filtradas)
    const comValor = filtradas.filter((p) => p.valor > 0).length
    const porMotivo = agrupar(doVendedor, (p) => p.cat).sort((a, b) => b.valor - a.valor || b.qtd - a.qtd)
    const motivoTop = agrupar(filtradas, (p) => p.cat).sort((a, b) => b.valor - a.valor || b.qtd - a.qtd)[0]

    // Evolução mês a mês, empilhado por motivo.
    const meses: string[] = []
    for (let i = periodo; i >= 0; i--) meses.push(mesesAtras(i))
    const cats = [...new Set(filtradas.map((p) => p.cat))]
    const porMes = meses.map((m) => {
      const linha: Record<string, number | string> = { mes: m, rotulo: rotuloMes(m), qtd: 0 }
      for (const c of cats) linha[c] = 0
      for (const p of filtradas)
        if (p.mes === m) {
          linha[p.cat] = (linha[p.cat] as number) + p.valor
          linha.qtd = (linha.qtd as number) + 1
        }
      return linha
    })

    const porVendedor = agrupar(filtradas, (p) => p.vendedorNome)
      .map((v) => {
        const cs = agrupar(
          filtradas.filter((p) => p.vendedorNome === v.chave),
          (p) => p.cat
        ).sort((a, b) => b.qtd - a.qtd)
        return { ...v, motivoTop: cs[0]?.chave ?? null }
      })
      .sort((a, b) => b.valor - a.valor || b.qtd - a.qtd)

    return {
      total,
      qtd: filtradas.length,
      ticket: comValor ? total / comValor : 0,
      semValor: filtradas.length - comValor,
      porMotivo,
      motivoTop,
      porMes,
      cats,
      porVendedor,
      concorrentes: agrupar(filtradas, (p) => p.concorrente).sort((a, b) => b.qtd - a.qtd || b.valor - a.valor),
      itens: agrupar(filtradas, (p) => p.item).sort((a, b) => b.qtd - a.qtd || b.valor - a.valor),
      empresas: agrupar(filtradas, (p) => p.empresaNome).sort((a, b) => b.valor - a.valor),
      maiores: [...filtradas].sort((a, b) => b.valor - a.valor).slice(0, 15),
    }
  }, [filtradas, doVendedor, periodo])

  const totalMotivos = r.porMotivo.reduce((s, m) => s + m.valor, 0)
  const multiEmpresa = r.empresas.length > 1

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingDown size={22} className="text-red-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Painel de perdas</h1>
            <p className="text-sm text-dark-400">Quanto perdemos, em R$, por qual motivo e com quem. Clique num motivo ou vendedor pra filtrar.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Link to="/admin/motivos-perda" className="px-3 py-1.5 rounded-lg text-sm border border-dark-600 text-dark-300 hover:text-dark-100">
            Ver perdido a perdido
          </Link>
          {data?.podeTodasEmpresas && (
            <label className="flex items-center gap-1.5 text-sm text-dark-300 cursor-pointer">
              <input type="checkbox" checked={todasEmpresas} onChange={(e) => setTodasEmpresas(e.target.checked)} /> Todas as empresas
            </label>
          )}
          <div className="w-48">
            <Select value={vendedor} onChange={(e) => setVendedor(e.target.value)} placeholder="Todos os vendedores" options={vendedores.map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="w-40">
            <Select
              value={periodo}
              onChange={(e) => setPeriodo(Number(e.target.value))}
              options={[
                { value: 0, label: 'Este mês' },
                { value: 2, label: 'Últimos 3 meses' },
                { value: 5, label: 'Últimos 6 meses' },
                { value: 11, label: 'Últimos 12 meses' },
              ]}
            />
          </div>
        </div>
      </div>

      {(motivo || vendedor) && (
        <div className="flex gap-2 flex-wrap">
          {motivo && (
            <button onClick={() => setMotivo(null)} className="text-xs px-2.5 py-1 rounded-full border flex items-center gap-1" style={{ borderColor: COR[motivo], color: COR[motivo] }}>
              {rotulo(motivo)} <X size={12} />
            </button>
          )}
          {vendedor && (
            <button onClick={() => setVendedor('')} className="text-xs px-2.5 py-1 rounded-full border border-gold-600/50 text-gold-300 flex items-center gap-1">
              {vendedor} <X size={12} />
            </button>
          )}
        </div>
      )}

      {isLoading || !data ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <EsqueletoCards quantidade={4} className="h-28" />
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Perdas" icone={TrendingDown} cor="#ef4444" valor={numero(r.qtd)} detalhe={`${rotuloMes(de)} a ${rotuloMes(ate)}`} />
            <KpiCard
              titulo="Valor perdido"
              icone={DollarSign}
              cor="#ef4444"
              destaque="ruim"
              valor={moeda(r.total)}
              detalhe={r.semValor ? `${r.semValor} perda(s) sem valor orçado no card` : 'Soma do valor orçado dos cards'}
              ajuda="Soma do valor orçado que estava no card quando foi marcado como perdido."
            />
            <KpiCard titulo="Ticket médio perdido" icone={Receipt} cor="#f59e0b" valor={moeda(r.ticket)} detalhe="Só perdas com valor no card" />
            <KpiCard
              titulo="Motivo que mais custou"
              icone={Target}
              cor={r.motivoTop ? COR[r.motivoTop.chave] ?? '#94a3b8' : '#94a3b8'}
              valor={<span className="text-lg">{r.motivoTop ? rotulo(r.motivoTop.chave) : '—'}</span>}
              detalhe={r.motivoTop ? `${moeda(r.motivoTop.valor)} · ${r.motivoTop.qtd} perda(s)` : undefined}
            />
          </div>

          <div className="grid lg:grid-cols-5 gap-3">
            <Secao titulo="Por motivo (R$)" subtitulo="Clique numa fatia ou na lista pra filtrar o painel" className="lg:col-span-2">
              {r.porMotivo.length === 0 ? (
                <p className="text-sm text-dark-500">Nenhuma perda no período.</p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={r.porMotivo.filter((m) => m.valor > 0)}
                          dataKey="valor"
                          nameKey="chave"
                          innerRadius="55%"
                          outerRadius="90%"
                          paddingAngle={2}
                          onClick={(d: any) => setMotivo((atual) => (atual === d.chave ? null : d.chave))}
                          cursor="pointer"
                        >
                          {r.porMotivo
                            .filter((m) => m.valor > 0)
                            .map((m) => (
                              <Cell key={m.chave} fill={COR[m.chave] ?? '#64748b'} opacity={motivo && motivo !== m.chave ? 0.3 : 1} stroke="none" />
                            ))}
                        </Pie>
                        <Tooltip contentStyle={estiloTooltip} formatter={(v: any, _n: any, it: any) => [moeda(Number(v)), rotulo(it.payload.chave)]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 mt-2">
                    {r.porMotivo.map((m) => (
                      <button
                        key={m.chave}
                        onClick={() => setMotivo((atual) => (atual === m.chave ? null : m.chave))}
                        className={`w-full flex items-center gap-2 text-xs px-2 py-1 rounded-lg hover:bg-dark-700/60 ${motivo === m.chave ? 'bg-dark-700' : ''}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COR[m.chave] ?? '#64748b' }} />
                        <span className="flex-1 text-left text-dark-200 truncate">
                          {rotulo(m.chave)}
                          {SETOR_DA_CATEGORIA[m.chave] && <span className="text-dark-500"> → {SETOR_DA_CATEGORIA[m.chave] === 'financeiro' ? 'Financeiro' : 'Compras'}</span>}
                        </span>
                        <span className="text-dark-400">{m.qtd}x</span>
                        <span className="text-dark-100 font-medium w-24 text-right">{moeda(m.valor)}</span>
                        <span className="text-dark-500 w-10 text-right">{totalMotivos ? Math.round((m.valor / totalMotivos) * 100) : 0}%</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Secao>

            <Secao titulo="Valor perdido mês a mês" subtitulo="Cada cor é um motivo" className="lg:col-span-3">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.porMes}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                    <XAxis dataKey="rotulo" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={eixoY} width={48} />
                    <Tooltip
                      contentStyle={estiloTooltip}
                      cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }}
                      formatter={(v: any, k: any) => [moeda(Number(v)), rotulo(String(k))]}
                      labelFormatter={(l: any, p: any) => `${l} · ${p?.[0]?.payload?.qtd ?? 0} perda(s)`}
                    />
                    {r.cats.map((c, i) => (
                      <Bar key={c} dataKey={c} stackId="a" fill={COR[c] ?? '#64748b'} radius={i === r.cats.length - 1 ? [4, 4, 0, 0] : undefined} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Secao>
          </div>

          <Secao titulo="Por vendedor" subtitulo="Clique no nome pra ver só as perdas dele">
            {r.porVendedor.length === 0 ? (
              <p className="text-sm text-dark-500">Nada no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-dark-400 border-b border-dark-700">
                      <th className="text-left font-medium py-2">Vendedor</th>
                      <th className="text-right font-medium py-2">Perdas</th>
                      <th className="text-right font-medium py-2">Valor perdido</th>
                      <th className="text-left font-medium py-2 pl-4 hidden md:table-cell">Motivo mais comum</th>
                      <th className="py-2 w-1/4 hidden md:table-cell" />
                    </tr>
                  </thead>
                  <tbody>
                    {r.porVendedor.map((v) => (
                      <tr key={v.chave} className="border-b border-dark-700/50">
                        <td className="py-2">
                          <button onClick={() => setVendedor((a) => (a === v.chave ? '' : v.chave))} className="text-dark-100 hover:text-gold-300 text-left">
                            {v.chave}
                          </button>
                        </td>
                        <td className="py-2 text-right text-dark-200">{v.qtd}</td>
                        <td className="py-2 text-right text-dark-50 font-medium">{moeda(v.valor)}</td>
                        <td className="py-2 pl-4 hidden md:table-cell">
                          {v.motivoTop && (
                            <span className="text-xs flex items-center gap-1.5 text-dark-300">
                              <span className="w-2 h-2 rounded-full" style={{ background: COR[v.motivoTop] ?? '#64748b' }} />
                              {rotulo(v.motivoTop)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 hidden md:table-cell">
                          <div className="h-1.5 rounded-full bg-dark-700">
                            <div className="h-1.5 rounded-full bg-red-500/80" style={{ width: `${r.porVendedor[0].valor ? (v.valor / r.porVendedor[0].valor) * 100 : 0}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>

          <div className={`grid gap-3 ${multiEmpresa ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
            <Secao titulo="Perdemos pra quem" subtitulo="Concorrentes informados em Preço / concorrente">
              <Ranking itens={r.concorrentes.slice(0, 10).map((c) => ({ rotulo: c.chave, valor: c.qtd, extra: c.valor ? moeda(c.valor) : undefined }))} cor="#f59e0b" vazio="Nenhum concorrente informado no período." />
            </Secao>
            <Secao titulo="Itens que fizeram perder" subtitulo="Falta de peça, prazo e outros com item informado">
              <Ranking itens={r.itens.slice(0, 10).map((c) => ({ rotulo: c.chave, valor: c.qtd, extra: c.valor ? moeda(c.valor) : undefined }))} cor="#38bdf8" vazio="Nenhum item informado no período." />
            </Secao>
            {multiEmpresa && (
              <Secao titulo="Por empresa">
                <Ranking itens={r.empresas.map((c) => ({ rotulo: c.chave, valor: c.valor, extra: `${c.qtd} perda(s)` }))} formatar={moeda} cor="#ef4444" />
              </Secao>
            )}
          </div>

          <Secao titulo="Maiores perdas do período" subtitulo="As 15 de maior valor com o filtro atual">
            {r.maiores.length === 0 ? (
              <p className="text-sm text-dark-500">Nada no período.</p>
            ) : (
              <div className="space-y-2">
                {r.maiores.map((p) => (
                  <div key={p.id} className="flex items-start gap-3 text-sm border-b border-dark-700/50 pb-2">
                    <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: COR[p.cat] ?? '#64748b' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-dark-100">
                        <b>{p.razaoSocial}</b> <span className="text-dark-500 text-xs">· {p.vendedorNome} · {new Date(p.data.replace(' ', 'T')).toLocaleDateString('pt-BR')}</span>
                      </p>
                      <p className="text-xs text-dark-400">
                        {rotulo(p.cat)}
                        {p.concorrente && ` · perdeu pra ${p.concorrente}`}
                        {p.item && ` · ${p.item}`}
                      </p>
                      {p.observacao && <p className="text-xs text-dark-300 mt-0.5 line-clamp-2">{p.observacao}</p>}
                    </div>
                    <span className="text-dark-50 font-medium shrink-0">{p.valor ? moeda(p.valor) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </Secao>
        </>
      )}
    </div>
  )
}
