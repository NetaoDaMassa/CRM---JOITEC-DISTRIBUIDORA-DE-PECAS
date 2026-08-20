import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { hojeBrString, primeiroDiaMesString } from '../../lib/utils'
import { paraCsv, baixarCsv } from '../../lib/csv'

function BotaoExportar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-gold-400 hover:underline shrink-0">
      Exportar CSV
    </button>
  )
}

function formatarMoeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'R$ 0,00'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const CATEGORIA_LABEL: Record<string, string> = {
  estoque: 'Estoque',
  financeiro: 'Financeiro',
  compras: 'Compras',
}

const ETAPA_LABEL_REPORT: Record<string, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  interessado: 'Interessado',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  perdido: 'Perdido',
  sem_contato: 'Sem contato',
  consumidor_final: 'Consumidor Final',
}

const REGIAO_OPTIONS = [
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

// Paleta fixa (ordem categórica não muda entre gráficos) — combina com o
// resto do app: azul já é "vendas" no Dashboard, verde/amarelo/cinza já são
// as cores de classe A/B/C usadas na lista da curva ABC.
const COR_SERIE_1 = '#3987e5' // azul
const COR_SERIE_2 = '#d95926' // laranja
const COR_SERIE_3 = '#199e70' // verde-água
const COR_CLASSE_A = '#0ca30c'
const COR_CLASSE_B = '#fab219'
const COR_CLASSE_C = '#898781'
const COR_GRID = '#2a3644'
const COR_TICK = '#898781'

function pluralizarSimples(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function TooltipPadrao({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg max-w-[240px]">
      {label && <p className="text-dark-100 font-medium mb-1 truncate">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  )
}

const ABAS = [
  { value: 'visao_geral', label: 'Visão geral', superAdminOnly: false, feature: 'relatorio_visao_geral' },
  { value: 'contatos', label: 'Contatos & Ligações', superAdminOnly: false, feature: 'relatorio_contatos' },
  { value: 'orcamentos', label: 'Orçamentos & Vendas', superAdminOnly: false, feature: 'relatorio_orcamentos' },
  { value: 'alertas', label: 'Alertas', superAdminOnly: false, feature: 'relatorio_alertas' },
  { value: 'todas_empresas', label: 'Todas as Empresas', superAdminOnly: true, feature: null },
] as const
type Aba = (typeof ABAS)[number]['value']

export default function AdminReports() {
  const { user } = useAuth()
  // Controla aba por aba dentro de Relatórios — pra admin e pra vendedor (a
  // página "Relatórios" já é reaproveitada pelos dois, ver App.tsx). Aba
  // "Todas as Empresas" nunca depende disso (é superAdminOnly, fixo).
  const { data: minhasFeaturesRelatorio } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && !user.superAdmin,
  })
  const abasPermitidas = ABAS.filter(
    (t) => (t.superAdminOnly ? user?.superAdmin : user?.superAdmin || !!minhasFeaturesRelatorio?.includes(t.feature ?? ''))
  )
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesString())
  const [dataFim, setDataFim] = useState(hojeBrString())
  const [vendedorId, setVendedorId] = useState('')
  const [regiao, setRegiao] = useState('')
  const [granularidadeOrcamentos, setGranularidadeOrcamentos] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [aba, setAba] = useState<Aba>('visao_geral')
  const [dataInicioTodas, setDataInicioTodas] = useState(primeiroDiaMesString())
  const [dataFimTodas, setDataFimTodas] = useState(hojeBrString())

  // Se a aba selecionada (ou a inicial "visao_geral") não estiver mais entre
  // as permitidas assim que a permissão carrega, pula pra primeira liberada.
  useEffect(() => {
    if (!user || (!user.superAdmin && minhasFeaturesRelatorio === undefined)) return
    if (!abasPermitidas.some((t) => t.value === aba)) setAba(abasPermitidas[0]?.value ?? 'visao_geral')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minhasFeaturesRelatorio, user?.superAdmin])

  const [buscaCurvaAbc, setBuscaCurvaAbc] = useState('')
  const [buscaContatos, setBuscaContatos] = useState('')
  const [buscaLigacoes, setBuscaLigacoes] = useState('')
  const [buscaItens, setBuscaItens] = useState('')

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })

  const periodo = {
    dataInicio,
    dataFim,
    vendedorId: vendedorId ? Number(vendedorId) : undefined,
    regiao: (regiao || undefined) as 'norte' | 'nordeste' | 'centro_oeste' | 'sudeste' | 'sul' | undefined,
  }
  const filtroAtual = { vendedorId: periodo.vendedorId, regiao: periodo.regiao }

  const { data: curvaAbc } = trpc.reports.curvaAbc.useQuery(periodo)
  const { data: positivacao } = trpc.reports.positivacaoCarteira.useQuery(periodo)
  const { data: positivacaoPorVendedor } = trpc.reports.positivacaoPorVendedor.useQuery(periodo)
  const { data: contatos } = trpc.reports.contatosPorCliente.useQuery(periodo)
  const { data: contatosCoberturaPorVendedor } = trpc.reports.contatosCoberturaPorVendedor.useQuery(periodo)
  const { data: ligacoesEfetividade } = trpc.reports.ligacoesEfetividade.useQuery(periodo)
  const { data: ligacoesPorCliente } = trpc.reports.ligacoesPorCliente.useQuery(periodo)
  const { data: mixProdutosPorVendedor } = trpc.reports.mixProdutosPorVendedor.useQuery(periodo)
  const { data: vendas } = trpc.reports.vendas.useQuery(periodo)
  const { data: vendasMarketing } = trpc.reports.vendas.useQuery({ ...periodo, apenasMarketing: true })
  const { data: diasSemContato } = trpc.reports.diasSemContato.useQuery(filtroAtual)
  const { data: orcamentosAbertos } = trpc.reports.orcamentosAbertos.useQuery(filtroAtual)
  const { data: clientesSemOrcamentoEContato } = trpc.reports.clientesSemOrcamentoEContato.useQuery(filtroAtual)
  const { data: orcamentosPorVendedor } = trpc.reports.orcamentosPorVendedor.useQuery({ ...periodo, granularidade: granularidadeOrcamentos })
  const { data: itensMaisComprados } = trpc.reports.itensMaisComprados.useQuery(periodo)
  const { data: motivosPerdas } = trpc.reports.motivosPerdas.useQuery(periodo)
  const { data: vendasTodasEmpresas } = trpc.reports.vendasTodasEmpresas.useQuery(
    { dataInicio: dataInicioTodas, dataFim: dataFimTodas },
    { enabled: aba === 'todas_empresas' && !!user?.superAdmin }
  )

  function aplicarPresetTodas(preset: 'hoje' | 'semana' | 'mes') {
    const hoje = new Date()
    const hojeStr = hojeBrString()
    if (preset === 'hoje') {
      setDataInicioTodas(hojeStr)
      setDataFimTodas(hojeStr)
    } else if (preset === 'semana') {
      const seteDiasAtras = new Date(hoje)
      seteDiasAtras.setDate(hoje.getDate() - 6)
      setDataInicioTodas(seteDiasAtras.toISOString().slice(0, 10))
      setDataFimTodas(hojeStr)
    } else {
      setDataInicioTodas(primeiroDiaMesString())
      setDataFimTodas(hojeStr)
    }
  }

  const curvaAbcFiltrada = useMemo(() => {
    const busca = buscaCurvaAbc.toLowerCase()
    return (curvaAbc ?? []).filter((c) => c.razaoSocial.toLowerCase().includes(busca) || (c.vendedorNome ?? '').toLowerCase().includes(busca))
  }, [curvaAbc, buscaCurvaAbc])
  const contatosFiltrados = useMemo(
    () => (contatos ?? []).filter((c) => c.razaoSocial.toLowerCase().includes(buscaContatos.toLowerCase())),
    [contatos, buscaContatos]
  )
  const ligacoesFiltradas = useMemo(
    () => (ligacoesPorCliente ?? []).filter((c) => c.razaoSocial.toLowerCase().includes(buscaLigacoes.toLowerCase())),
    [ligacoesPorCliente, buscaLigacoes]
  )
  const itensFiltrados = useMemo(
    () => (itensMaisComprados ?? []).filter((i) => i.descricao.toLowerCase().includes(buscaItens.toLowerCase())),
    [itensMaisComprados, buscaItens]
  )

  const classeContagem = useMemo(() => {
    const contagem = { A: 0, B: 0, C: 0 }
    for (const c of curvaAbc ?? []) contagem[c.classe as 'A' | 'B' | 'C']++
    return [
      { classe: 'Classe A', quantidade: contagem.A, cor: COR_CLASSE_A },
      { classe: 'Classe B', quantidade: contagem.B, cor: COR_CLASSE_B },
      { classe: 'Classe C', quantidade: contagem.C, cor: COR_CLASSE_C },
    ].filter((c) => c.quantidade > 0)
  }, [curvaAbc])

  const curvaAbcTop10 = useMemo(
    () => (curvaAbc ?? []).slice(0, 10).map((c) => ({ ...c, nomeCurto: c.razaoSocial.length > 22 ? c.razaoSocial.slice(0, 20) + '…' : c.razaoSocial })),
    [curvaAbc]
  )

  const itensTop10 = useMemo(
    () =>
      (itensMaisComprados ?? []).slice(0, 10).map((i) => ({
        ...i,
        nomeCurto: i.descricao.length > 24 ? i.descricao.slice(0, 22) + '…' : i.descricao,
      })),
    [itensMaisComprados]
  )

  const orcamentosPorPeriodo = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const l of orcamentosPorVendedor ?? []) mapa.set(l.periodo, (mapa.get(l.periodo) ?? 0) + l.quantidade)
    return [...mapa.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([periodo, quantidade]) => ({ periodo, quantidade }))
  }, [orcamentosPorVendedor])

  const motivosCategoriaGrafico = useMemo(() => {
    const cores: Record<string, string> = { estoque: COR_SERIE_2, financeiro: '#e34948', compras: COR_SERIE_1 }
    return (motivosPerdas?.porCategoria ?? []).map((m) => ({
      nome: m.categoria ? CATEGORIA_LABEL[m.categoria] : 'Sem categoria',
      quantidade: m.quantidade,
      cor: m.categoria ? cores[m.categoria] ?? COR_TICK : COR_TICK,
    }))
  }, [motivosPerdas])

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Relatórios</h1>
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          {user?.role === 'admin' && (
            <Select
              label="Vendedor"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos"
              options={(vendors ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          )}
          <Select label="Região" value={regiao} onChange={(e) => setRegiao(e.target.value)} placeholder="Todas" options={REGIAO_OPTIONS} />
        </div>
      </div>

      {!user?.superAdmin && minhasFeaturesRelatorio === undefined ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : abasPermitidas.length === 0 ? (
        <p className="text-dark-400 text-sm">Você ainda não tem nenhuma aba de relatório liberada. Fale com o administrador.</p>
      ) : (
        <>
      <div className="flex gap-1 border-b border-dark-700 overflow-x-auto">
        {abasPermitidas.map((t) => (
          <button
            key={t.value}
            onClick={() => setAba(t.value)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              aba === t.value ? 'border-gold-500 text-gold-400' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'visao_geral' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-500">Vendas no período</p>
              <p className="text-lg font-semibold text-dark-50">{vendas?.quantidade ?? 0}</p>
              <p className="text-xs text-dark-400">{formatarMoeda(vendas?.valorTotal)}</p>
            </div>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-500">Ticket médio</p>
              <p className="text-lg font-semibold text-dark-50">{formatarMoeda(vendas?.ticketMedio)}</p>
            </div>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
              <p className="text-xs text-dark-500">Positivação de carteira</p>
              <p className="text-lg font-semibold text-dark-50">{(positivacao?.percentual ?? 0).toFixed(1)}%</p>
              <p className="text-xs text-dark-400">
                {positivacao?.ativados ?? 0} de {positivacao?.totalCarteira ?? 0} clientes compraram
              </p>
            </div>
            <div className="bg-dark-800 border border-pink-700/40 rounded-2xl p-4">
              <p className="text-xs text-dark-500">Vendas — Clientes de Marketing</p>
              <p className="text-lg font-semibold text-dark-50">{vendasMarketing?.quantidade ?? 0}</p>
              <p className="text-xs text-dark-400">{formatarMoeda(vendasMarketing?.valorTotal)}</p>
            </div>
          </div>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-dark-100">Curva ABC de clientes</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'curva-abc.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'vendedorNome', rotulo: 'Vendedor' },
                        { chave: 'valorTotal', rotulo: 'Valor total' },
                        { chave: 'classe', rotulo: 'Classe' },
                      ],
                      curvaAbc ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-3">
              Ordena os clientes pelo quanto compraram no período. Classe A = clientes que somam até 80% do faturamento (os mais
              importantes da carteira), B = até 95%, C = os últimos 5%. Ajuda a enxergar rápido em quem focar atenção.
            </p>

            {curvaAbcTop10.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-dark-500 mb-1">Top 10 clientes por valor comprado</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={curvaAbcTop10} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
                      <XAxis type="number" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis
                        dataKey="nomeCurto"
                        type="category"
                        tick={{ fill: COR_TICK, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        width={110}
                      />
                      <Tooltip
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <TooltipPadrao
                              active={active}
                              label={payload[0].payload.razaoSocial}
                              payload={[{ name: `Classe ${payload[0].payload.classe}`, value: payload[0].payload.valorTotal, color: payload[0].payload.classe === 'A' ? COR_CLASSE_A : payload[0].payload.classe === 'B' ? COR_CLASSE_B : COR_CLASSE_C }]}
                            />
                          ) : null
                        }
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      />
                      <Bar dataKey="valorTotal" name="Valor total" radius={[0, 4, 4, 0]} barSize={14}>
                        {curvaAbcTop10.map((c) => (
                          <Cell key={c.clienteId} fill={c.classe === 'A' ? COR_CLASSE_A : c.classe === 'B' ? COR_CLASSE_B : COR_CLASSE_C} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-xs text-dark-500 mb-1">Quantos clientes em cada classe</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={classeContagem}
                        dataKey="quantidade"
                        nameKey="classe"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        label={({ value }) => value}
                        labelLine={false}
                      >
                        {classeContagem.map((c) => (
                          <Cell key={c.classe} fill={c.cor} />
                        ))}
                      </Pie>
                      <Legend
                        verticalAlign="bottom"
                        formatter={(_value, entry) => (
                          <span className="text-dark-300 text-xs">
                            {(entry?.payload as unknown as { classe: string })?.classe}
                          </span>
                        )}
                      />
                      <Tooltip content={<TooltipPadrao />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <Input
              placeholder="Buscar cliente ou vendedor..."
              value={buscaCurvaAbc}
              onChange={(e) => setBuscaCurvaAbc(e.target.value)}
              className="mb-2"
            />
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {curvaAbcFiltrada.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="text-dark-200 truncate">
                    {c.razaoSocial} <span className="text-dark-500">· {c.vendedorNome ?? 'sem vendedor'}</span>
                  </span>
                  <span className="text-dark-400 text-right shrink-0">
                    {formatarMoeda(c.valorTotal)} ·{' '}
                    <span className={c.classe === 'A' ? 'text-green-400' : c.classe === 'B' ? 'text-yellow-400' : 'text-dark-400'}>
                      Classe {c.classe}
                    </span>
                  </span>
                </div>
              ))}
              {!curvaAbcFiltrada.length && <p className="text-sm text-dark-500 py-2">Nenhuma venda fechada no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Positivação de carteira por vendedor</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'positivacao-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'totalCarteira', rotulo: 'Total na carteira' },
                        { chave: 'ativados', rotulo: 'Compraram no período' },
                        { chave: 'percentual', rotulo: '% positivação' },
                        { chave: 'contatosLigacao', rotulo: 'Contatos via ligação' },
                        { chave: 'contatosWhatsapp', rotulo: 'Contatos via WhatsApp' },
                      ],
                      positivacaoPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">De quantos clientes da carteira cada vendedor conseguiu vender no período.</p>
            {(positivacaoPorVendedor?.length ?? 0) > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(120, (positivacaoPorVendedor?.length ?? 0) * 32)}>
                <BarChart data={positivacaoPorVendedor} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="nome" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="percentual" name="% positivação" fill={COR_SERIE_1} radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1 mt-2">
              {positivacaoPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="text-dark-200 shrink-0">{v.nome}</span>
                  <span className="text-dark-400 text-right">
                    {v.ativados} de {v.totalCarteira} clientes · {v.percentual.toFixed(1)}%
                    <br />
                    <span className="text-xs">
                      📞 {pluralizarSimples(v.contatosLigacao, 'ligação', 'ligações')} · 💬{' '}
                      {pluralizarSimples(v.contatosWhatsapp, 'WhatsApp', 'WhatsApp')}
                    </span>
                  </span>
                </div>
              ))}
              {!positivacaoPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum vendedor com carteira nesse filtro.</p>}
            </div>
          </section>
        </div>
      )}

      {aba === 'contatos' && (
        <div className="space-y-6">
          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Contatos e ligações por cliente</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'contatos-por-cliente.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'totalContatos', rotulo: 'Total de contatos' },
                        { chave: 'totalLigacoes', rotulo: 'Total de ligações' },
                      ],
                      contatos ?? []
                    )
                  )
                }
              />
            </div>
            <Input placeholder="Buscar cliente..." value={buscaContatos} onChange={(e) => setBuscaContatos(e.target.value)} className="mb-2" />
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {contatosFiltrados.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{c.razaoSocial}</span>
                  <span className="text-dark-400">
                    {c.totalContatos} contato(s) · {c.totalLigacoes} ligação(ões)
                  </span>
                </div>
              ))}
              {!contatosFiltrados.length && <p className="text-sm text-dark-500 py-2">Nenhum contato registrado no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Cobertura de contatos por vendedor (WhatsApp + telefone)</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'cobertura-contatos-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'totalCarteira', rotulo: 'Total na carteira' },
                        { chave: 'contatados', rotulo: 'Contatados no período' },
                        { chave: 'semContato', rotulo: 'Sem contato' },
                        { chave: 'percentual', rotulo: '% cobertura' },
                      ],
                      contatosCoberturaPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              De quantos clientes da carteira cada vendedor conseguiu falar (ligação ou WhatsApp) no período — não conta e-mail nem visita.
            </p>
            {(contatosCoberturaPorVendedor?.length ?? 0) > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(120, (contatosCoberturaPorVendedor?.length ?? 0) * 32)}>
                <BarChart data={contatosCoberturaPorVendedor} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="nome" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="percentual" name="% cobertura" fill={COR_SERIE_2} radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1 mt-2">
              {contatosCoberturaPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.contatados} de {v.totalCarteira} clientes · {v.percentual.toFixed(1)}%
                    {v.semContato > 0 && <span className="text-amber-400"> · {v.semContato} sem contato</span>}
                  </span>
                </div>
              ))}
              {!contatosCoberturaPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum vendedor com carteira nesse filtro.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Ligações: tentativa x efetiva (por vendedor)</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'ligacoes-tentativa-x-efetiva.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'tentativas', rotulo: 'Tentativas' },
                        { chave: 'efetivas', rotulo: 'Efetivas' },
                        { chave: 'percentualEfetividade', rotulo: '% efetividade' },
                      ],
                      ligacoesEfetividade ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Efetiva = durou pelo menos {15}s (ligação automática via GoTo) ou foi marcada como "respondeu" (registro manual).
            </p>
            {(ligacoesEfetividade?.length ?? 0) > 0 && (
              <ResponsiveContainer width="100%" height={Math.max(140, (ligacoesEfetividade?.length ?? 0) * 40)}>
                <BarChart data={ligacoesEfetividade} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="nome" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Legend formatter={(value) => <span className="text-dark-300 text-xs">{value}</span>} />
                  <Bar dataKey="tentativas" name="Tentativas" fill={COR_SERIE_1} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="efetivas" name="Efetivas" fill={COR_SERIE_2} radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1 mt-2">
              {ligacoesEfetividade?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.efetivas} efetiva(s) de {v.tentativas} tentativa(s) · {v.percentualEfetividade.toFixed(1)}%
                  </span>
                </div>
              ))}
              {!ligacoesEfetividade?.length && <p className="text-sm text-dark-500 py-2">Nenhuma ligação registrada no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Ligações por cliente</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'ligacoes-por-cliente.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'tentativas', rotulo: 'Tentativas' },
                        { chave: 'efetivas', rotulo: 'Efetivas' },
                        { chave: 'pendentes', rotulo: 'Pendentes de confirmação' },
                        { chave: 'percentualEfetividade', rotulo: '% efetividade' },
                        { chave: 'duracaoMediaSegundos', rotulo: 'Duração média (s)' },
                      ],
                      ligacoesPorCliente ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Pendente = ligação sem o vendedor confirmar se atendeu, não atendeu ou caiu na caixa postal — não conta como efetiva até ser
              confirmada.
            </p>
            <Input placeholder="Buscar cliente..." value={buscaLigacoes} onChange={(e) => setBuscaLigacoes(e.target.value)} className="mb-2" />
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {ligacoesFiltradas.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="text-dark-200 truncate">{c.razaoSocial}</span>
                  <span className="text-dark-400 text-right shrink-0">
                    {c.efetivas} efetiva(s) de {c.tentativas} tentativa(s) · {c.percentualEfetividade.toFixed(1)}%
                    {c.pendentes > 0 && <span className="text-amber-400"> · {c.pendentes} pendente(s)</span>}
                    {c.duracaoMediaSegundos > 0 && ` · ${Math.round(c.duracaoMediaSegundos)}s méd.`}
                  </span>
                </div>
              ))}
              {!ligacoesFiltradas.length && <p className="text-sm text-dark-500 py-2">Nenhuma ligação registrada no período.</p>}
            </div>
          </section>
        </div>
      )}

      {aba === 'orcamentos' && (
        <div className="space-y-6">
          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Orçamentos em aberto (negociação, mês corrente)</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'orcamentos-em-aberto.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'vendedorNome', rotulo: 'Vendedor' },
                        { chave: 'valorOrcado', rotulo: 'Valor orçado' },
                        { chave: 'diasEmAberto', rotulo: 'Dias em aberto' },
                      ],
                      orcamentosAbertos?.linhas ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              {orcamentosAbertos?.quantidade ?? 0} proposta(s) em aberto · {formatarMoeda(orcamentosAbertos?.valorTotal)} no total
            </p>
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {orcamentosAbertos?.linhas.map((l) => (
                <div key={l.clienteId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{l.razaoSocial}</span>
                  <span className="text-dark-400">
                    {l.valorOrcado != null ? formatarMoeda(l.valorOrcado) : '—'} · {l.vendedorNome} ·{' '}
                    <span className={(l.diasEmAberto ?? 0) >= 15 ? 'text-amber-400' : ''}>
                      {l.diasEmAberto ?? '—'} dia{l.diasEmAberto === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
              ))}
              {!orcamentosAbertos?.linhas.length && <p className="text-sm text-dark-500 py-2">Nenhum orçamento em aberto.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-dark-100">Orçamentos feitos por vendedor</h2>
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Select
                    value={granularidadeOrcamentos}
                    onChange={(e) => setGranularidadeOrcamentos(e.target.value as 'dia' | 'semana' | 'mes')}
                    options={[
                      { value: 'dia', label: 'Por dia' },
                      { value: 'semana', label: 'Por semana' },
                      { value: 'mes', label: 'Por mês' },
                    ]}
                  />
                </div>
                <BotaoExportar
                  onClick={() =>
                    baixarCsv(
                      'orcamentos-por-vendedor.csv',
                      paraCsv(
                        [
                          { chave: 'nome', rotulo: 'Vendedor' },
                          { chave: 'periodo', rotulo: 'Período' },
                          { chave: 'quantidade', rotulo: 'Orçamentos feitos' },
                        ],
                        orcamentosPorVendedor ?? []
                      )
                    )
                  }
                />
              </div>
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Quantas vezes cada vendedor moveu um card pra "Negociação" (1º orçamento feito) — conta pela data de verdade da mudança de
              etapa, não pela última edição do card.
            </p>
            {orcamentosPorPeriodo.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={orcamentosPorPeriodo} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
                  <XAxis dataKey="periodo" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="quantidade" name="Orçamentos" fill={COR_SERIE_1} radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1 mt-2">
              {orcamentosPorVendedor?.map((l) => (
                <div key={`${l.vendedorId}-${l.periodo}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">
                    {l.nome} <span className="text-dark-500">· {l.periodo}</span>
                  </span>
                  <span className="text-dark-400">{pluralizarSimples(l.quantidade, 'orçamento', 'orçamentos')}</span>
                </div>
              ))}
              {!orcamentosPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum orçamento feito no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Mix de produtos por vendedor</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'mix-produtos-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'clientesComVenda', rotulo: 'Clientes que compraram' },
                        { chave: 'mediaItensPorCliente', rotulo: 'Média de itens diferentes por cliente' },
                        { chave: 'mediaQuantidadePorCliente', rotulo: 'Média de unidades por cliente' },
                      ],
                      mixProdutosPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Entre os clientes que compraram no período, quantos itens diferentes (e quantas unidades) cada vendedor costuma vender por
              cliente — mede o tamanho da cesta, não só se vendeu.
            </p>
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {mixProdutosPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.mediaItensPorCliente.toFixed(1)} itens/cliente · {v.mediaQuantidadePorCliente.toFixed(1)} un./cliente · {v.clientesComVenda}{' '}
                    cliente(s)
                  </span>
                </div>
              ))}
              {!mixProdutosPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhuma venda com itens no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Itens mais comprados</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'itens-mais-comprados.csv',
                    paraCsv(
                      [
                        { chave: 'descricao', rotulo: 'Item' },
                        { chave: 'quantidadeTotal', rotulo: 'Quantidade' },
                        { chave: 'valorTotal', rotulo: 'Valor total' },
                      ],
                      itensMaisComprados ?? []
                    )
                  )
                }
              />
            </div>
            {itensTop10.length > 0 && (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={itensTop10} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="nomeCurto" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={130} />
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <TooltipPadrao active={active} label={payload[0].payload.descricao} payload={[{ name: 'Quantidade', value: payload[0].payload.quantidadeTotal, color: COR_SERIE_3 }]} />
                      ) : null
                    }
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  />
                  <Bar dataKey="quantidadeTotal" name="Quantidade" fill={COR_SERIE_3} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <Input placeholder="Buscar item..." value={buscaItens} onChange={(e) => setBuscaItens(e.target.value)} className="mb-2 mt-2" />
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {itensFiltrados.map((i) => (
                <div key={i.descricao} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{i.descricao}</span>
                  <span className="text-dark-400">
                    {i.quantidadeTotal} un. · {formatarMoeda(i.valorTotal)}
                  </span>
                </div>
              ))}
              {!itensFiltrados.length && (
                <p className="text-sm text-dark-500 py-2">Nenhum item registrado no período (depende da extração de PDF do bloco 11).</p>
              )}
            </div>
          </section>
        </div>
      )}

      {aba === 'alertas' && (
        <div className="space-y-6">
          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Clientes sem orçamento e sem contato no mês</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'clientes-sem-orcamento-e-contato.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'vendedorNome', rotulo: 'Vendedor' },
                        { chave: 'etapa', rotulo: 'Etapa' },
                      ],
                      clientesSemOrcamentoEContato ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Clientes completamente intocados neste mês — zero contato registrado e nenhum orçamento lançado. Foto do mês corrente, não
              filtra por período.
            </p>
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {clientesSemOrcamentoEContato?.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{c.razaoSocial}</span>
                  <span className="text-dark-400">
                    {ETAPA_LABEL_REPORT[c.etapa] ?? c.etapa} · {c.vendedorNome}
                  </span>
                </div>
              ))}
              {!clientesSemOrcamentoEContato?.length && (
                <p className="text-sm text-dark-500 py-2">Nenhum cliente esquecido — todo mundo tem contato ou orçamento neste mês.</p>
              )}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Clientes há mais tempo sem contato</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'dias-sem-contato.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'dias', rotulo: 'Dias sem contato' },
                      ],
                      diasSemContato ?? []
                    )
                  )
                }
              />
            </div>
            <div className="divide-y divide-dark-700 max-h-72 overflow-y-auto pr-1">
              {diasSemContato?.slice(0, 20).map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{c.razaoSocial}</span>
                  <span className="text-dark-400">{c.dias} dia(s)</span>
                </div>
              ))}
              {!diasSemContato?.length && <p className="text-sm text-dark-500 py-2">Sem dados.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-dark-100 mb-3">Motivo de pedido perdido</h2>
            {motivosCategoriaGrafico.length > 0 && (
              <div className="mb-4">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={motivosCategoriaGrafico}
                      dataKey="quantidade"
                      nameKey="nome"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      label={({ value }) => value}
                      labelLine={false}
                    >
                      {motivosCategoriaGrafico.map((m) => (
                        <Cell key={m.nome} fill={m.cor} />
                      ))}
                    </Pie>
                    <Legend
                      verticalAlign="bottom"
                      formatter={(_value, entry) => (
                        <span className="text-dark-300 text-xs">{(entry?.payload as unknown as { nome: string })?.nome}</span>
                      )}
                    />
                    <Tooltip content={<TooltipPadrao />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-dark-500">Por categoria</p>
                  <BotaoExportar
                    onClick={() =>
                      baixarCsv(
                        'motivos-perda-categoria.csv',
                        paraCsv(
                          [
                            { chave: 'categoria', rotulo: 'Categoria' },
                            { chave: 'quantidade', rotulo: 'Quantidade' },
                          ],
                          (motivosPerdas?.porCategoria ?? []).map((m) => ({
                            categoria: m.categoria ? CATEGORIA_LABEL[m.categoria] : '—',
                            quantidade: m.quantidade,
                          }))
                        )
                      )
                    }
                  />
                </div>
                {motivosPerdas?.porCategoria.map((m) => (
                  <div key={m.categoria ?? 'sem categoria'} className="flex items-center justify-between text-sm py-1">
                    <span className="text-dark-200">{m.categoria ? CATEGORIA_LABEL[m.categoria] : '—'}</span>
                    <span className="text-dark-400">{m.quantidade}</span>
                  </div>
                ))}
                {!motivosPerdas?.porCategoria.length && <p className="text-sm text-dark-500">Nenhuma perda no período.</p>}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-dark-500">Por peça/item</p>
                  <BotaoExportar
                    onClick={() =>
                      baixarCsv(
                        'motivos-perda-item.csv',
                        paraCsv(
                          [
                            { chave: 'item', rotulo: 'Item' },
                            { chave: 'quantidade', rotulo: 'Quantidade' },
                          ],
                          motivosPerdas?.porItem ?? []
                        )
                      )
                    }
                  />
                </div>
                <div className="max-h-48 overflow-y-auto pr-1">
                  {motivosPerdas?.porItem.map((m) => (
                    <div key={m.item} className="flex items-center justify-between text-sm py-1">
                      <span className="text-dark-200">{m.item}</span>
                      <span className="text-dark-400">{m.quantidade}</span>
                    </div>
                  ))}
                  {!motivosPerdas?.porItem.length && <p className="text-sm text-dark-500">Nenhuma perda com peça informada.</p>}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {aba === 'todas_empresas' && user?.superAdmin && (
        <div className="space-y-6">
          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-dark-100">Vendas — todas as empresas do grupo</h2>
                <p className="text-xs text-dark-500 mt-0.5">Soma as vendas fechadas das 3 empresas juntas no período escolhido.</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1">
                  <button onClick={() => aplicarPresetTodas('hoje')} className="text-xs px-2.5 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:text-gold-400 hover:bg-dark-600 transition-colors">
                    Hoje
                  </button>
                  <button onClick={() => aplicarPresetTodas('semana')} className="text-xs px-2.5 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:text-gold-400 hover:bg-dark-600 transition-colors">
                    Últimos 7 dias
                  </button>
                  <button onClick={() => aplicarPresetTodas('mes')} className="text-xs px-2.5 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:text-gold-400 hover:bg-dark-600 transition-colors">
                    Mês
                  </button>
                </div>
                <Input label="De" type="date" value={dataInicioTodas} onChange={(e) => setDataInicioTodas(e.target.value)} />
                <Input label="Até" type="date" value={dataFimTodas} onChange={(e) => setDataFimTodas(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-dark-900/50 border border-dark-700 rounded-xl p-4">
                <p className="text-xs text-dark-500">Vendas no período</p>
                <p className="text-lg font-semibold text-dark-50">{vendasTodasEmpresas?.quantidadeGeral ?? 0}</p>
              </div>
              <div className="bg-dark-900/50 border border-dark-700 rounded-xl p-4">
                <p className="text-xs text-dark-500">Valor total</p>
                <p className="text-lg font-semibold text-dark-50">{formatarMoeda(vendasTodasEmpresas?.valorTotalGeral)}</p>
              </div>
              <div className="bg-dark-900/50 border border-dark-700 rounded-xl p-4">
                <p className="text-xs text-dark-500">Ticket médio</p>
                <p className="text-lg font-semibold text-dark-50">{formatarMoeda(vendasTodasEmpresas?.ticketMedioGeral)}</p>
              </div>
            </div>

            <p className="text-xs text-dark-500 mb-2">Por empresa</p>
            <div className="divide-y divide-dark-700">
              {vendasTodasEmpresas?.porEmpresa.map((e) => (
                <div key={e.empresaId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-dark-200">{e.nome}</span>
                  <div className="text-right">
                    <p className="text-dark-100 font-medium">{formatarMoeda(e.valorTotal)}</p>
                    <p className="text-xs text-dark-500">{pluralizarSimples(e.quantidade, 'venda', 'vendas')}</p>
                  </div>
                </div>
              ))}
              {!vendasTodasEmpresas?.porEmpresa.length && <p className="text-sm text-dark-500 py-2">Nenhuma venda no período.</p>}
            </div>
          </section>
        </div>
      )}
        </>
      )}
    </div>
  )
}
