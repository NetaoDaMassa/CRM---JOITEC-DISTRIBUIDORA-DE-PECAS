import { useState } from 'react'
import { BarChart3, Download, RefreshCw } from 'lucide-react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { STAGE_LABELS, type Stage } from '../lib/ordensShared'
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

type RouterOutputs = inferRouterOutputs<AppRouter>
type MarketingData = RouterOutputs['relatoriosOdin']['marketing']
type Filtro = { dataDe?: string; dataAte?: string; vendedorId?: number }

type TabKey = 'propostas' | 'pipeline' | 'posVenda' | 'faturamento' | 'maquinas' | 'marketing'
const TAB_LABELS: Record<TabKey, string> = {
  propostas: 'Propostas',
  pipeline: 'Pipeline de Pedidos',
  posVenda: 'Pós-Venda',
  faturamento: 'Faturamento',
  maquinas: 'Máquinas',
  marketing: 'Marketing',
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl p-4">
      <div className="text-2xl font-bold text-dark-50">{value}</div>
      <div className="text-xs text-dark-500 mt-0.5">{label}</div>
    </div>
  )
}

function Barra({ label, valor, total }: { label: string; valor: number; total: number }) {
  const pct = total ? Math.round((valor / total) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-dark-400 mb-1">
        <span>{label}</span>
        <span>{valor} ({pct}%)</span>
      </div>
      <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
        <div className="h-full bg-gold-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function money(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const TABS_COM_FILTRO_DATA: TabKey[] = ['propostas', 'pipeline', 'faturamento', 'posVenda', 'marketing']
const TABS_COM_FILTRO_VENDEDOR: TabKey[] = ['propostas', 'pipeline', 'faturamento', 'posVenda', 'marketing']

export default function RelatoriosOdin() {
  const [tab, setTab] = useState<TabKey>('propostas')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [vendedorId, setVendedorId] = useState('')
  const { data: vendedores } = trpc.users.vendors.useQuery()
  const utils = trpc.useUtils()
  const filtro = { dataDe: dataDe || undefined, dataAte: dataAte || undefined, vendedorId: vendedorId ? Number(vendedorId) : undefined }

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

      <div className="flex gap-1 border-b border-dark-700 mb-5 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {(TABS_COM_FILTRO_DATA.includes(tab) || TABS_COM_FILTRO_VENDEDOR.includes(tab)) && (
        <div className="flex gap-3 mb-4 max-w-2xl flex-wrap items-end">
          {TABS_COM_FILTRO_DATA.includes(tab) && (
            <>
              <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
              <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
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
      )}

      {tab === 'propostas' && <RelatorioPropostas filtro={filtro} />}
      {tab === 'pipeline' && <RelatorioPipeline filtro={filtro} />}
      {tab === 'posVenda' && <RelatorioPosVenda filtro={filtro} />}
      {tab === 'faturamento' && <RelatorioFaturamento filtro={filtro} />}
      {tab === 'maquinas' && <RelatorioMaquinas />}
      {tab === 'marketing' && <RelatorioMarketing filtro={filtro} />}
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
      <div className="grid grid-cols-3 gap-3 max-w-2xl">
        <Stat label="Total de propostas" value={data.total} />
        <Stat label="Convertidas em pedido" value={data.convertidas} />
        <Stat label="Taxa de conversão" value={`${data.taxaConversao}%`} />
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
      <Stat label="Total de pedidos" value={data.total} />
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
            <Barra key={status} label={status} valor={qtd} total={data.total} />
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
        <Stat label="Pós-venda registrados" value={data.total} />
        <Stat label="Com feedback do cliente" value={data.comFeedback} />
        <Stat label="NPS médio" value={data.mediaNps ?? '—'} />
        <Stat label="Com lembrete pendente" value={data.comLembretePendente} />
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
        <Stat label="Pedidos no período" value={data.totalPedidos} />
        <Stat label="Valor total" value={money(data.valorTotal)} />
        <Stat label="Valor confirmado" value={money(data.valorConfirmado)} />
        <Stat label="Pagamentos confirmados" value={data.qtdConfirmado} />
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
      <Stat label="Total em estoque cadastrado" value={data.total} />
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
        <button
          onClick={() => baixarCsvMarketing(data)}
          className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
        >
          <Download size={13} /> Exportar CSV
        </button>
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
          <Stat label="Total" value={data.visitas.total} />
          <Stat label="Planejadas" value={data.visitas.planejadas} />
          <Stat label="Em campo" value={data.visitas.campo} />
          <Stat label="Duração média" value={data.visitas.duracaoMediaMinutos != null ? `${data.visitas.duracaoMediaMinutos} min` : '—'} />
          <Stat label="Taxa → proposta" value={`${data.visitas.taxaConversaoProposta}%`} />
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
          <Stat label="Total" value={data.propostas.total} />
          <Stat label="Taxa → negociação" value={`${data.propostas.taxaNegociacao}%`} />
          <Stat label="Taxa → fechado" value={`${data.propostas.taxaFechado}%`} />
          <Stat label="Sem PDF anexado" value={data.propostas.semPdf} />
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
