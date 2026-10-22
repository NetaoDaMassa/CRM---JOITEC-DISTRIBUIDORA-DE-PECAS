import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Clock, Hourglass, PackageX, Truck, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import { formatarMoeda } from '../lib/moeda'
import BotaoImprimir from '../components/relatorios/BotaoImprimir'
import { BarraSegmentada, Carregando, KpiCard, Medidor, Ranking, Secao, numero, pct } from '../components/relatorios/blocos'
import { datasDoPreset, periodoAnterior } from '../components/relatorios/filtros'
import type { Preset } from '../components/relatorios/filtros'

// Relatório de Devolução no visual dos relatórios novos (pedido do João,
// 2026-10-22: "deixar dinâmico, mais visual, igual as últimas
// atualizações"): período com atalhos e comparação com o período anterior,
// funil por etapa, evolução por mês, chamados em aberto mais antigos
// (clicáveis) e rankings no lugar das barras cinzas.

const COR_POSITIVO = '#22a861'
const COR_ALERTA = '#e5534b'
const COR_GRID = '#2a3644'
const COR_TICK = '#898781'

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  novo: { rotulo: 'Novo', cor: '#3987e5' },
  analise: { rotulo: 'Análise', cor: '#8b5cf6' },
  sem_retorno_cliente: { rotulo: 'Sem retorno do cliente', cor: '#94a3b8' },
  em_andamento: { rotulo: 'Em andamento', cor: '#e8a33a' },
  nota_fiscal_devolucao: { rotulo: 'Nota fiscal devolução', cor: '#d6409f' },
  chegada_materiais: { rotulo: 'Chegada materiais', cor: '#0ea5a4' },
  preparacao_envio: { rotulo: 'Preparação e envio', cor: '#5b6cf0' },
  rastreio_transportadora: { rotulo: 'Rastreio transportadora', cor: '#2f9fd8' },
  finalizado: { rotulo: 'Finalizado', cor: COR_POSITIVO },
}

const OCORRENCIA: Record<string, { rotulo: string; cor: string }> = {
  envio_errado: { rotulo: 'Envio errado', cor: '#e8a33a' },
  falta_materiais: { rotulo: 'Falta de materiais', cor: '#3987e5' },
  produto_defeito: { rotulo: 'Produto com defeito', cor: '#e5534b' },
  outro: { rotulo: 'Outro', cor: '#94a3b8' },
}

const QUEM_ERROU: Record<string, { rotulo: string; cor: string }> = {
  cliente: { rotulo: 'Cliente', cor: '#3987e5' },
  estoque: { rotulo: 'Estoque', cor: '#e8a33a' },
  transportadora: { rotulo: 'Transportadora', cor: '#8b5cf6' },
  vendedor: { rotulo: 'Vendedor', cor: '#e5534b' },
  defeito: { rotulo: 'Defeito de fábrica', cor: '#94a3b8' },
}

const RESOLUCAO: Record<string, { rotulo: string; cor: string }> = {
  saldo_credito: { rotulo: 'Saldo de crédito', cor: '#0ea5a4' },
  troca_produto: { rotulo: 'Troca do produto', cor: '#3987e5' },
  abatimento_boleto: { rotulo: 'Abatimento no boleto', cor: '#e8a33a' },
  dinheiro_volta: { rotulo: 'Dinheiro de volta', cor: '#e5534b' },
  envio_materiais: { rotulo: 'Envio de materiais', cor: '#8b5cf6' },
}

const PRESETS_DEV: { valor: Preset | 'tudo'; rotulo: string }[] = [
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mes_passado', rotulo: 'Mês passado' },
  { valor: '90d', rotulo: '90 dias' },
  { valor: 'ano', rotulo: 'Este ano' },
  { valor: 'tudo', rotulo: 'Tudo' },
]

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`

type Fatia = { chave: string; rotulo: string; valor: number; cor: string }

// Rosca com o total no meio e a legenda ao lado.
function Rosca({ fatias, centro, formatar = numero, empilhada }: { fatias: Fatia[]; centro: string; formatar?: (v: number) => string; empilhada?: boolean }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0)
  if (!total) return <p className="text-sm text-dark-500">Nada no período.</p>
  return (
    <div className={`flex flex-col items-center gap-4 ${empilhada ? '' : 'sm:flex-row'}`}>
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={fatias} dataKey="valor" nameKey="rotulo" innerRadius={50} outerRadius={74} paddingAngle={2} stroke="none">
              {fatias.map((f) => (
                <Cell key={f.chave} fill={f.cor} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
                    <p className="text-dark-100 font-medium">{String(payload[0].name)}</p>
                    <p className="text-dark-300">{formatar(Number(payload[0].value))}</p>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-xl font-bold text-dark-50 leading-none">{formatar(total)}</p>
          <p className="text-[11px] text-dark-400 mt-1">{centro}</p>
        </div>
      </div>
      <ul className="flex-1 w-full space-y-1.5">
        {fatias.map((f) => (
          <li key={f.chave} className="flex items-center gap-2 text-[13px]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.cor }} />
            <span className="text-dark-200 flex-1 truncate">{f.rotulo}</span>
            <span className="text-dark-50 font-semibold tabular-nums">{formatar(f.valor)}</span>
            <span className="text-dark-500 text-xs w-11 text-right tabular-nums">{pct((f.valor / total) * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function fatiasDe(lista: { chave: string; quantidade: number }[], mapa: Record<string, { rotulo: string; cor: string }>): Fatia[] {
  return lista.map((i) => ({ chave: i.chave, rotulo: mapa[i.chave]?.rotulo ?? i.chave, valor: i.quantidade, cor: mapa[i.chave]?.cor ?? '#94a3b8' }))
}

function corDosDias(dias: number) {
  return dias > 30 ? COR_ALERTA : dias > 15 ? '#e8a33a' : '#3987e5'
}

const classeCampo = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500 transition-colors'

export default function DevolucaoRelatorios() {
  const { user } = useAuth()
  const [empresaFiltro, setEmpresaFiltro] = usePersistedState('devolucaoRelatorios:empresaFiltro', '')
  const [preset, setPreset] = usePersistedState<Preset | 'tudo'>('devolucaoRelatorios:preset', 'ano')
  const [dataInicio, setDataInicio] = usePersistedState('devolucaoRelatorios:dataInicio', '')
  const [dataFim, setDataFim] = usePersistedState('devolucaoRelatorios:dataFim', '')

  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && user.role === 'admin' && !user.superAdmin,
  })
  const temVisaoGlobal = !!user?.superAdmin || !!minhasFeatures?.includes('devolucoes_visao_global')
  const { data: empresasDevolucao } = trpc.devolucoes.listarEmpresasPublico.useQuery(undefined, { enabled: temVisaoGlobal })

  // Atalho recalcula sempre ("Este mês" amanhã já inclui amanhã); "Tudo" = sem data.
  const datas = preset === 'tudo' ? { inicio: '', fim: '' } : preset === 'custom' ? { inicio: dataInicio, fim: dataFim } : datasDoPreset(preset)!
  const empresaId = empresaFiltro ? Number(empresaFiltro) : undefined
  const { data, isLoading } = trpc.devolucoes.relatorio.useQuery({ empresaId, dataInicio: datas.inicio || undefined, dataFim: datas.fim || undefined })
  const ant = datas.inicio && datas.fim ? periodoAnterior(datas.inicio, datas.fim) : null
  const { data: anterior } = trpc.devolucoes.relatorio.useQuery({ empresaId, dataInicio: ant?.inicio, dataFim: ant?.fim }, { enabled: !!ant })
  const comp = ant ? anterior : undefined

  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  const [etapaAberta, setEtapaAberta] = useState<string | null>(null)

  const filtros = (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex items-center rounded-lg border border-dark-600 bg-dark-800 p-0.5 overflow-x-auto max-w-full">
        {PRESETS_DEV.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setPreset(p.valor)}
            className={`px-2.5 h-8 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              preset === p.valor ? 'bg-gold-500 text-white shadow-sm' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-700'
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <CalendarDays size={15} className="text-dark-400" />
        <input
          type="date"
          value={datas.inicio}
          onChange={(e) => {
            setDataInicio(e.target.value)
            setDataFim(datas.fim)
            setPreset('custom')
          }}
          className={classeCampo}
          aria-label="De"
        />
        <span className="text-dark-500 text-xs">até</span>
        <input
          type="date"
          value={datas.fim}
          onChange={(e) => {
            setDataInicio(datas.inicio)
            setDataFim(e.target.value)
            setPreset('custom')
          }}
          className={classeCampo}
          aria-label="Até"
        />
      </div>
      {temVisaoGlobal && (
        <select value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)} className={`${classeCampo} max-w-56`}>
          <option value="">Todas as empresas</option>
          {(empresasDevolucao ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      )}
    </div>
  )

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-5">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Relatório de Devoluções</h1>
        {filtros}
        <Carregando />
      </div>
    )
  }

  const segmentosStatus = Object.keys(STATUS)
    .map((chave) => ({ chave, rotulo: STATUS[chave].rotulo, cor: STATUS[chave].cor, valor: data.porStatus.find((s) => s.chave === chave)?.quantidade ?? 0 }))
    .filter((s) => s.valor > 0)
  const porMes = data.porMes.map((m) => ({ ...m, rotulo: rotuloMes(m.mes) }))
  const totalAnalises = data.resultadoAnalises.positivas + data.resultadoAnalises.negativas
  const vejoComissao = !!data.quemErrou

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Relatório de Devoluções</h1>
          <p className="text-dark-400 text-sm">Chamados abertos no período escolhido{temVisaoGlobal ? '' : ', no seu alcance'}.</p>
        </div>
        <BotaoImprimir nomeArquivo="relatorio-devolucoes" />
      </div>

      {filtros}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Chamados abertos" valor={numero(data.totalChamados)} icone={PackageX} cor="#3987e5" atual={comp ? data.totalChamados : undefined} anterior={comp?.totalChamados} inverter ajuda="Quantos chamados de devolução foram abertos no período. Menos é melhor." />
        <KpiCard
          titulo="Ainda em aberto"
          valor={numero(data.totalEmAberto)}
          icone={Hourglass}
          cor="#e8a33a"
          detalhe={data.diasMedioEmAberto !== null ? `abertos há ${data.diasMedioEmAberto} dias em média` : 'nenhum parado'}
          destaque={(data.diasMedioEmAberto ?? 0) > 30 ? 'ruim' : undefined}
          ajuda="Chamados do período que ainda não foram finalizados."
        />
        <KpiCard titulo="Finalizados" valor={numero(data.totalFinalizados)} icone={CheckCircle2} cor={COR_POSITIVO} atual={comp ? data.totalFinalizados : undefined} anterior={comp?.totalFinalizados} detalhe={data.totalChamados ? `${pct((data.totalFinalizados / data.totalChamados) * 100, 0)} dos abertos` : undefined} />
        <KpiCard
          titulo="Tempo até finalizar"
          valor={data.tempoMedioResolucaoDias === null ? '—' : `${data.tempoMedioResolucaoDias.toLocaleString('pt-BR')} dias`}
          icone={Clock}
          cor="#8b5cf6"
          atual={comp && data.tempoMedioResolucaoDias !== null && comp.tempoMedioResolucaoDias !== null ? data.tempoMedioResolucaoDias : undefined}
          anterior={comp?.tempoMedioResolucaoDias ?? undefined}
          inverter
          ajuda="Média de dias entre abrir e finalizar o chamado. Menos é melhor."
        />
        <KpiCard titulo="Custo de frete" valor={formatarMoeda(data.custoFrete, { casas: 0 })} icone={Truck} cor={COR_ALERTA} atual={comp ? data.custoFrete : undefined} anterior={comp?.custoFrete} inverter ajuda="Soma do frete de chegada (trazer o material) e de envio (mandar a troca) lançados nos chamados." />
      </div>

      <Secao titulo="Onde estão os chamados" subtitulo="cada cor é uma etapa — clique numa cor (ou no nome dela) para ver os chamados">
        <BarraSegmentada segmentos={segmentosStatus} selecionado={etapaAberta} aoClicar={(chave) => setEtapaAberta((e) => (e === chave ? null : chave))} />
        {etapaAberta && (
          <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/60">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-dark-700">
              <p className="text-sm text-dark-200">
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: STATUS[etapaAberta]?.cor }} />
                <span className="font-semibold">{STATUS[etapaAberta]?.rotulo ?? etapaAberta}</span> · {data.listaChamados.filter((c) => c.status === etapaAberta).length} chamados (mais antigos primeiro)
              </p>
              <button type="button" onClick={() => setEtapaAberta(null)} className="text-dark-400 hover:text-dark-100" title="Fechar">
                <X size={16} />
              </button>
            </div>
            <ul className="divide-y divide-dark-700/60 max-h-80 overflow-y-auto">
              {data.listaChamados
                .filter((c) => c.status === etapaAberta)
                .map((c) => (
                  <li key={c.id}>
                    <Link to={`${basePath}/devolucoes?chamado=${c.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-dark-700/40 transition-colors">
                      <span className="w-16 shrink-0 whitespace-nowrap text-xs font-bold tabular-nums" style={{ color: etapaAberta === 'finalizado' ? COR_TICK : corDosDias(c.dias) }}>
                        há {c.dias}d
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-dark-100 truncate">{c.clienteNome ?? 'Cliente sem nome'}</span>
                      <span className="text-[11px] text-dark-500 truncate hidden sm:inline">
                        #{c.protocolo}
                        {c.vendedor ? ` · ${c.vendedor}` : ''}
                        {temVisaoGlobal && c.empresa ? ` · ${c.empresa}` : ''}
                      </span>
                      <ChevronRight size={14} className="text-dark-500 shrink-0" />
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Secao>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
        <Secao titulo="Evolução por mês" subtitulo="abertos × finalizados em cada mês">
          {porMes.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={porMes} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fill: COR_TICK, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: COR_TICK, fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
                        <p className="text-dark-100 font-medium">{label}</p>
                        {payload.map((p) => (
                          <p key={String(p.dataKey)} style={{ color: p.color }}>
                            {p.name}: <span className="font-semibold">{p.value}</span>
                          </p>
                        ))}
                      </div>
                    ) : null
                  }
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="abertos" name="Abertos" fill="#3987e5" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="finalizados" name="Finalizados" fill={COR_POSITIVO} radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-dark-500">Nada no período.</p>
          )}
        </Secao>
        <Secao titulo="Resultado das análises" subtitulo="análise positiva = devolução aceita">
          {totalAnalises ? (
            <>
              <Medidor percentual={data.taxaPositiva ?? 0} cor={(data.taxaPositiva ?? 0) >= 50 ? COR_POSITIVO : COR_ALERTA} rotulo="positivas" />
              <div className="grid grid-cols-2 gap-2 mt-4 text-center">
                <div className="rounded-xl bg-dark-900 border border-dark-700 py-2">
                  <p className="text-lg font-bold" style={{ color: COR_POSITIVO }}>
                    {numero(data.resultadoAnalises.positivas)}
                  </p>
                  <p className="text-[11px] text-dark-400">positivas</p>
                </div>
                <div className="rounded-xl bg-dark-900 border border-dark-700 py-2">
                  <p className="text-lg font-bold" style={{ color: COR_ALERTA }}>
                    {numero(data.resultadoAnalises.negativas)}
                  </p>
                  <p className="text-[11px] text-dark-400">negativas</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-dark-500">Nenhuma análise feita no período.</p>
          )}
        </Secao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Secao
          titulo={
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Em aberto há mais tempo
            </span>
          }
          subtitulo="clique para abrir o chamado"
        >
          {data.maisAntigosEmAberto.length ? (
            <ul className="divide-y divide-dark-700">
              {data.maisAntigosEmAberto.map((c) => (
                <li key={c.id}>
                  <Link to={`${basePath}/devolucoes?chamado=${c.id}`} className="flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg hover:bg-dark-700/50 transition-colors">
                    <span className="w-12 shrink-0 rounded-lg py-1 text-center text-sm font-bold tabular-nums" style={{ color: corDosDias(c.dias), background: `${corDosDias(c.dias)}1f` }}>
                      {c.dias}d
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-dark-100 truncate">{c.clienteNome ?? 'Cliente sem nome'}</span>
                      <span className="block text-[11px] text-dark-500 truncate">
                        #{c.protocolo}
                        {c.vendedor ? ` · ${c.vendedor}` : ''}
                        {temVisaoGlobal && c.empresa ? ` · ${c.empresa}` : ''}
                      </span>
                    </span>
                    <span className="text-[11px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap" style={{ color: STATUS[c.status]?.cor, background: `${STATUS[c.status]?.cor ?? '#94a3b8'}1f` }}>
                      {STATUS[c.status]?.rotulo ?? c.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dark-500">Nenhum chamado em aberto. 🎉</p>
          )}
        </Secao>
        <Secao titulo="Tipo de ocorrência" subtitulo="o que motivou a devolução">
          <Rosca fatias={fatiasDe(data.porOcorrencia, OCORRENCIA)} centro="ocorrências" />
        </Secao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Secao titulo="Chamados por vendedor">
          <Ranking itens={data.porVendedor.slice(0, 10).map((v) => ({ rotulo: v.chave, valor: v.quantidade }))} cor="#3987e5" />
        </Secao>
        <Secao titulo="Produtos mais devolvidos" subtitulo="top 10 itens que mais aparecem nos chamados">
          <Ranking itens={data.porProduto.map((p) => ({ rotulo: p.chave, valor: p.quantidade }))} cor="#e8a33a" />
        </Secao>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
        <Secao
          titulo="Quanto as devoluções custaram por mês"
          subtitulo={vejoComissao ? 'frete (chegada + envio) e desconto de comissão, pelo mês em que o chamado foi aberto' : 'frete (chegada + envio), pelo mês em que o chamado foi aberto'}
          acoes={
            <span className="text-sm text-dark-300">
              Total{' '}
              <span className="font-bold text-dark-50">{formatarMoeda(data.custoPorMes.reduce((s, m) => s + m.frete + m.comissao, 0), { casas: 0 })}</span>
            </span>
          }
        >
          {data.custoPorMes.some((m) => m.frete + m.comissao > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.custoPorMes.map((m) => ({ ...m, rotulo: rotuloMes(m.mes) }))} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fill: COR_TICK, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: COR_TICK, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatarMoeda(v, { casas: 0 })} width={72} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
                        <p className="text-dark-100 font-medium">{label}</p>
                        {payload.map((p) => (
                          <p key={String(p.dataKey)} style={{ color: p.color }}>
                            {p.name}: <span className="font-semibold">{formatarMoeda(Number(p.value))}</span>
                          </p>
                        ))}
                      </div>
                    ) : null
                  }
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="frete" name="Frete" stackId="c" fill="#e8a33a" maxBarSize={30} />
                {vejoComissao && <Bar dataKey="comissao" name="Desconto de comissão" stackId="c" fill={COR_ALERTA} radius={[4, 4, 0, 0]} maxBarSize={30} />}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-dark-500">Nenhum frete ou desconto lançado no período.</p>
          )}
          <p className="text-[11px] text-dark-500 mt-2">O valor dos produtos devolvidos não entra aqui: o chamado não guarda preço dos itens.</p>
        </Secao>
        <Secao titulo="Clientes que mais devolvem" subtitulo="clique para abrir a ficha do cliente (quando o chamado está ligado a um cadastro)">
          {data.clientesQueMaisDevolvem.length ? (
            <ul className="space-y-2.5">
              {data.clientesQueMaisDevolvem.map((c, i) => {
                const max = data.clientesQueMaisDevolvem[0].quantidade
                const corpo = (
                  <>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-dark-200 truncate">
                        <span className="text-dark-500 mr-1.5 tabular-nums">{i + 1}.</span>
                        {c.nome}
                        {c.clienteId && <ChevronRight size={13} className="inline ml-1 text-dark-500" />}
                      </span>
                      <span className="text-dark-50 font-semibold tabular-nums shrink-0">
                        {c.quantidade} {c.quantidade === 1 ? 'chamado' : 'chamados'}
                        {c.frete > 0 && <span className="text-dark-500 font-normal text-xs ml-1.5">{formatarMoeda(c.frete, { casas: 0 })} frete</span>}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-dark-700 mt-1 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(c.quantidade / max) * 100}%`, background: '#d6409f' }} />
                    </div>
                  </>
                )
                return (
                  <li key={`${c.clienteId ?? c.nome}`}>
                    {c.clienteId ? (
                      <Link to={`${basePath}/clientes/${c.clienteId}`} className="block rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-dark-700/40 transition-colors">
                        {corpo}
                      </Link>
                    ) : (
                      corpo
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-dark-500">Nada no período.</p>
          )}
        </Secao>
      </div>

      {(vejoComissao || data.porResolucao.length > 0 || data.porEmpresa.length > 1) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {data.porResolucao.length > 0 && (
            <Secao titulo="Como foi resolvido">
              <Rosca fatias={fatiasDe(data.porResolucao, RESOLUCAO)} centro="resolvidos" empilhada />
            </Secao>
          )}
          {vejoComissao && (
            <Secao titulo="Quem errou" subtitulo="segundo a análise">
              <Rosca fatias={fatiasDe(data.quemErrou ?? [], QUEM_ERROU)} centro="análises" empilhada />
            </Secao>
          )}
          {vejoComissao && (
            <Secao titulo="Impacto na comissão" subtitulo="valor descontado por vendedor">
              <Ranking itens={(data.comissaoPorVendedor ?? []).map((c) => ({ rotulo: c.chave, valor: c.valor }))} formatar={(v) => formatarMoeda(v)} cor={COR_ALERTA} vazio="Nenhum desconto no período." />
            </Secao>
          )}
          {data.porEmpresa.length > 1 && (
            <Secao titulo="Chamados por empresa">
              <Ranking itens={data.porEmpresa.map((e) => ({ rotulo: e.chave, valor: e.quantidade }))} cor="#8b5cf6" />
            </Secao>
          )}
        </div>
      )}
    </div>
  )
}
