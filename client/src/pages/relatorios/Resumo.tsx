import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, BadgeDollarSign, ChevronRight, Clock, FileText, MessageSquareOff, Receipt, ShoppingBag, Target, UserX, Users, XCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { BarraFiltros, formatarDataCurta, useFiltrosRelatorio } from '../../components/relatorios/filtros'
import { BarraSegmentada, KpiCard, Medidor, MiniNumero, OrigemVendas, Ranking, Secao, moeda, numero, pct } from '../../components/relatorios/blocos'
import { contarCategorias, ehAtivado } from '../../components/relatorios/atividade'
import { baseRelatorios, relatoriosPermitidos } from '../../components/relatorios/catalogo'
import ExplicacaoMetricas from '../../components/relatorios/ExplicacaoMetricas'

// Resumo dos relatórios (pedido do João, 2026-10-20): o que antes era uma
// página comprida de abas virou um painel de uma tela — números grandes com
// comparação, carteira, vendas, rankings e alertas — e cada bloco leva pro
// relatório detalhado. Admin vê a empresa (ou um vendedor); vendedor vê só
// o dele, sem rankings da equipe.

function TooltipVendas({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-400">{formatarDataCurta(label)}</p>
      <p className="text-dark-50 font-semibold">{moeda(payload[0].value)}</p>
    </div>
  )
}

export default function ResumoRelatorios() {
  const { user } = useAuth()
  const f = useFiltrosRelatorio()
  const ehAdmin = user?.role === 'admin'
  const base = baseRelatorios(user?.role)
  const { data: features } = trpc.permissoes.minhasPermissoes.useQuery(undefined, { enabled: !!user && !user.superAdmin })
  const detalhados = relatoriosPermitidos(user, features)
  const pode = (slug: string) => detalhados.some((r) => r.slug === slug)
  const linkDe = (slug: string) => (pode(slug) ? `${base}/${slug}` : undefined)

  const { data: vendas } = trpc.reports.vendas.useQuery(f.periodo)
  const { data: vendasAnt } = trpc.reports.vendas.useQuery(f.anterior)
  const { data: posit } = trpc.reports.positivacaoCarteira.useQuery(f.periodo)
  const { data: positAnt } = trpc.reports.positivacaoCarteira.useQuery(f.anterior)
  const { data: atividade } = trpc.reports.atividadeCarteira.useQuery(f.periodo)
  const { data: vendasPorDia } = trpc.reports.vendasPorDia.useQuery(f.periodo)
  const { data: positPorVendedor } = trpc.reports.positivacaoPorVendedor.useQuery(f.periodo, { enabled: ehAdmin })
  const { data: curva } = trpc.reports.curvaAbc.useQuery(f.periodo, { enabled: ehAdmin })
  const { data: orcAbertos } = trpc.reports.orcamentosAbertos.useQuery(f.filtroAtual)
  const { data: semContato } = trpc.reports.diasSemContato.useQuery({ ...f.filtroAtual, minimoDias: 30 })
  const { data: semOrcamento } = trpc.reports.clientesSemOrcamentoDias.useQuery({ ...f.filtroAtual, minimoDias: 30 })
  const { data: semVenda } = trpc.reports.clientesSemVendaDias.useQuery({ ...f.filtroAtual, minimoDias: 60 })
  const { data: itens } = trpc.reports.itensMaisComprados.useQuery(f.periodo)
  const { data: cobertura } = trpc.reports.contatosCoberturaPorVendedor.useQuery(f.periodo)
  const { data: ligacoes } = trpc.reports.ligacoesEfetividade.useQuery(f.periodo)
  const { data: perdas } = trpc.reports.motivosPerdas.useQuery(f.periodo)
  const { data: vendasMkt } = trpc.reports.vendas.useQuery({ ...f.periodo, apenasMarketing: true }, { enabled: ehAdmin })

  const segmentos = useMemo(() => contarCategorias(atividade?.clientes), [atividade])
  const totalCarteira = atividade?.clientes.length ?? 0
  const ativados = (atividade?.clientes ?? []).filter((c) => ehAtivado(c.categoria)).length
  const taxaAtivacao = totalCarteira ? (ativados / totalCarteira) * 100 : 0

  const serieVendas = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const l of vendasPorDia ?? []) mapa.set(l.data, (mapa.get(l.data) ?? 0) + l.valorTotal)
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([data, valor]) => ({ data, valor }))
  }, [vendasPorDia])

  const rankingVendedores = useMemo(() => {
    const mapa = new Map<string, { valor: number; qtd: number }>()
    for (const l of vendasPorDia ?? []) {
      const a = mapa.get(l.nome) ?? { valor: 0, qtd: 0 }
      a.valor += l.valorTotal
      a.qtd += l.quantidade
      mapa.set(l.nome, a)
    }
    return [...mapa.entries()]
      .map(([rotulo, v]) => ({ rotulo, valor: v.valor, extra: `${v.qtd} venda(s)` }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6)
  }, [vendasPorDia])

  const abc = useMemo(() => {
    const r = { A: { qtd: 0, valor: 0 }, B: { qtd: 0, valor: 0 }, C: { qtd: 0, valor: 0 } }
    for (const c of curva ?? []) {
      const k = c.classe as 'A' | 'B' | 'C'
      r[k].qtd++
      r[k].valor += c.valorTotal ?? 0
    }
    const total = r.A.valor + r.B.valor + r.C.valor
    return { ...r, total }
  }, [curva])

  const coberturaTotal = useMemo(() => {
    const carteira = (cobertura ?? []).reduce((s, l) => s + l.totalCarteira, 0)
    const contatados = (cobertura ?? []).reduce((s, l) => s + l.contatados, 0)
    return { carteira, contatados, pct: carteira ? (contatados / carteira) * 100 : 0 }
  }, [cobertura])
  const lig = useMemo(() => {
    const t = (ligacoes ?? []).reduce((s, l) => s + l.tentativas, 0)
    const e = (ligacoes ?? []).reduce((s, l) => s + l.efetivas, 0)
    return { t, e, pct: t ? (e / t) * 100 : 0 }
  }, [ligacoes])
  const orcParados = (orcAbertos?.linhas ?? []).filter((l) => (l.diasEmAberto ?? 0) > 15)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-50">{ehAdmin ? 'Relatórios' : 'Meus relatórios'}</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            Resumo de {formatarDataCurta(f.inicio)} a {formatarDataCurta(f.fim)}
            {ehAdmin && !f.vendedorId ? ' · empresa inteira' : ''}
            {!ehAdmin ? ' · só os seus clientes' : ''}
          </p>
        </div>
      </div>
      <BarraFiltros f={f} />
      <ExplicacaoMetricas chave="resumo" />

      {/* Números principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard titulo="Faturamento" icone={BadgeDollarSign} cor="#24aff4" valor={moeda(vendas?.valorTotal)} atual={vendas?.valorTotal ?? 0} anterior={vendasAnt?.valorTotal} href={linkDe('vendas')} ajuda="Vendas fechadas na Carteira + Pedidos (Odin) + histórico do SAP no período" />
        <KpiCard titulo="Vendas" icone={ShoppingBag} cor="#8b5cf6" valor={numero(vendas?.quantidade)} atual={vendas?.quantidade ?? 0} anterior={vendasAnt?.quantidade} href={linkDe('vendas')} />
        <KpiCard titulo="Ticket médio" icone={Receipt} cor="#0ea5a4" valor={moeda(vendas?.ticketMedio)} atual={vendas?.ticketMedio ?? 0} anterior={vendasAnt?.ticketMedio} href={linkDe('vendas')} />
        <KpiCard
          titulo="Positivação"
          icone={Target}
          cor="#22a861"
          valor={pct(posit?.percentual)}
          atual={posit?.percentual ?? 0}
          anterior={positAnt?.percentual}
          detalhe={`${numero(posit?.ativados)} de ${numero(posit?.totalCarteira)} clientes compraram`}
          href={linkDe('positivacao')}
          ajuda="Quantos clientes da carteira compraram no período (CNPJs vinculados contam como um)"
        />
      </div>
      <OrigemVendas origens={vendas?.porOrigem} />

      {/* Carteira + vendas */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Secao
          className="lg:col-span-3"
          titulo={`Posição da carteira em ${formatarDataCurta(f.fim)}`}
          subtitulo="Carteira categorizada pela data da última compra"
          href={linkDe('positivacao')}
          rotuloLink="Ver clientes por categoria"
        >
          <div className="grid sm:grid-cols-[200px_1fr] gap-6 items-center">
            <div>
              <p className="text-sm font-semibold text-dark-100 mb-1">Taxa de ativação</p>
              <Medidor percentual={taxaAtivacao} rotulo={`${numero(ativados)} de ${numero(totalCarteira)}`} />
            </div>
            <div>
              <p className="text-sm font-semibold text-dark-100 mb-3">Atividade da carteira</p>
              <BarraSegmentada segmentos={segmentos} />
            </div>
          </div>
        </Secao>
        <Secao className="lg:col-span-2" titulo="Faturamento por dia" subtitulo={`Total ${moeda(vendas?.valorTotal)}`} href={linkDe('vendas')}>
          {serieVendas.length ? (
            <div className="h-[210px] -ml-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieVendas} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradVendas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#24aff4" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#24aff4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                  <XAxis dataKey="data" tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)} tick={{ fill: 'var(--color-dark-400)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={18} />
                  <YAxis tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fill: 'var(--color-dark-400)', fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<TooltipVendas />} />
                  <Area type="monotone" dataKey="valor" stroke="#24aff4" strokeWidth={2.5} fill="url(#gradVendas)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-dark-500 py-16 text-center">Nenhuma venda no período.</p>
          )}
        </Secao>
      </div>

      {/* Pede atenção */}
      <div>
        <h2 className="text-[15px] font-semibold text-dark-50 mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" /> Pede atenção agora
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MiniNumero icone={MessageSquareOff} cor="#e5534b" valor={numero(semContato?.itens.length)} rotulo="Sem contato há 30+ dias" href={linkDe('clientes-parados') && `${linkDe('clientes-parados')}?tipo=contato`} />
          <MiniNumero icone={FileText} cor="#f2a516" valor={numero(semOrcamento?.itens.length)} rotulo="Sem orçamento há 30+ dias" href={linkDe('clientes-parados') && `${linkDe('clientes-parados')}?tipo=orcamento`} />
          <MiniNumero icone={UserX} cor="#e5534b" valor={numero(semVenda?.itens.length)} rotulo="Sem comprar há 60+ dias" href={linkDe('clientes-parados') && `${linkDe('clientes-parados')}?tipo=venda`} />
          <MiniNumero icone={Clock} cor="#8b5cf6" valor={numero(orcParados.length)} rotulo="Orçamentos parados +15 dias" href={linkDe('orcamentos')} />
          <MiniNumero icone={XCircle} cor="#f97316" valor={numero(perdas?.detalhes.length)} rotulo="Pedidos perdidos no período" href={linkDe('perdas')} />
        </div>
      </div>

      {/* Rankings / listas */}
      <div className="grid lg:grid-cols-3 gap-4">
        {ehAdmin ? (
          <>
            <Secao titulo="Quem mais vendeu" subtitulo="Faturamento no período" href={linkDe('vendas')}>
              <Ranking itens={rankingVendedores} formatar={moeda} />
            </Secao>
            <Secao titulo="Positivação por vendedor" subtitulo="% da carteira que comprou" href={linkDe('positivacao')}>
              <Ranking
                cor="#22a861"
                formatar={(v) => pct(v)}
                itens={(positPorVendedor ?? [])
                  .filter((v) => v.totalCarteira > 0)
                  .slice(0, 6)
                  .map((v) => ({ rotulo: v.nome, valor: v.percentual, extra: `${v.ativados}/${v.totalCarteira}` }))}
              />
            </Secao>
            <Secao titulo="Curva ABC" subtitulo="Clientes que mais faturam" href={linkDe('curva-abc')}>
              <div className="space-y-3">
                {(['A', 'B', 'C'] as const).map((k) => {
                  const cor = k === 'A' ? '#22a861' : k === 'B' ? '#f2a516' : '#9aa5b1'
                  const share = abc.total ? (abc[k].valor / abc.total) * 100 : 0
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white shrink-0" style={{ background: cor }}>
                        {k}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-sm">
                          <span className="text-dark-200">{numero(abc[k].qtd)} clientes</span>
                          <span className="text-dark-50 font-semibold">{moeda(abc[k].valor)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-dark-700 mt-1 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${share}%`, background: cor }} />
                        </div>
                        <p className="text-[11px] text-dark-500 mt-0.5">{pct(share)} do faturamento</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Secao>
          </>
        ) : (
          <Secao className="lg:col-span-1" titulo="Meus orçamentos em aberto" subtitulo={`${numero(orcAbertos?.quantidade)} · ${moeda(orcAbertos?.valorTotal)}`} href={linkDe('orcamentos')}>
            <ul className="divide-y divide-dark-700">
              {(orcAbertos?.linhas ?? []).slice(0, 6).map((o) => (
                <li key={o.clienteId}>
                  <Link to={`/vendedor/clientes/${o.clienteId}`} className="flex justify-between gap-2 py-2 text-sm hover:text-gold-400">
                    <span className="truncate text-dark-200">{o.razaoSocial}</span>
                    <span className={`shrink-0 text-xs ${(o.diasEmAberto ?? 0) > 15 ? 'text-red-500' : 'text-dark-400'}`}>
                      {moeda(o.valorOrcado)} · {o.diasEmAberto ?? 0}d
                    </span>
                  </Link>
                </li>
              ))}
              {!orcAbertos?.linhas.length && <p className="text-sm text-dark-500 py-2">Nenhum orçamento em negociação.</p>}
            </ul>
          </Secao>
        )}
        <Secao titulo="Produtos mais vendidos" subtitulo="Por quantidade no período" href={ehAdmin ? linkDe('produtos') : undefined}>
          <Ranking cor="#0ea5a4" itens={(itens ?? []).slice(0, 6).map((i) => ({ rotulo: i.descricao, valor: i.quantidadeTotal ?? 0, extra: moeda(i.valorTotal) }))} formatar={(v) => `${numero(v)} un`} />
        </Secao>
        <Secao titulo="Contatos com a carteira" subtitulo="WhatsApp, ligação e visita no mês" href={linkDe('contatos')}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Medidor percentual={coberturaTotal.pct} cor="#3b82f6" rotulo="da carteira contatada" />
              <p className="text-xs text-dark-400 text-center mt-1">
                {numero(coberturaTotal.contatados)} de {numero(coberturaTotal.carteira)}
              </p>
            </div>
            <div>
              <Medidor percentual={lig.pct} cor="#06b6d4" rotulo="ligações efetivas" />
              <p className="text-xs text-dark-400 text-center mt-1">
                {numero(lig.e)} de {numero(lig.t)}
              </p>
            </div>
          </div>
          {ehAdmin && (
            <p className="text-xs text-dark-500 mt-3 flex items-center gap-1.5">
              <Users size={13} /> Vendas de clientes de marketing: <span className="text-dark-200 font-medium">{moeda(vendasMkt?.valorTotal)}</span> ({numero(vendasMkt?.quantidade)})
            </p>
          )}
        </Secao>
      </div>

      {/* Atalhos pros detalhados */}
      {detalhados.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-dark-50 mb-3">Relatórios detalhados</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {detalhados.map((r) => (
              <Link key={r.slug} to={`${base}/${r.slug}`} className="group bg-dark-800 border border-dark-600 rounded-2xl p-4 hover:border-gold-500/60 hover:-translate-y-0.5 hover:shadow-lg transition-all">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${r.cor}1f`, color: r.cor }}>
                    <r.icone size={18} />
                  </span>
                  <p className="text-sm font-semibold text-dark-50 flex-1">{r.titulo}</p>
                  <ChevronRight size={15} className="text-dark-500 group-hover:text-gold-400" />
                </div>
                <p className="text-xs text-dark-400 mt-2 leading-relaxed">{r.descricao}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
      {ehAdmin && (
        <p className="text-xs text-dark-500">
          Vendas, curva ABC e positivação incluem o histórico importado do SAP.{' '}
          <Link to="/admin/relatorios/antigo" className="underline hover:text-dark-300">
            Abrir a tela antiga de relatórios
          </Link>
        </p>
      )}
    </div>
  )
}
