import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { trpc } from '../lib/trpc'

const COR_BARRA = '#3987e5'
const COR_POSITIVO = '#0ca30c'
const COR_ALERTA = '#e5484d'
const COR_GRID = '#2a3644'
const COR_TICK = '#898781'

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo',
  em_andamento: 'Em andamento',
  analise: 'Análise',
  nota_fiscal_devolucao: 'Nota fiscal devolução',
  chegada_materiais: 'Chegada materiais',
  preparacao_envio: 'Preparação e envio',
  rastreio_transportadora: 'Rastreio transportadora',
  finalizado: 'Finalizado',
}

const OCORRENCIA_LABEL: Record<string, string> = {
  envio_errado: 'Envio errado',
  falta_materiais: 'Falta de materiais',
  produto_defeito: 'Produto com defeito',
  outro: 'Outro',
}

const QUEM_ERROU_LABEL: Record<string, string> = {
  cliente: 'Cliente',
  estoque: 'Estoque',
  transportadora: 'Transportadora',
  vendedor: 'Vendedor',
  defeito: 'Defeito de fábrica',
}

function TooltipPadrao({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium">{label}</p>
      <p className="text-dark-300">{payload[0].value} chamado(s)</p>
    </div>
  )
}

function GraficoBarras({ dados, corBarra, altura }: { dados: { rotulo: string; quantidade: number }[]; corBarra: string; altura?: number }) {
  if (!dados.length) return <p className="text-xs text-dark-500">Sem dados ainda.</p>
  return (
    <ResponsiveContainer width="100%" height={altura ?? Math.max(120, dados.length * 34)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis dataKey="rotulo" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={130} />
        <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
        <Bar dataKey="quantidade" radius={[0, 4, 4, 0]} barSize={16}>
          {dados.map((d) => (
            <Cell key={d.rotulo} fill={corBarra} />
          ))}
          <LabelList dataKey="quantidade" position="right" fill={COR_TICK} fontSize={10} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-dark-100 mb-3">{titulo}</h2>
      {children}
    </div>
  )
}

export default function DevolucaoRelatorios() {
  const { data, isLoading } = trpc.devolucoes.relatorio.useQuery()

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <p className="text-dark-400 text-sm">Carregando...</p>
      </div>
    )
  }

  const porStatus = data.porStatus.map((s) => ({ rotulo: STATUS_LABEL[s.chave] ?? s.chave, quantidade: s.quantidade }))
  const porVendedor = data.porVendedor.map((v) => ({ rotulo: v.chave, quantidade: v.quantidade }))
  const porOcorrencia = data.porOcorrencia.map((o) => ({ rotulo: OCORRENCIA_LABEL[o.chave] ?? o.chave, quantidade: o.quantidade }))
  const porEmpresa = data.porEmpresa.map((e) => ({ rotulo: e.chave, quantidade: e.quantidade }))
  const quemErrou = data.quemErrou?.map((q) => ({ rotulo: QUEM_ERROU_LABEL[q.chave] ?? q.chave, quantidade: q.quantidade })) ?? null

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Relatórios — Devolução</h1>
        <p className="text-dark-400 text-sm">Visão geral dos chamados no seu alcance.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Total de chamados</p>
          <p className="text-2xl font-bold text-dark-50">{data.totalChamados}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Finalizados</p>
          <p className="text-2xl font-bold text-dark-50">{data.totalFinalizados}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Taxa de análise positiva</p>
          <p className="text-2xl font-bold" style={{ color: data.taxaPositiva === null ? undefined : data.taxaPositiva >= 50 ? COR_POSITIVO : COR_ALERTA }}>
            {data.taxaPositiva === null ? '—' : `${data.taxaPositiva}%`}
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-400">Tempo médio até finalizar</p>
          <p className="text-2xl font-bold text-dark-50">{data.tempoMedioResolucaoDias === null ? '—' : `${data.tempoMedioResolucaoDias}d`}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Secao titulo="Chamados por status">
          <GraficoBarras dados={porStatus} corBarra={COR_BARRA} />
        </Secao>
        <Secao titulo="Chamados por vendedor">
          <GraficoBarras dados={porVendedor} corBarra={COR_BARRA} />
        </Secao>
        <Secao titulo="Tipo de ocorrência">
          <GraficoBarras dados={porOcorrencia} corBarra={COR_BARRA} />
        </Secao>
        {porEmpresa.length > 1 && (
          <Secao titulo="Chamados por empresa">
            <GraficoBarras dados={porEmpresa} corBarra={COR_BARRA} />
          </Secao>
        )}
        {quemErrou && (
          <Secao titulo="Quem errou (análises)">
            <GraficoBarras dados={quemErrou} corBarra={COR_ALERTA} />
          </Secao>
        )}
      </div>
    </div>
  )
}
