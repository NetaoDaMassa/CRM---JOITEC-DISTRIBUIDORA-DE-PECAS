import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { LayoutDashboard, ShoppingCart, Store, Coffee, ShieldCheck, Truck, AlertTriangle, PiggyBank, Search, FileSignature } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import { KpiCard, Ranking, Secao, moeda } from '../../components/relatorios/blocos'
import { EsqueletoCards } from '../../components/ui/Visual'
import { ETAPA_INFO, TIPO_INFO, dataBr, rotuloMes, useBaseCompras } from '../../lib/comprasShared'
import { usePersistedState } from '../../lib/usePersistedState'

const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const eixoY = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.', ',')}mi` : v >= 1000 ? `${Math.round(v / 1000)}mil` : String(v))

// Dashboard do setor de Compras. "Gasto" = compras com pedido emitido
// (Recebimento ou Finalizado), no mês da data do pedido.
export default function DashboardCompras() {
  const base = useBaseCompras()
  const [empresaId, setEmpresaId] = usePersistedState<number | ''>('compras:dash:empresa', '')
  const [meses, setMeses] = usePersistedState<number>('compras:dash:meses', 12)
  const { data: aux } = trpc.comprasProcesso.auxiliares.useQuery()
  const { data: d, isLoading } = trpc.comprasProcesso.dashboard.useQuery({ empresaId: empresaId || undefined, meses })

  const serie = (d?.porMes ?? []).map((m) => ({ ...m, rotulo: rotuloMes(m.mes) }))

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={20} className="text-gold-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Dashboard de Compras</h1>
            <p className="text-sm text-dark-400">Quanto o grupo gastou por mês, Revenda × Uso e Consumo, e o que está pendente.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="w-56">
            <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value ? Number(e.target.value) : '')} options={(aux?.empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))} placeholder="Todas as empresas" />
          </div>
          <div className="w-36">
            <Select
              value={meses}
              onChange={(e) => setMeses(Number(e.target.value))}
              options={[
                { value: 6, label: '6 meses' },
                { value: 12, label: '12 meses' },
                { value: 24, label: '24 meses' },
              ]}
            />
          </div>
        </div>
      </div>

      {isLoading || !d ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <EsqueletoCards quantidade={8} className="h-28" />
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              titulo="Gasto no mês"
              icone={ShoppingCart}
              cor="#24aff4"
              valor={moeda(d.mesAtual.total)}
              atual={d.mesAtual.total}
              anterior={d.mesAnterior?.total}
              inverter
              detalhe={`${d.mesAtual.qtd} compra(s) em ${rotuloMes(d.mesAtual.mes)}`}
              ajuda="Compras com pedido emitido neste mês (data do pedido), pelo valor final negociado."
            />
            <KpiCard titulo="Revenda no mês" icone={Store} cor={TIPO_INFO.revenda.cor} valor={moeda(d.mesAtual.revenda)} atual={d.mesAtual.revenda} anterior={d.mesAnterior?.revenda} inverter />
            <KpiCard titulo="Uso e Consumo no mês" icone={Coffee} cor={TIPO_INFO.uso_consumo.cor} valor={moeda(d.mesAtual.usoConsumo)} atual={d.mesAtual.usoConsumo} anterior={d.mesAnterior?.usoConsumo} inverter />
            <KpiCard
              titulo="Economia negociando (ano)"
              icone={PiggyBank}
              cor="#22a861"
              valor={moeda(d.ano.economia)}
              detalhe={`No ano: Revenda ${moeda(d.ano.revenda)} · Uso/Consumo ${moeda(d.ano.usoConsumo)}`}
              ajuda="Diferença entre o primeiro preço da cotação escolhida e o valor final negociado."
            />
            <KpiCard
              titulo="Aprovações pendentes"
              icone={ShieldCheck}
              cor="#f59e0b"
              valor={d.aprovacoesPendentes.qtd}
              detalhe={moeda(d.aprovacoesPendentes.valor)}
              href={`${base}/compras-aprovar`}
              destaque={d.aprovacoesPendentes.qtd ? 'ruim' : undefined}
            />
            <KpiCard titulo="Pedidos a emitir" icone={FileSignature} cor="#ec4899" valor={d.pedidosAEmitir.qtd} detalhe={`Aprovadas, sem pedido · ${moeda(d.pedidosAEmitir.valor)}`} href={`${base}/compras-quadro`} />
            <KpiCard
              titulo="Entregas pendentes"
              icone={Truck}
              cor="#14b8a6"
              valor={d.entregasPendentes.qtd}
              detalhe={d.entregasPendentes.atrasadas ? `${d.entregasPendentes.atrasadas} atrasada(s) · ${moeda(d.entregasPendentes.valor)}` : moeda(d.entregasPendentes.valor)}
              destaque={d.entregasPendentes.atrasadas ? 'ruim' : undefined}
              href={`${base}/compras-relatorios?aba=pendencias`}
            />
            <KpiCard
              titulo="Solicitações sem cotar"
              icone={Search}
              cor="#64748b"
              valor={d.semCotacao.qtd}
              detalhe={d.semCotacao.qtd ? `A mais antiga está há ${d.semCotacao.maisAntigaDias} dia(s)` : 'Nenhuma esperando'}
              href={`${base}/compras-quadro`}
            />
          </div>

          <Secao titulo="Total gasto por mês" subtitulo="Revenda e Uso e Consumo separados (data do pedido)" href={`${base}/compras-relatorios`}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-dark-700)" />
                  <XAxis dataKey="rotulo" tick={tick} axisLine={false} tickLine={false} />
                  <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={eixoY} width={48} />
                  <Tooltip contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} formatter={(v, nome) => [moeda(Number(v)), nome]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenda" name="Revenda" stackId="t" fill={TIPO_INFO.revenda.cor} maxBarSize={44} />
                  <Bar dataKey="usoConsumo" name="Uso e Consumo" stackId="t" fill={TIPO_INFO.uso_consumo.cor} radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Secao>

          <div className="grid lg:grid-cols-3 gap-4">
            <Secao titulo="Compras em andamento" subtitulo="Quantas estão em cada etapa agora">
              <ul className="space-y-2">
                {d.porEtapa.map((e) => {
                  const info = ETAPA_INFO[e.etapa]
                  const max = Math.max(1, ...d.porEtapa.map((x) => x.qtd))
                  return (
                    <li key={e.etapa}>
                      <div className="flex justify-between text-sm">
                        <span className="text-dark-200">{info.label}</span>
                        <span className="text-dark-400">
                          <b className="text-dark-100">{e.qtd}</b> {e.valor > 0 ? `· ${moeda(e.valor)}` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-dark-700 mt-1 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(e.qtd / max) * 100}%`, background: info.cor }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Secao>
            <Secao titulo="Maiores fornecedores" subtitulo={`Últimos ${meses} meses`}>
              <Ranking itens={d.topFornecedores.map((f) => ({ rotulo: f.nome, valor: f.total, extra: `${f.qtd} compra(s)` }))} formatar={moeda} cor="#8b5cf6" vazio="Nenhuma compra no período." />
            </Secao>
            <Secao titulo="Por categoria" subtitulo={`Últimos ${meses} meses`}>
              <Ranking itens={d.topCategorias.map((f) => ({ rotulo: f.nome, valor: f.total, extra: `${f.qtd} compra(s)` }))} formatar={moeda} cor="#0ea5a4" vazio="Nenhuma compra no período." />
            </Secao>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Secao titulo="Esperando aprovação" href={`${base}/compras-aprovar`} rotuloLink="Abrir aprovações">
              {d.aprovacoesPendentes.lista.length ? (
                <ul className="divide-y divide-dark-700">
                  {d.aprovacoesPendentes.lista.slice(0, 8).map((l) => (
                    <li key={l.id}>
                      <Link to={`${base}/compras/${l.id}`} className="flex justify-between gap-3 py-2 text-sm hover:bg-dark-700/40 rounded px-1">
                        <span className="text-dark-100 truncate">
                          <span className="text-dark-500">#{l.id}</span> {l.titulo} <span className="text-dark-500">· {l.fornecedorNome}</span>
                        </span>
                        <span className="text-dark-200 whitespace-nowrap">{moeda(l.valorFinal)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dark-400">Nada esperando aprovação.</p>
              )}
            </Secao>
            <Secao titulo="Entregas pendentes" subtitulo="Pedido feito, esperando chegar">
              {d.entregasPendentes.lista.length ? (
                <ul className="divide-y divide-dark-700">
                  {d.entregasPendentes.lista.slice(0, 8).map((l) => (
                    <li key={l.id}>
                      <Link to={`${base}/compras/${l.id}`} className="flex justify-between gap-3 py-2 text-sm hover:bg-dark-700/40 rounded px-1">
                        <span className="text-dark-100 truncate">
                          <span className="text-dark-500">#{l.id}</span> {l.titulo} <span className="text-dark-500">· {l.fornecedorNome}</span>
                        </span>
                        <span className={`whitespace-nowrap inline-flex items-center gap-1 ${l.entregaAtrasada ? 'text-red-400 font-medium' : 'text-dark-300'}`}>
                          {l.entregaAtrasada && <AlertTriangle size={13} />}
                          {l.previsaoEntrega ? dataBr(l.previsaoEntrega) : 'sem previsão'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dark-400">Nenhuma entrega pendente.</p>
              )}
            </Secao>
          </div>
        </>
      )}
    </div>
  )
}
