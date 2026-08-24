import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Select from '../components/ui/Select'
import { Input } from '../components/ui/Input'
import Button from '../components/ui/Button'

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

function TooltipPadrao({ active, payload, label, formatarValor }: { active?: boolean; payload?: { value: number }[]; label?: string; formatarValor?: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium">{label}</p>
      <p className="text-dark-300">{formatarValor ? formatarValor(payload[0].value) : `${payload[0].value} chamado(s)`}</p>
    </div>
  )
}

function GraficoBarras({
  dados,
  corBarra,
  altura,
  formatarValor,
}: {
  dados: { rotulo: string; quantidade: number }[]
  corBarra: string
  altura?: number
  formatarValor?: (v: number) => string
}) {
  if (!dados.length) return <p className="text-xs text-dark-500">Sem dados ainda.</p>
  return (
    <ResponsiveContainer width="100%" height={altura ?? Math.max(120, dados.length * 34)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis dataKey="rotulo" type="category" tick={{ fill: COR_TICK, fontSize: 10 }} tickLine={false} axisLine={false} width={130} />
        <Tooltip content={<TooltipPadrao formatarValor={formatarValor} />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
        <Bar dataKey="quantidade" radius={[0, 4, 4, 0]} barSize={16}>
          {dados.map((d) => (
            <Cell key={d.rotulo} fill={corBarra} />
          ))}
          <LabelList
            dataKey="quantidade"
            position="right"
            fill={COR_TICK}
            fontSize={10}
            formatter={(v: unknown) => (formatarValor ? formatarValor(Number(v)) : String(v))}
          />
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
  const { user } = useAuth()
  const [empresaFiltro, setEmpresaFiltro] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && user.role === 'admin' && !user.superAdmin,
  })
  const temVisaoGlobal = !!user?.superAdmin || !!minhasFeatures?.includes('devolucoes_visao_global')
  const { data: empresasDevolucao } = trpc.devolucoes.listarEmpresasPublico.useQuery(undefined, { enabled: temVisaoGlobal })

  const { data, isLoading } = trpc.devolucoes.relatorio.useQuery({
    empresaId: empresaFiltro ? Number(empresaFiltro) : undefined,
    dataInicio: dataInicio || undefined,
    dataFim: dataFim || undefined,
  })

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
  const porProduto = data.porProduto.map((p) => ({ rotulo: p.chave, quantidade: p.quantidade }))
  const comissaoPorVendedor = data.comissaoPorVendedor?.map((c) => ({ rotulo: c.chave, quantidade: c.valor })) ?? null

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Relatórios — Devolução</h1>
        <p className="text-dark-400 text-sm">Visão geral dos chamados no seu alcance.</p>
      </div>

      {temVisaoGlobal && (
        <div className="flex flex-wrap items-end gap-3 bg-dark-900/40 border border-dark-700 rounded-2xl p-3">
          <Select
            label="Empresa"
            value={empresaFiltro}
            onChange={(e) => setEmpresaFiltro(e.target.value)}
            placeholder="Todas as empresas"
            options={(empresasDevolucao ?? []).map((e) => ({ value: e.id, label: e.nome }))}
            className="w-56"
          />
          <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          {(empresaFiltro || dataInicio || dataFim) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEmpresaFiltro('')
                setDataInicio('')
                setDataFim('')
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      )}

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
        {!!porProduto.length && (
          <Secao titulo="Produtos mais devolvidos">
            <GraficoBarras dados={porProduto} corBarra={COR_BARRA} />
          </Secao>
        )}
        {quemErrou && (
          <Secao titulo="Quem errou (análises)">
            <GraficoBarras dados={quemErrou} corBarra={COR_ALERTA} />
          </Secao>
        )}
        {comissaoPorVendedor && !!comissaoPorVendedor.length && (
          <Secao titulo="Impacto na comissão por vendedor">
            <GraficoBarras
              dados={comissaoPorVendedor}
              corBarra={COR_ALERTA}
              formatarValor={(v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            />
          </Secao>
        )}
      </div>
    </div>
  )
}
