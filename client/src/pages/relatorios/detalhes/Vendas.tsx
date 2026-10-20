import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BadgeDollarSign, Clock, FileText, Megaphone, Receipt, ShoppingBag, XCircle, Building2 } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import { Abas, Etiqueta, KpiCard, Ranking, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'

const CORES = ['#24aff4', '#f97316', '#22a861', '#8b5cf6', '#e5534b', '#f2a516', '#0ea5a4', '#ec4899', '#64748b', '#3a86d6']
const eixoY = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))
const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

// ── Vendas ──────────────────────────────────────────────────────────────
export function Vendas({ f, simples, mostrarResumo }: PropsDetalhe) {
  const { data: vendas } = trpc.reports.vendas.useQuery(f.periodo)
  const { data: vendasAnt } = trpc.reports.vendas.useQuery(f.anterior)
  const { data: mkt } = trpc.reports.vendas.useQuery({ ...f.periodo, apenasMarketing: true })
  const { data: mktAnt } = trpc.reports.vendas.useQuery({ ...f.anterior, apenasMarketing: true })
  const { data: porDia, isLoading } = trpc.reports.vendasPorDia.useQuery(f.periodo)
  const [visao, setVisao] = useState<'geral' | 'vendedor'>('geral')
  const [tabela, setTabela] = useState<'vendedor' | 'dia'>(simples ? 'dia' : 'vendedor')

  const { serie, nomes, porVendedor, dias } = useMemo(() => {
    const nomesSet = new Set<string>()
    const porData = new Map<string, Record<string, number | string>>()
    const vend = new Map<string, { nome: string; qtd: number; valor: number }>()
    const diasMap = new Map<string, { data: string; qtd: number; valor: number }>()
    for (const l of porDia ?? []) {
      nomesSet.add(l.nome)
      const linha = porData.get(l.data) ?? { data: l.data, total: 0 }
      linha[l.nome] = ((linha[l.nome] as number) ?? 0) + l.valorTotal
      linha.total = (linha.total as number) + l.valorTotal
      porData.set(l.data, linha)
      const v = vend.get(l.nome) ?? { nome: l.nome, qtd: 0, valor: 0 }
      v.qtd += l.quantidade
      v.valor += l.valorTotal
      vend.set(l.nome, v)
      const d = diasMap.get(l.data) ?? { data: l.data, qtd: 0, valor: 0 }
      d.qtd += l.quantidade
      d.valor += l.valorTotal
      diasMap.set(l.data, d)
    }
    const total = [...vend.values()].reduce((s, v) => s + v.valor, 0)
    return {
      serie: [...porData.values()].sort((a, b) => (a.data < b.data ? -1 : 1)),
      nomes: [...nomesSet],
      porVendedor: [...vend.values()].map((v) => ({ ...v, ticket: v.qtd ? v.valor / v.qtd : 0, share: total ? (v.valor / total) * 100 : 0 })),
      dias: [...diasMap.values()].map((d) => ({ ...d, ticket: d.qtd ? d.valor / d.qtd : 0 })),
    }
  }, [porDia])

  type V = (typeof porVendedor)[number]
  type D = (typeof dias)[number]
  const colVend: Coluna<V>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (v) => v.nome, render: (v) => <span className="font-medium text-dark-50">{v.nome}</span> },
    { id: 'qtd', rotulo: 'Vendas', valor: (v) => v.qtd, formato: 'numero', somar: true },
    { id: 'valor', rotulo: 'Faturamento', valor: (v) => v.valor, formato: 'moeda', somar: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (v) => v.ticket, formato: 'moeda' },
    {
      id: 'share',
      rotulo: '% do total',
      valor: (v) => Math.round(v.share * 10) / 10,
      formato: 'pct',
      render: (v) => (
        <span className="inline-flex items-center gap-2 justify-end">
          <span className="w-20 h-1.5 rounded-full bg-dark-700 overflow-hidden">
            <span className="block h-full bg-gold-400 rounded-full" style={{ width: `${v.share}%` }} />
          </span>
          {pct(v.share)}
        </span>
      ),
    },
  ]
  const colDia: Coluna<D>[] = [
    { id: 'data', rotulo: 'Dia', valor: (d) => d.data, formato: 'data' },
    { id: 'qtd', rotulo: 'Vendas', valor: (d) => d.qtd, formato: 'numero', somar: true },
    { id: 'valor', rotulo: 'Faturamento', valor: (d) => d.valor, formato: 'moeda', somar: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (d) => d.ticket, formato: 'moeda' },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Faturamento" icone={BadgeDollarSign} valor={moeda(vendas?.valorTotal)} atual={vendas?.valorTotal ?? 0} anterior={vendasAnt?.valorTotal} />
            <KpiCard titulo="Vendas" icone={ShoppingBag} cor="#8b5cf6" valor={numero(vendas?.quantidade)} atual={vendas?.quantidade ?? 0} anterior={vendasAnt?.quantidade} />
            <KpiCard titulo="Ticket médio" icone={Receipt} cor="#0ea5a4" valor={moeda(vendas?.ticketMedio)} atual={vendas?.ticketMedio ?? 0} anterior={vendasAnt?.ticketMedio} />
            <KpiCard
              titulo="Clientes de marketing"
              icone={Megaphone}
              cor="#ec4899"
              valor={moeda(mkt?.valorTotal)}
              atual={mkt?.valorTotal ?? 0}
              anterior={mktAnt?.valorTotal}
              detalhe={`${numero(mkt?.quantidade)} venda(s)`}
              ajuda="Vendas pra clientes que vieram de marketing (leads)"
            />
          </div>
          <Secao
            titulo="Faturamento por dia"
            subtitulo={`${formatarDataCurta(f.inicio)} a ${formatarDataCurta(f.fim)}`}
            acoes={
              !simples && (
                <Abas<'geral' | 'vendedor'>
                  valor={visao}
                  onChange={setVisao}
                  opcoes={[
                    { valor: 'geral', rotulo: 'Total' },
                    { valor: 'vendedor', rotulo: 'Por vendedor' },
                  ]}
                />
              )
            }
          >
            {serie.length ? (
              <div className="h-72 -ml-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                    <XAxis dataKey="data" tickFormatter={diaMes} tick={tick} axisLine={false} tickLine={false} minTickGap={14} />
                    <YAxis tickFormatter={eixoY} tick={tick} axisLine={false} tickLine={false} width={42} />
                    <Tooltip formatter={(v) => moeda(Number(v))} labelFormatter={(d) => formatarDataCurta(String(d))} contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} />
                    {visao === 'geral' || simples ? (
                      <Bar dataKey="total" name="Faturamento" fill="#24aff4" radius={[6, 6, 0, 0]} />
                    ) : (
                      nomes.map((n, i) => <Bar key={n} dataKey={n} stackId="v" fill={CORES[i % CORES.length]} />)
                    )}
                    {visao === 'vendedor' && !simples && <Legend wrapperStyle={{ fontSize: 12 }} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-dark-500 py-16 text-center">Nenhuma venda no período.</p>
            )}
          </Secao>
        </>
      )}
      {!simples && (
        <Abas<'vendedor' | 'dia'>
          valor={tabela}
          onChange={setTabela}
          opcoes={[
            { valor: 'vendedor', rotulo: 'Por vendedor', contagem: porVendedor.length },
            { valor: 'dia', rotulo: 'Por dia', contagem: dias.length },
          ]}
        />
      )}
      {tabela === 'vendedor' && !simples ? (
        <TabelaDados id="vendas-vendedor" linhas={porVendedor} colunas={colVend} chave={(v) => v.nome} buscaEm={(v) => v.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="vendas-por-vendedor.csv" ordemInicial={{ coluna: 'valor', direcao: 'desc' }} carregando={isLoading} />
      ) : (
        <TabelaDados id="vendas-dia" linhas={dias} colunas={colDia} chave={(d) => d.data} nomeArquivo="vendas-por-dia.csv" ordemInicial={{ coluna: 'data', direcao: 'desc' }} simples={simples} carregando={isLoading} />
      )}
    </div>
  )
}

// ── Orçamentos ──────────────────────────────────────────────────────────
export function Orcamentos({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const [granularidade, setGranularidade] = useState<'dia' | 'semana' | 'mes'>('dia')
  const { data: abertos, isLoading } = trpc.reports.orcamentosAbertos.useQuery(f.filtroAtual)
  const { data: feitos } = trpc.reports.orcamentosPorVendedor.useQuery({ ...f.periodo, granularidade })
  const { data: feitosAnt } = trpc.reports.orcamentosPorVendedor.useQuery({ ...f.anterior, granularidade: 'mes' })
  const [aba, setAba] = useState<'abertos' | 'feitos'>('abertos')

  const linhas = abertos?.linhas ?? []
  const parados = linhas.filter((l) => (l.diasEmAberto ?? 0) > 15)
  const totalFeitos = (feitos ?? []).reduce((s, l) => s + l.quantidade, 0)
  const totalFeitosAnt = (feitosAnt ?? []).reduce((s, l) => s + l.quantidade, 0)

  const serie = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of feitos ?? []) m.set(l.periodo, (m.get(l.periodo) ?? 0) + l.quantidade)
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([periodo, quantidade]) => ({ periodo, quantidade }))
  }, [feitos])
  const porVendedor = useMemo(() => {
    const m = new Map<string, { nome: string; quantidade: number }>()
    for (const l of feitos ?? []) {
      const a = m.get(l.nome) ?? { nome: l.nome, quantidade: 0 }
      a.quantidade += l.quantidade
      m.set(l.nome, a)
    }
    const abertosPorNome = new Map<string, { qtd: number; valor: number }>()
    for (const l of linhas) {
      const a = abertosPorNome.get(l.vendedorNome) ?? { qtd: 0, valor: 0 }
      a.qtd++
      a.valor += l.valorOrcado ?? 0
      abertosPorNome.set(l.vendedorNome, a)
    }
    for (const nome of abertosPorNome.keys()) if (!m.has(nome)) m.set(nome, { nome, quantidade: 0 })
    return [...m.values()].map((v) => ({ ...v, abertos: abertosPorNome.get(v.nome)?.qtd ?? 0, valorAberto: abertosPorNome.get(v.nome)?.valor ?? 0 }))
  }, [feitos, linhas])

  type A = (typeof linhas)[number]
  const colAbertos: Coluna<A>[] = [
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (l: A) => l.vendedorNome }]),
    { id: 'valor', rotulo: 'Valor orçado', valor: (l) => l.valorOrcado, formato: 'moeda', somar: true },
    { id: 'desde', rotulo: 'Em negociação desde', valor: (l) => l.dataEntradaEtapa?.slice(0, 10) ?? null, formato: 'data' },
    {
      id: 'dias',
      rotulo: 'Dias em aberto',
      valor: (l) => l.diasEmAberto,
      formato: 'numero',
      render: (l) => {
        const d = l.diasEmAberto ?? 0
        return <Etiqueta cor={d > 30 ? '#e5534b' : d > 15 ? '#f2a516' : '#22a861'}>{numero(d)} dias</Etiqueta>
      },
    },
  ]
  type F = (typeof porVendedor)[number]
  const colFeitos: Coluna<F>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (v) => v.nome, render: (v) => <span className="font-medium text-dark-50">{v.nome}</span> },
    { id: 'qtd', rotulo: 'Orçamentos feitos no período', valor: (v) => v.quantidade, formato: 'numero', somar: true },
    { id: 'abertos', rotulo: 'Em aberto agora', valor: (v) => v.abertos, formato: 'numero', somar: true },
    { id: 'valorAberto', rotulo: 'Valor em aberto', valor: (v) => v.valorAberto, formato: 'moeda', somar: true },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard titulo="Em negociação agora" icone={FileText} cor="#8b5cf6" valor={numero(abertos?.quantidade)} detalhe="cards em Negociação no mês" />
            <KpiCard titulo="Valor em aberto" icone={BadgeDollarSign} valor={moeda(abertos?.valorTotal)} detalhe="soma dos valores orçados" />
            <KpiCard titulo="Parados há +15 dias" icone={Clock} cor="#e5534b" valor={numero(parados.length)} destaque={parados.length ? 'ruim' : 'bom'} detalhe={moeda(parados.reduce((s, l) => s + (l.valorOrcado ?? 0), 0))} />
            <KpiCard titulo="Orçamentos feitos" icone={FileText} cor="#0ea5a4" valor={numero(totalFeitos)} atual={totalFeitos} anterior={totalFeitosAnt} ajuda="Vezes que um card entrou em Negociação no período" />
          </div>
          <Secao
            titulo="Orçamentos feitos"
            subtitulo="Quantas vezes um card entrou em Negociação"
            acoes={
              <Abas<'dia' | 'semana' | 'mes'>
                valor={granularidade}
                onChange={setGranularidade}
                opcoes={[
                  { valor: 'dia', rotulo: 'Dia' },
                  { valor: 'semana', rotulo: 'Semana' },
                  { valor: 'mes', rotulo: 'Mês' },
                ]}
              />
            }
          >
            {serie.length ? (
              <div className="h-60 -ml-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                    <XAxis dataKey="periodo" tickFormatter={(p: string) => (p.length === 7 ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : diaMes(p))} tick={tick} axisLine={false} tickLine={false} minTickGap={14} />
                    <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
                    <Tooltip contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} />
                    <Bar dataKey="quantidade" name="Orçamentos" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-dark-500 py-12 text-center">Nenhum orçamento no período.</p>
            )}
          </Secao>
        </>
      )}
      {!simples && (
        <Abas<'abertos' | 'feitos'>
          valor={aba}
          onChange={setAba}
          opcoes={[
            { valor: 'abertos', rotulo: 'Em aberto', contagem: linhas.length },
            { valor: 'feitos', rotulo: 'Por vendedor', contagem: porVendedor.length },
          ]}
        />
      )}
      {aba === 'abertos' || simples ? (
        <TabelaDados
          id="orcamentos-abertos"
          linhas={linhas}
          colunas={colAbertos}
          chave={(l) => l.clienteId}
          buscaEm={(l) => `${l.razaoSocial} ${l.vendedorNome}`}
          placeholderBusca="Buscar cliente ou vendedor..."
          nomeArquivo="orcamentos-em-aberto.csv"
          link={(l) => `${clientesBase}/${l.clienteId}`}
          ordemInicial={{ coluna: 'dias', direcao: 'desc' }}
          simples={simples}
          carregando={isLoading}
        />
      ) : (
        <TabelaDados id="orcamentos-vendedor" linhas={porVendedor} colunas={colFeitos} chave={(v) => v.nome} buscaEm={(v) => v.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="orcamentos-por-vendedor.csv" ordemInicial={{ coluna: 'qtd', direcao: 'desc' }} />
      )}
    </div>
  )
}

// ── Produtos e mix ──────────────────────────────────────────────────────
export function Produtos({ f, mostrarResumo }: PropsDetalhe) {
  const { data: itens, isLoading } = trpc.reports.itensMaisComprados.useQuery(f.periodo)
  const { data: mix } = trpc.reports.mixProdutosPorVendedor.useQuery(f.periodo)
  const [aba, setAba] = useState<'itens' | 'mix'>('itens')
  const lista = (itens ?? []).map((i) => ({ ...i, precoMedio: i.quantidadeTotal ? (i.valorTotal ?? 0) / i.quantidadeTotal : 0 }))
  type I = (typeof lista)[number]
  type M = NonNullable<typeof mix>[number]
  const colItens: Coluna<I>[] = [
    { id: 'desc', rotulo: 'Produto', valor: (i) => i.descricao, render: (i) => <span className="font-medium text-dark-50">{i.descricao}</span> },
    { id: 'qtd', rotulo: 'Quantidade', valor: (i) => i.quantidadeTotal, formato: 'numero', somar: true },
    { id: 'valor', rotulo: 'Valor', valor: (i) => i.valorTotal, formato: 'moeda', somar: true },
    { id: 'preco', rotulo: 'Preço médio', valor: (i) => i.precoMedio, formato: 'moeda' },
  ]
  const colMix: Coluna<M>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (m) => m.nome, render: (m) => <span className="font-medium text-dark-50">{m.nome}</span> },
    { id: 'clientes', rotulo: 'Clientes que compraram', valor: (m) => m.clientesComVenda, formato: 'numero', somar: true },
    { id: 'linhas', rotulo: 'Linhas de item', valor: (m) => m.totalLinhasItem, formato: 'numero', somar: true },
    { id: 'media', rotulo: 'Itens por cliente', valor: (m) => m.mediaItensPorCliente, formato: 'numero' },
    { id: 'mediaQtd', rotulo: 'Quantidade por cliente', valor: (m) => m.mediaQuantidadePorCliente, formato: 'numero' },
  ]
  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Secao titulo="Top 8 por quantidade" subtitulo="Itens dos pedidos no período">
            <Ranking cor="#0ea5a4" itens={lista.slice(0, 8).map((i) => ({ rotulo: i.descricao, valor: i.quantidadeTotal ?? 0, extra: moeda(i.valorTotal) }))} formatar={(v) => `${numero(v)} un`} />
          </Secao>
          <Secao titulo="Mix por vendedor" subtitulo="Média de itens diferentes por cliente que comprou">
            <Ranking cor="#8b5cf6" itens={(mix ?? []).slice().sort((a, b) => b.mediaItensPorCliente - a.mediaItensPorCliente).slice(0, 8).map((m) => ({ rotulo: m.nome, valor: m.mediaItensPorCliente, extra: `${m.clientesComVenda} cliente(s)` }))} formatar={(v) => v.toLocaleString('pt-BR')} />
          </Secao>
        </div>
      )}
      <Abas<'itens' | 'mix'>
        valor={aba}
        onChange={setAba}
        opcoes={[
          { valor: 'itens', rotulo: 'Itens mais comprados', contagem: lista.length },
          { valor: 'mix', rotulo: 'Mix por vendedor', contagem: mix?.length },
        ]}
      />
      {aba === 'itens' ? (
        <TabelaDados id="produtos-itens" linhas={lista} colunas={colItens} chave={(i) => i.descricao} buscaEm={(i) => i.descricao} placeholderBusca="Buscar produto..." nomeArquivo="itens-mais-comprados.csv" ordemInicial={{ coluna: 'qtd', direcao: 'desc' }} carregando={isLoading} />
      ) : (
        <TabelaDados id="produtos-mix" linhas={mix} colunas={colMix} chave={(m) => m.vendedorId} buscaEm={(m) => m.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="mix-por-vendedor.csv" ordemInicial={{ coluna: 'media', direcao: 'desc' }} />
      )}
      <p className="text-xs text-dark-500">A lista de itens mostra os 50 mais comprados do período.</p>
    </div>
  )
}

// ── Motivos de perda ────────────────────────────────────────────────────
const CATEGORIA_PERDA: Record<string, string> = { estoque: 'Estoque', financeiro: 'Financeiro', compras: 'Compras' }

export function Perdas({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data, isLoading } = trpc.reports.motivosPerdas.useQuery(f.periodo)
  const { data: ant } = trpc.reports.motivosPerdas.useQuery(f.anterior)
  const detalhes = data?.detalhes ?? []
  const valorPerdido = detalhes.reduce((s, d) => s + (d.valorOrcado ?? 0), 0)
  type D = (typeof detalhes)[number]
  const colunas: Coluna<D>[] = [
    { id: 'data', rotulo: 'Data', valor: (d) => d.dataEntradaEtapa?.slice(0, 10) ?? null, formato: 'data' },
    { id: 'cliente', rotulo: 'Cliente', valor: (d) => d.razaoSocial, render: (d) => <span className="font-medium text-dark-50">{d.razaoSocial}</span> },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (d: D) => d.vendedorNome }]),
    { id: 'categoria', rotulo: 'Categoria', valor: (d) => (d.motivoPerdaCategoria ? CATEGORIA_PERDA[d.motivoPerdaCategoria] ?? d.motivoPerdaCategoria : 'Sem categoria') },
    { id: 'motivo', rotulo: 'Motivo', valor: (d) => d.motivoPerdaOpcao },
    { id: 'item', rotulo: 'Item', valor: (d) => d.motivoPerdaItem },
    { id: 'obs', rotulo: 'O que o vendedor escreveu', quebrar: true, valor: (d) => d.motivoPerdaObservacao, render: (d) => <span className="text-dark-300 text-xs">{d.motivoPerdaObservacao || '—'}</span> },
    { id: 'valor', rotulo: 'Valor orçado', valor: (d) => d.valorOrcado, formato: 'moeda', somar: true },
  ]
  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard titulo="Pedidos perdidos" icone={XCircle} cor="#f97316" valor={numero(detalhes.length)} atual={detalhes.length} anterior={ant?.detalhes.length} inverter />
            <KpiCard titulo="Valor orçado perdido" icone={BadgeDollarSign} cor="#e5534b" valor={moeda(valorPerdido)} />
            <KpiCard titulo="Motivo nº 1" valor={<span className="text-xl">{data?.porCategoria[0]?.categoria ? CATEGORIA_PERDA[data.porCategoria[0].categoria] ?? data.porCategoria[0].categoria : '—'}</span>} detalhe={data?.porCategoria[0] ? `${data.porCategoria[0].quantidade} perda(s)` : undefined} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Secao titulo="Por categoria">
              <Ranking cor="#f97316" itens={(data?.porCategoria ?? []).map((c) => ({ rotulo: c.categoria ? CATEGORIA_PERDA[c.categoria] ?? c.categoria : 'Sem categoria', valor: c.quantidade }))} />
            </Secao>
            <Secao titulo="Itens que mais fizeram perder">
              <Ranking cor="#e5534b" itens={(data?.porItem ?? []).slice(0, 8).map((c) => ({ rotulo: c.item ?? '—', valor: c.quantidade }))} vazio="Nenhum item informado." />
            </Secao>
          </div>
        </>
      )}
      <TabelaDados
        id="perdas"
        linhas={detalhes}
        colunas={colunas}
        chave={(d) => `${d.clienteId}-${d.dataEntradaEtapa}`}
        buscaEm={(d) => `${d.razaoSocial} ${d.vendedorNome} ${d.motivoPerdaItem ?? ''} ${d.motivoPerdaObservacao ?? ''}`}
        placeholderBusca="Buscar cliente, vendedor, item ou texto..."
        nomeArquivo="motivos-de-perda.csv"
        link={(d) => `${clientesBase}/${d.clienteId}`}
        ordemInicial={{ coluna: 'data', direcao: 'desc' }}
        simples={simples}
        carregando={isLoading}
      />
    </div>
  )
}

// ── Todas as empresas (superAdmin) ──────────────────────────────────────
export function TodasEmpresas({ f, mostrarResumo }: PropsDetalhe) {
  const entrada = { dataInicio: f.inicio, dataFim: f.fim }
  const { data: vendas, isLoading } = trpc.reports.vendasTodasEmpresas.useQuery(entrada)
  const { data: ant } = trpc.reports.vendasTodasEmpresas.useQuery({ dataInicio: f.anterior.dataInicio, dataFim: f.anterior.dataFim })
  const { data: contato } = trpc.reports.contatoCoberturaTodasEmpresas.useQuery(entrada)
  const linhas = (vendas?.porEmpresa ?? []).map((e) => {
    const c = contato?.porEmpresa.find((x) => x.empresaId === e.empresaId)
    const a = ant?.porEmpresa.find((x) => x.empresaId === e.empresaId)
    return { ...e, ticket: e.quantidade ? e.valorTotal / e.quantidade : 0, anterior: a?.valorTotal ?? 0, carteira: c?.totalCarteira ?? 0, contatados: c?.contatados ?? 0, cobertura: c?.percentual ?? 0 }
  })
  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'nome', rotulo: 'Empresa', valor: (l) => l.nome, render: (l) => <span className="font-medium text-dark-50">{l.nome}</span> },
    { id: 'qtd', rotulo: 'Vendas', valor: (l) => l.quantidade, formato: 'numero', somar: true },
    { id: 'valor', rotulo: 'Faturamento', valor: (l) => l.valorTotal, formato: 'moeda', somar: true },
    { id: 'anterior', rotulo: 'Período anterior', valor: (l) => l.anterior, formato: 'moeda', somar: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (l) => l.ticket, formato: 'moeda' },
    { id: 'carteira', rotulo: 'Carteira', valor: (l) => l.carteira, formato: 'numero', somar: true },
    { id: 'contatados', rotulo: 'Contatados', valor: (l) => l.contatados, formato: 'numero', somar: true },
    { id: 'cobertura', rotulo: '% contatada', valor: (l) => l.cobertura, formato: 'pct' },
  ]
  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard titulo="Faturamento do grupo" icone={Building2} valor={moeda(vendas?.valorTotalGeral)} atual={vendas?.valorTotalGeral ?? 0} anterior={ant?.valorTotalGeral} />
          <KpiCard titulo="Vendas" icone={ShoppingBag} cor="#8b5cf6" valor={numero(vendas?.quantidadeGeral)} atual={vendas?.quantidadeGeral ?? 0} anterior={ant?.quantidadeGeral} />
          <KpiCard titulo="Ticket médio" icone={Receipt} cor="#0ea5a4" valor={moeda(vendas?.ticketMedioGeral)} atual={vendas?.ticketMedioGeral ?? 0} anterior={ant?.ticketMedioGeral} />
          <KpiCard titulo="Carteira contatada" icone={Megaphone} cor="#3b82f6" valor={pct(contato?.percentualGeral)} detalhe={`${numero(contato?.contatadosGeral)} de ${numero(contato?.totalCarteiraGeral)} (WhatsApp/ligação)`} />
        </div>
      )}
      <TabelaDados id="todas-empresas" linhas={linhas} colunas={colunas} chave={(l) => l.empresaId} nomeArquivo="todas-as-empresas.csv" ordemInicial={{ coluna: 'valor', direcao: 'desc' }} carregando={isLoading} />
      <p className="text-xs text-dark-500">Esse relatório ignora os filtros de vendedor e região — é a soma de cada empresa inteira.</p>
    </div>
  )
}
