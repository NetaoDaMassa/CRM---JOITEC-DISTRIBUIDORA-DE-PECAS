import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Download, RefreshCw, Search, Package, Clock, CheckCircle2, XCircle, CalendarRange, Info } from 'lucide-react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { STAGE_LABELS, STAGE_COLORS, type Stage } from '../lib/ordensShared'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../lib/propostasShared'

function baixarCsv(filename: string, linhas: string[]) {
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function BotaoCsv({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors">
      <Download size={13} /> Exportar CSV
    </button>
  )
}

// Atalho "Mês" — preenche De/Até com o mês inteiro de uma vez, igual ao
// MonthQuickFill de Relatorios.tsx no odincrm original.
function monthToRange(mes: string): { from: string; to: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { from: `${mes}-01`, to: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

type RouterOutputs = inferRouterOutputs<AppRouter>
type MarketingData = RouterOutputs['relatoriosOdin']['marketing']
type Filtro = { dataDe?: string; dataAte?: string; vendedorId?: number }

type TabKey = 'pedidos' | 'propostas' | 'pipeline' | 'posVenda' | 'faturamento' | 'maquinas' | 'marketing'
const TAB_LABELS: Record<TabKey, string> = {
  pedidos: 'Pedidos em Processo',
  marketing: 'Marketing & Propostas',
  posVenda: 'Pós-Venda',
  maquinas: 'Máquinas',
  pipeline: 'Pipeline',
  propostas: 'Propostas',
  faturamento: 'Faturamento',
}
const TAB_ORDEM: TabKey[] = ['pedidos', 'marketing', 'posVenda', 'maquinas', 'pipeline', 'propostas', 'faturamento']

// Cartão de indicador — ícone num quadrado colorido + valor + rótulo,
// mesmo padrão do KpiCard de Relatorios.tsx no odincrm original.
function KpiCard({ label, value, sub, color, icon, info }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode; info?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex items-center gap-3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${color}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark-50 leading-tight truncate">{value}</p>
        <p className="flex items-center gap-1 text-xs text-dark-400 leading-tight mt-0.5">
          {label}
          {info && <span title={info} className="shrink-0 text-dark-600 cursor-help"><Info size={10} /></span>}
        </p>
        {sub && <p className="text-[11px] text-dark-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// Barra horizontal mais robusta (valor sobreposto), mesmo espírito do
// FunnelBar do original.
function Barra({ label, valor, total, cor }: { label: string; valor: number; total: number; cor?: string }) {
  const pct = total ? Math.round((valor / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-dark-300 font-medium">{label}</span>
        <span className="font-bold text-dark-50">{valor}</span>
      </div>
      <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor ?? '#c9a227' }} />
      </div>
    </div>
  )
}

function money(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const TABS_COM_FILTRO_DATA: TabKey[] = ['pedidos', 'propostas', 'pipeline', 'faturamento', 'posVenda', 'marketing']
const TABS_COM_FILTRO_VENDEDOR: TabKey[] = ['pedidos', 'propostas', 'pipeline', 'faturamento', 'posVenda', 'marketing']

export default function RelatoriosOdin() {
  const [tab, setTab] = useState<TabKey>('pedidos')
  const [mes, setMes] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const { data: vendedores } = trpc.users.vendors.useQuery()
  const utils = trpc.useUtils()
  const filtro = { dataDe: dataDe || undefined, dataAte: dataAte || undefined, vendedorId: vendedorId ? Number(vendedorId) : undefined }

  function aplicarMes(m: string) {
    setMes(m)
    if (m) {
      const { from, to } = monthToRange(m)
      setDataDe(from)
      setDataAte(to)
    }
  }
  function alterarData(campo: 'de' | 'ate', valor: string) {
    if (campo === 'de') setDataDe(valor)
    else setDataAte(valor)
    setMes('')
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold flex items-center gap-2"><BarChart3 size={22} /> Relatórios</h1>
        <button
          onClick={() => utils.relatoriosOdin.invalidate()}
          className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
        >
          <RefreshCw size={13} /> Atualizar
        </button>
      </div>

      <div className="flex gap-1 rounded-xl bg-dark-800 border border-dark-600 p-1 w-fit flex-wrap mb-5">
        {TAB_ORDEM.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t ? 'bg-gold-600 text-dark-950' : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {(TABS_COM_FILTRO_DATA.includes(tab) || TABS_COM_FILTRO_VENDEDOR.includes(tab)) && (
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 mb-5 max-w-3xl">
          <p className="text-xs font-semibold text-dark-400 mb-3">Filtros</p>
          <div className="flex gap-3 flex-wrap items-end">
            {TABS_COM_FILTRO_DATA.includes(tab) && (
              <>
                <div>
                  <label className="text-xs text-dark-400 mb-1 flex items-center gap-1">Mês <CalendarRange size={11} className="text-dark-500" /></label>
                  <input
                    type="month"
                    value={mes}
                    onChange={(e) => aplicarMes(e.target.value)}
                    title="Atalho: preenche De/Até com o mês inteiro"
                    className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 focus:outline-none focus:border-gold-600"
                  />
                </div>
                <Input label="De" type="date" value={dataDe} onChange={(e) => alterarData('de', e.target.value)} />
                <Input label="Até" type="date" value={dataAte} onChange={(e) => alterarData('ate', e.target.value)} />
              </>
            )}
            {TABS_COM_FILTRO_VENDEDOR.includes(tab) && (
              <div className="w-52">
                <Select
                  label="Vendedor"
                  value={vendedorId}
                  onChange={(e) => setVendedorId(e.target.value)}
                  placeholder="Todos"
                  options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'pedidos' && <RelatorioPedidosProcesso filtro={filtro} />}
      {tab === 'propostas' && <RelatorioPropostas filtro={filtro} />}
      {tab === 'pipeline' && <RelatorioPipeline filtro={filtro} />}
      {tab === 'posVenda' && <RelatorioPosVenda filtro={filtro} />}
      {tab === 'faturamento' && <RelatorioFaturamento filtro={filtro} />}
      {tab === 'maquinas' && <RelatorioMaquinas />}
      {tab === 'marketing' && <RelatorioMarketing filtro={filtro} />}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado' }
const STATUS_COLOR: Record<string, string> = { ativo: 'text-amber-400', concluido: 'text-green-400', cancelado: 'text-red-400' }

function formatarData(dt: string): string {
  const [data] = dt.split(' ')
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

function RelatorioPedidosProcesso({ filtro }: { filtro: Filtro }) {
  const [status, setStatus] = useState<'' | 'ativo' | 'concluido' | 'cancelado'>('')
  const { data, isLoading } = trpc.relatoriosOdin.pedidosProcesso.useQuery({ ...filtro, status: status || undefined })
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>

  const csv = () => {
    const linhas = ['#,Cliente,Vendedor,Etapa,Status,Data,Tempo (h)']
    for (const r of data.rows) linhas.push([r.id, r.clienteNome, r.vendedorNome, STAGE_LABELS[r.stage as Stage] ?? r.stage, STATUS_LABEL[r.status] ?? r.status, formatarData(r.createdAt), r.tempoHoras ?? ''].join(','))
    baixarCsv(`relatorio_pedidos_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="w-52">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} placeholder="Todos" options={[{ value: 'ativo', label: 'Ativo' }, { value: 'concluido', label: 'Concluído' }, { value: 'cancelado', label: 'Cancelado' }]} />
        </div>
        <BotaoCsv onClick={csv} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total" value={data.total} icon={<Package size={18} className="text-white" />} color="bg-blue-600" info="Pedidos que batem com os filtros acima." />
        <KpiCard label="Ativos" value={data.active} icon={<Clock size={18} className="text-white" />} color="bg-amber-500" />
        <KpiCard label="Concluídos" value={data.completed} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-green-500" />
        <KpiCard label="Cancelados" value={data.cancelled} icon={<XCircle size={18} className="text-white" />} color="bg-red-500" />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">Processos ({data.total})</h2>
        {data.rows.length === 0 ? (
          <p className="text-center py-10 text-sm text-dark-500">Nenhum resultado encontrado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-dark-500 text-[11px] uppercase tracking-wide">
                  <th className="text-left font-semibold py-2 px-2">#</th>
                  <th className="text-left font-semibold py-2 px-2">Cliente</th>
                  <th className="text-left font-semibold py-2 px-2">Vendedor</th>
                  <th className="text-left font-semibold py-2 px-2">Etapa</th>
                  <th className="text-left font-semibold py-2 px-2">Status</th>
                  <th className="text-left font-semibold py-2 px-2">Data</th>
                  <th className="text-left font-semibold py-2 px-2">Tempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/60">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-dark-900/40">
                    <td className="py-2.5 px-2 font-mono text-xs text-gold-500"><Link to={`/admin/ordens/${r.id}`} className="hover:underline">#{r.id}</Link></td>
                    <td className="py-2.5 px-2 text-dark-100 font-medium max-w-[160px] truncate">{r.clienteNome}</td>
                    <td className="py-2.5 px-2 text-dark-400">{r.vendedorNome}</td>
                    <td className="py-2.5 px-2"><Badge className={STAGE_COLORS[r.stage as Stage] ?? 'text-dark-300 bg-dark-700 border-dark-600'}>{STAGE_LABELS[r.stage as Stage] ?? r.stage}</Badge></td>
                    <td className={`py-2.5 px-2 font-medium ${STATUS_COLOR[r.status] ?? ''}`}>{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td className="py-2.5 px-2 text-dark-500 whitespace-nowrap">{formatarData(r.createdAt)}</td>
                    <td className="py-2.5 px-2 text-dark-500 whitespace-nowrap">{r.tempoHoras != null ? `${r.tempoHoras}h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RelatorioPropostas({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.relatoriosOdin.propostas.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const csv = () => {
    const linhas = ['Métrica,Valor', `Total de propostas,${data.total}`, `Convertidas em pedido,${data.convertidas}`, `Taxa de conversão,${data.taxaConversao}%`, '', 'Etapa,Quantidade']
    for (const [etapa, qtd] of Object.entries(data.porEtapa)) linhas.push(`${PROPOSTA_STAGE_LABELS[etapa as PropostaStage] ?? etapa},${qtd}`)
    linhas.push('', 'Vendedor,Total,Convertidas')
    for (const v of data.porVendedor) linhas.push(`${v.vendedorNome},${v.total},${v.convertidas}`)
    baixarCsv(`relatorio_propostas_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><BotaoCsv onClick={csv} /></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl">
        <KpiCard label="Total de propostas" value={data.total} icon={<Package size={18} className="text-white" />} color="bg-indigo-500" />
        <KpiCard label="Convertidas em pedido" value={data.convertidas} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-green-500" />
        <KpiCard label="Taxa de conversão" value={`${data.taxaConversao}%`} icon={<BarChart3 size={18} className="text-white" />} color="bg-teal-500" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-sm font-semibold text-dark-300 mb-2">Por etapa</h3>
        {Object.entries(data.porEtapa).map(([etapa, qtd]) => (
          <Barra key={etapa} label={PROPOSTA_STAGE_LABELS[etapa as PropostaStage] ?? etapa} valor={qtd} total={data.total} />
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-dark-300 mb-2">Por vendedor</h3>
        <div className="space-y-1.5 max-w-lg">
          {data.porVendedor.map((v) => (
            <div key={v.vendedorId} className="flex items-center justify-between px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <span className="text-dark-200">{v.vendedorNome}</span>
              <span className="text-dark-500">{v.total} propostas · {v.convertidas} convertidas</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RelatorioPipeline({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.relatoriosOdin.pipeline.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const csv = () => {
    const linhas = ['Métrica,Valor', `Total de pedidos,${data.total}`, '', 'Etapa,Quantidade']
    for (const [etapa, qtd] of Object.entries(data.porEtapa)) linhas.push(`${STAGE_LABELS[etapa as Stage] ?? etapa},${qtd}`)
    linhas.push('', 'Status,Quantidade')
    for (const [status, qtd] of Object.entries(data.porStatus)) linhas.push(`${status},${qtd}`)
    linhas.push('', 'Tipo,Quantidade')
    for (const [tipo, qtd] of Object.entries(data.porTipo)) linhas.push(`${tipo === 'maquina' ? 'Máquina' : 'Peça'},${qtd}`)
    baixarCsv(`relatorio_pipeline_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><BotaoCsv onClick={csv} /></div>
      <KpiCard label="Total de pedidos" value={data.total} icon={<Package size={18} className="text-white" />} color="bg-blue-600" />
      <div className="grid grid-cols-2 gap-6 max-w-3xl">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por etapa</h3>
          {Object.entries(data.porEtapa).map(([etapa, qtd]) => (
            <Barra key={etapa} label={STAGE_LABELS[etapa as Stage] ?? etapa} valor={qtd} total={data.total} />
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por status</h3>
          {Object.entries(data.porStatus).map(([status, qtd]) => (
            <Barra key={status} label={STATUS_LABEL[status] ?? status} valor={qtd} total={data.total} />
          ))}
          <h3 className="text-sm font-semibold text-dark-300 mb-2 mt-4">Por tipo</h3>
          {Object.entries(data.porTipo).map(([tipo, qtd]) => (
            <Barra key={tipo} label={tipo === 'maquina' ? 'Máquina' : 'Peça'} valor={qtd} total={data.total} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RelatorioPosVenda({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.relatoriosOdin.posVenda.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const csv = () => {
    const linhas = [
      'Métrica,Valor',
      `Pós-venda registrados,${data.total}`,
      `Com feedback do cliente,${data.comFeedback}`,
      `NPS médio,${data.mediaNps ?? ''}`,
      `Com lembrete pendente,${data.comLembretePendente}`,
    ]
    baixarCsv(`relatorio_pos_venda_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><BotaoCsv onClick={csv} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
        <KpiCard label="Pós-venda registrados" value={data.total} icon={<Package size={18} className="text-white" />} color="bg-emerald-600" />
        <KpiCard label="Com feedback do cliente" value={data.comFeedback} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-blue-500" />
        <KpiCard label="NPS médio" value={data.mediaNps ?? '—'} icon={<BarChart3 size={18} className="text-white" />} color="bg-teal-500" />
        <KpiCard label="Com lembrete pendente" value={data.comLembretePendente} icon={<Clock size={18} className="text-white" />} color="bg-amber-500" />
      </div>
    </div>
  )
}

function RelatorioFaturamento({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.relatoriosOdin.faturamento.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const csv = () => {
    const linhas = [
      'Métrica,Valor',
      `Pedidos no período,${data.totalPedidos}`,
      `Valor total,${money(data.valorTotal)}`,
      `Valor confirmado,${money(data.valorConfirmado)}`,
      `Pagamentos confirmados,${data.qtdConfirmado}`,
    ]
    baixarCsv(`relatorio_faturamento_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><BotaoCsv onClick={csv} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
        <KpiCard label="Pedidos no período" value={data.totalPedidos} icon={<Package size={18} className="text-white" />} color="bg-blue-600" />
        <KpiCard label="Valor total" value={money(data.valorTotal)} icon={<BarChart3 size={18} className="text-white" />} color="bg-purple-500" />
        <KpiCard label="Valor confirmado" value={money(data.valorConfirmado)} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-green-500" />
        <KpiCard label="Pagamentos confirmados" value={data.qtdConfirmado} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-emerald-600" />
      </div>
    </div>
  )
}

function RelatorioMaquinas() {
  const { data, isLoading } = trpc.relatoriosOdin.maquinas.useQuery()
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  const csv = () => {
    const linhas = ['Métrica,Valor', `Total em estoque cadastrado,${data.total}`, '', 'Status,Quantidade']
    for (const [status, qtd] of Object.entries(data.porStatus)) linhas.push(`${status},${qtd}`)
    linhas.push('', 'Porte,Quantidade')
    for (const [porte, qtd] of Object.entries(data.porPorte)) linhas.push(`${porte === 'pequeno' ? 'Pequeno' : 'Grande'},${qtd}`)
    baixarCsv(`relatorio_maquinas_${new Date().toISOString().slice(0, 10)}.csv`, linhas)
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><BotaoCsv onClick={csv} /></div>
      <KpiCard label="Total em estoque cadastrado" value={data.total} icon={<Package size={18} className="text-white" />} color="bg-cyan-600" />
      <div className="grid grid-cols-2 gap-6 max-w-2xl">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por status</h3>
          {Object.entries(data.porStatus).map(([status, qtd]) => (
            <Barra key={status} label={status} valor={qtd} total={data.total} />
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por porte</h3>
          {Object.entries(data.porPorte).map(([porte, qtd]) => (
            <Barra key={porte} label={porte === 'pequeno' ? 'Pequeno' : 'Grande'} valor={qtd} total={data.total} />
          ))}
        </div>
      </div>
    </div>
  )
}

const RESULTADO_LABELS: Record<string, string> = { em_andamento: 'Em andamento', gerar_proposta: 'Gerar Proposta', follow_up: 'Follow-up', sem_interesse: 'Sem interesse', nao_encontrado: 'Não encontrado' }
const PROPOSTA_ETAPA_ORDEM: PropostaStage[] = ['proposta', 'negociacao', 'fechado', 'convertido', 'perdido', 'chamar_depois']

function baixarCsvMarketing(data: MarketingData) {
  const linhas: string[] = []
  linhas.push('=== VISITAS ===')
  linhas.push('Resultado,Quantidade')
  for (const [r, qtd] of Object.entries(data.visitas.porResultado)) linhas.push(`${RESULTADO_LABELS[r] ?? r},${qtd}`)
  linhas.push('')
  linhas.push('Objetivo,Quantidade')
  for (const [o, qtd] of data.visitas.porObjetivo) linhas.push(`${o},${qtd}`)
  linhas.push('')
  linhas.push('Empresa,Visitas')
  for (const e of data.visitas.topEmpresas) linhas.push(`${e.nome},${e.total}`)
  linhas.push('')
  linhas.push('=== PROPOSTAS ===')
  linhas.push('Etapa,Quantidade')
  for (const [etapa, qtd] of Object.entries(data.propostas.porEtapa)) linhas.push(`${PROPOSTA_STAGE_LABELS[etapa as PropostaStage] ?? etapa},${qtd}`)
  linhas.push('')
  linhas.push('Forma de pagamento,Quantidade')
  for (const [f, qtd] of data.propostas.porPagamento) linhas.push(`${f},${qtd}`)
  linhas.push('')
  linhas.push('Revenda,Quantidade')
  for (const [r, qtd] of data.propostas.porRevenda) linhas.push(`${r},${qtd}`)
  linhas.push('')
  linhas.push('=== FUNIL ===')
  linhas.push('Etapa,Valor')
  for (const f of data.funil) linhas.push(`${f.label},${f.valor}`)

  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio_marketing_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function RelatorioMarketing({ filtro }: { filtro: Filtro }) {
  const { data, isLoading } = trpc.relatoriosOdin.marketing.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>

  const maxFunil = Math.max(1, ...data.funil.map((f) => f.valor))

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <BotaoCsv onClick={() => baixarCsvMarketing(data)} />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-dark-300 mb-3">Funil — Visita → Pedido</h3>
        <div className="space-y-2 max-w-2xl">
          {data.funil.map((f) => (
            <div key={f.label}>
              <div className="flex items-center justify-between text-xs text-dark-400 mb-1">
                <span>{f.label}</span>
                <span>{f.valor}</span>
              </div>
              <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(f.valor / maxFunil) * 100}%`, background: f.cor }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-base font-bold text-dark-100 mb-3">Visitas</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl mb-5">
          <KpiCard label="Total" value={data.visitas.total} icon={<Package size={18} className="text-white" />} color="bg-sky-500" />
          <KpiCard label="Planejadas" value={data.visitas.planejadas} icon={<CalendarRange size={18} className="text-white" />} color="bg-violet-500" />
          <KpiCard label="Em campo" value={data.visitas.campo} icon={<Package size={18} className="text-white" />} color="bg-indigo-500" />
          <KpiCard label="Duração média" value={data.visitas.duracaoMediaMinutos != null ? `${data.visitas.duracaoMediaMinutos} min` : '—'} icon={<Clock size={18} className="text-white" />} color="bg-amber-500" />
          <KpiCard label="Taxa → proposta" value={`${data.visitas.taxaConversaoProposta}%`} icon={<BarChart3 size={18} className="text-white" />} color="bg-teal-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Por resultado</h3>
            {Object.entries(data.visitas.porResultado).map(([r, qtd]) => (
              <Barra key={r} label={RESULTADO_LABELS[r] ?? r} valor={qtd} total={data.visitas.total} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Por objetivo</h3>
            {data.visitas.porObjetivo.length === 0 && <p className="text-xs text-dark-500">Nenhum objetivo registrado.</p>}
            {data.visitas.porObjetivo.map(([o, qtd]) => (
              <Barra key={o} label={o} valor={qtd} total={data.visitas.total} />
            ))}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Top empresas visitadas</h3>
            <div className="space-y-1.5">
              {data.visitas.topEmpresas.map((e) => (
                <div key={e.nome} className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-dark-600 bg-dark-800 text-sm">
                  <span className="text-dark-200 truncate">{e.nome}</span>
                  <span className="text-dark-500 shrink-0 ml-2">{e.total}</span>
                </div>
              ))}
              {data.visitas.topEmpresas.length === 0 && <p className="text-xs text-dark-500">Nenhuma visita registrada.</p>}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por vendedor</h3>
          <div className="space-y-1.5 max-w-2xl">
            {data.visitas.porVendedor.map((v) => (
              <div key={v.vendedorId} className="flex items-center justify-between px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm">
                <span className="text-dark-200">{v.nome}</span>
                <span className="text-dark-500">{v.total} visitas · {v.propostas} propostas · {v.followUp} follow-up · {v.semInteresse} sem interesse</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-base font-bold text-dark-100 mb-3">Propostas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mb-5">
          <KpiCard label="Total" value={data.propostas.total} icon={<Package size={18} className="text-white" />} color="bg-indigo-500" />
          <KpiCard label="Taxa → negociação" value={`${data.propostas.taxaNegociacao}%`} icon={<BarChart3 size={18} className="text-white" />} color="bg-amber-500" />
          <KpiCard label="Taxa → fechado" value={`${data.propostas.taxaFechado}%`} icon={<CheckCircle2 size={18} className="text-white" />} color="bg-green-500" />
          <KpiCard label="Sem PDF anexado" value={data.propostas.semPdf} icon={<XCircle size={18} className="text-white" />} color="bg-red-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Por etapa</h3>
            {PROPOSTA_ETAPA_ORDEM.map((etapa) => (
              <Barra key={etapa} label={PROPOSTA_STAGE_LABELS[etapa]} valor={data.propostas.porEtapa[etapa] ?? 0} total={data.propostas.total} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Por forma de pagamento</h3>
            {data.propostas.porPagamento.map(([f, qtd]) => (
              <Barra key={f} label={f} valor={qtd} total={data.propostas.total} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-dark-300 mb-2">Por revenda</h3>
            {data.propostas.porRevenda.map(([r, qtd]) => (
              <Barra key={r} label={r} valor={qtd} total={data.propostas.total} />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-2">Por vendedor</h3>
          <div className="space-y-1.5 max-w-2xl">
            {data.propostas.porVendedor.map((v) => (
              <div key={v.vendedorId} className="flex items-center justify-between px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm">
                <span className="text-dark-200">{v.nome}</span>
                <span className="text-dark-500">{v.total} propostas · {v.fechado} fechadas · {v.convertido} convertidas · {v.semPdf} sem PDF</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.mensal.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-dark-300 mb-3">Evolução mensal — visitas x propostas</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.mensal} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
              <XAxis dataKey="mes" tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#898781', fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
              <Tooltip contentStyle={{ fontSize: 12, background: '#1a2028', border: '1px solid #2a3644' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="visitas" name="Visitas" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="propostasCriadas" name="Propostas criadas" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="convertido" name="Convertidas" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
