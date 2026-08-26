import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import { STAGE_LABELS, type Stage } from '../lib/ordensShared'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../lib/propostasShared'

type TabKey = 'propostas' | 'pipeline' | 'posVenda' | 'faturamento' | 'maquinas' | 'visitas'
const TAB_LABELS: Record<TabKey, string> = {
  propostas: 'Propostas',
  pipeline: 'Pipeline de Pedidos',
  posVenda: 'Pós-Venda',
  faturamento: 'Faturamento',
  maquinas: 'Máquinas',
  visitas: 'Visitas (Marketing)',
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

export default function RelatoriosOdin() {
  const [tab, setTab] = useState<TabKey>('propostas')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const filtro = { dataDe: dataDe || undefined, dataAte: dataAte || undefined }

  return (
    <div className="p-6">
      <h1 className="font-heading text-2xl text-dark-50 font-bold mb-4 flex items-center gap-2"><BarChart3 size={22} /> Relatórios</h1>

      <div className="flex gap-1 border-b border-dark-700 mb-5 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {(tab === 'propostas' || tab === 'pipeline' || tab === 'faturamento' || tab === 'visitas') && (
        <div className="flex gap-3 mb-4 max-w-md">
          <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        </div>
      )}

      {tab === 'propostas' && <RelatorioPropostas filtro={filtro} />}
      {tab === 'pipeline' && <RelatorioPipeline filtro={filtro} />}
      {tab === 'posVenda' && <RelatorioPosVenda />}
      {tab === 'faturamento' && <RelatorioFaturamento filtro={filtro} />}
      {tab === 'maquinas' && <RelatorioMaquinas />}
      {tab === 'visitas' && <RelatorioVisitas filtro={filtro} />}
    </div>
  )
}

function RelatorioPropostas({ filtro }: { filtro: { dataDe?: string; dataAte?: string } }) {
  const { data, isLoading } = trpc.relatoriosOdin.propostas.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="space-y-5">
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

function RelatorioPipeline({ filtro }: { filtro: { dataDe?: string; dataAte?: string } }) {
  const { data, isLoading } = trpc.relatoriosOdin.pipeline.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="space-y-5">
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

function RelatorioPosVenda() {
  const { data, isLoading } = trpc.relatoriosOdin.posVenda.useQuery()
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
      <Stat label="Pós-venda registrados" value={data.total} />
      <Stat label="Com feedback do cliente" value={data.comFeedback} />
      <Stat label="NPS médio" value={data.mediaNps ?? '—'} />
      <Stat label="Com lembrete pendente" value={data.comLembretePendente} />
    </div>
  )
}

function RelatorioFaturamento({ filtro }: { filtro: { dataDe?: string; dataAte?: string } }) {
  const { data, isLoading } = trpc.relatoriosOdin.faturamento.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
      <Stat label="Pedidos no período" value={data.totalPedidos} />
      <Stat label="Valor total" value={money(data.valorTotal)} />
      <Stat label="Valor confirmado" value={money(data.valorConfirmado)} />
      <Stat label="Pagamentos confirmados" value={data.qtdConfirmado} />
    </div>
  )
}

function RelatorioMaquinas() {
  const { data, isLoading } = trpc.relatoriosOdin.maquinas.useQuery()
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="space-y-5">
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

function RelatorioVisitas({ filtro }: { filtro: { dataDe?: string; dataAte?: string } }) {
  const { data, isLoading } = trpc.relatoriosOdin.visitas.useQuery(filtro)
  if (isLoading || !data) return <p className="text-dark-400 text-sm">Carregando...</p>
  return (
    <div className="space-y-5">
      <Stat label="Total de visitas" value={data.total} />
      <div className="max-w-md space-y-2">
        <h3 className="text-sm font-semibold text-dark-300 mb-2">Por resultado</h3>
        {Object.entries(data.porResultado).map(([r, qtd]) => (
          <Barra key={r} label={RESULTADO_LABELS[r] ?? r} valor={qtd} total={data.total} />
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-dark-300 mb-2">Por vendedor</h3>
        <div className="space-y-1.5 max-w-lg">
          {data.porVendedor.map((v) => (
            <div key={v.vendedorId} className="flex items-center justify-between px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm">
              <span className="text-dark-200">{v.vendedorNome}</span>
              <span className="text-dark-500">{v.total} visitas · {v.propostas} viraram proposta</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
