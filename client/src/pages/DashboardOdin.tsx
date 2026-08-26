// Dashboard consolidado (Odin Compressores) — portado de pages/Dashboard.tsx
// do odincrm.duckdns.org. Junta numa tela só o que hoje fica espalhado em
// telas separadas: pedidos por etapa/status, propostas, visitas, alertas de
// pedido parado, últimos pedidos e performance por vendedor.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, Clock, CheckCircle2, XCircle, AlertTriangle, FileText, MapPin,
  TrendingUp, RefreshCw, DollarSign, Wrench, Timer, Download, LayoutDashboard, CalendarRange,
} from 'lucide-react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Legend } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../lib/trpc'
import { Input } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { STAGE_LABELS, STAGE_COLORS, STAGE_COLORS_HEX, type Stage } from '../lib/ordensShared'

function money(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function horasParaTexto(h: number | null): string {
  if (h == null) return '—'
  const dias = Math.floor(h / 24)
  const horas = Math.round(h % 24)
  return dias > 0 ? `${dias}d ${horas}h` : `${horas}h`
}

// Atalho "Mês" — preenche De/Até com o mês inteiro de uma vez, igual ao
// MonthQuickFill de Relatorios.tsx no odincrm original.
function monthToRange(mes: string): { from: string; to: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { from: `${mes}-01`, to: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

const STATUS_COLORS_HEX = ['#f59e0b', '#22c55e', '#ef4444']

function StatCard({ label, value, sub, icon, colorClass }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; colorClass: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex items-start gap-3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colorClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark-50 leading-tight">{value}</p>
        <p className="text-xs text-dark-400 leading-tight mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-dark-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function baixarCsv(resumo: NonNullable<ReturnType<typeof useResumo>['data']>) {
  const linhas: string[] = []
  linhas.push('=== RESUMO ===')
  linhas.push('Métrica,Valor')
  linhas.push(`Total de Pedidos,${resumo.pedidos.total}`)
  linhas.push(`Em Andamento,${resumo.pedidos.active}`)
  linhas.push(`Concluídos,${resumo.pedidos.completed}`)
  linhas.push(`Cancelados,${resumo.pedidos.cancelled}`)
  linhas.push(`Pedidos Criados nos Últimos 30 Dias,${resumo.pedidos.recentes30d}`)
  linhas.push(`Total de Propostas,${resumo.propostas.total}`)
  linhas.push(`Propostas Convertidas,${resumo.propostas.convertidas}`)
  linhas.push(`Total de Visitas,${resumo.visitas.total}`)
  linhas.push(`Visitas este Mês,${resumo.visitas.mesAtual}`)
  linhas.push(`Ticket Médio,${resumo.pedidos.ticketMedio ?? ''}`)
  linhas.push(`Máquinas Vendidas,${resumo.pedidos.maquinasVendidas}`)
  linhas.push(`Tempo Médio de Ciclo (horas),${resumo.pedidos.cicloMedioHoras ?? ''}`)
  linhas.push('')
  linhas.push('=== PEDIDOS POR ETAPA ===')
  linhas.push('Etapa,Pedidos')
  for (const [etapa, qtd] of Object.entries(resumo.pedidos.byStage)) {
    if (qtd) linhas.push(`${STAGE_LABELS[etapa as Stage] ?? etapa},${qtd}`)
  }
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dashboard_odin_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function useResumo(input: { dataDe?: string; dataAte?: string; vendedorId?: number }) {
  return trpc.dashboardOdin.resumo.useQuery(input)
}

export default function DashboardOdin() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [mes, setMes] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [vendedorId, setVendedorId] = useState('')

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })
  const input = { dataDe: dataDe || undefined, dataAte: dataAte || undefined, vendedorId: vendedorId ? Number(vendedorId) : undefined }
  const { data, isLoading, refetch, isFetching } = useResumo(input)

  const basePath = isAdmin ? '/admin/ordens' : '/vendedor/ordens'
  const hasFiltro = !!(dataDe || dataAte || vendedorId)

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

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <p className="text-dark-400 text-sm">Carregando...</p>
      </div>
    )
  }

  const stageData = (Object.keys(STAGE_LABELS) as Stage[])
    .map((stage) => ({ stage, name: STAGE_LABELS[stage], count: data.pedidos.byStage[stage] ?? 0, fill: STAGE_COLORS_HEX[stage] }))
    .filter((d) => d.count > 0)

  const statusData = [
    { name: 'Em andamento', value: data.pedidos.active },
    { name: 'Concluídos', value: data.pedidos.completed },
    { name: 'Cancelados', value: data.pedidos.cancelled },
  ].filter((d) => d.value > 0)

  const convRate = data.propostas.taxaConversao

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading text-2xl text-dark-50 font-bold flex items-center gap-2">
          <LayoutDashboard size={22} /> Dashboard Odin
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={mes}
            onChange={(e) => aplicarMes(e.target.value)}
            title="Atalho: preenche De/Até com o mês inteiro"
            className="w-[130px] bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-2 text-sm text-dark-100 focus:outline-none focus:border-gold-600"
          />
          <CalendarRange size={13} className="text-dark-500 -mx-1" />
          <Input type="date" value={dataDe} onChange={(e) => alterarData('de', e.target.value)} className="w-[150px]" />
          <span className="text-dark-500 text-xs">até</span>
          <Input type="date" value={dataAte} onChange={(e) => alterarData('ate', e.target.value)} className="w-[150px]" />
          {isAdmin && (
            <Select
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos os vendedores"
              className="w-44"
              options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
            />
          )}
          {hasFiltro && (
            <button onClick={() => { setMes(''); setDataDe(''); setDataAte(''); setVendedorId('') }} className="text-xs text-dark-400 hover:text-dark-200 underline">
              Limpar
            </button>
          )}
          <button
            onClick={() => baixarCsv(data)}
            className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-2 text-xs font-medium text-dark-300 hover:bg-dark-800 transition-colors"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-gold-400 transition-colors"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {data.alertas.length > 0 && (
        <div className="bg-dark-800 border-l-4 border-red-500 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-500 shrink-0" />
            <p className="font-semibold text-red-400 text-sm">{data.alertas.length} pedido(s) com alerta</p>
          </div>
          <div className="space-y-1">
            {data.alertas.slice(0, 5).map((a) => (
              <Link key={a.ordemId} to={`${basePath}/${a.ordemId}`} className="flex items-center gap-2 text-xs hover:underline">
                <span className={a.nivel === 'vermelho' ? 'text-red-400' : 'text-orange-400'}>
                  • Pedido #{a.ordemId} ({a.clienteNome}): parado em {STAGE_LABELS[a.stage as Stage] ?? a.stage}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total de Pedidos" value={data.pedidos.total} sub={`${data.pedidos.recentes30d} nos últimos 30 dias`} icon={<Package size={20} className="text-white" />} colorClass="bg-blue-600" />
        <StatCard label="Em Andamento" value={data.pedidos.active} icon={<Clock size={20} className="text-white" />} colorClass="bg-amber-500" />
        <StatCard label="Concluídos" value={data.pedidos.completed} icon={<CheckCircle2 size={20} className="text-white" />} colorClass="bg-green-500" />
        <StatCard label="Cancelados" value={data.pedidos.cancelled} icon={<XCircle size={20} className="text-white" />} colorClass="bg-red-500" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total de Propostas" value={data.propostas.total} sub={`${data.propostas.convertidas} convertidas em pedido`} icon={<FileText size={20} className="text-white" />} colorClass="bg-purple-500" />
        <StatCard label="Taxa de Conversão" value={`${convRate}%`} sub="proposta → pedido" icon={<TrendingUp size={20} className="text-white" />} colorClass="bg-teal-500" />
        <StatCard label="Total de Visitas" value={data.visitas.total} icon={<MapPin size={20} className="text-white" />} colorClass="bg-sky-500" />
        <StatCard label="Visitas este Mês" value={data.visitas.mesAtual} icon={<MapPin size={20} className="text-white" />} colorClass="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Ticket Médio" value={money(data.pedidos.ticketMedio)} sub="valor médio dos pedidos no período" icon={<DollarSign size={20} className="text-white" />} colorClass="bg-emerald-600" />
        <StatCard label="Máquinas Vendidas" value={data.pedidos.maquinasVendidas} sub="no período filtrado" icon={<Wrench size={20} className="text-white" />} colorClass="bg-cyan-600" />
        <StatCard label="Tempo Médio de Ciclo" value={horasParaTexto(data.pedidos.cicloMedioHoras)} sub="pedidos concluídos no período" icon={<Timer size={20} className="text-white" />} colorClass="bg-violet-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-dark-100 mb-4">Pedidos por Etapa</h2>
          {stageData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-dark-500">Nenhum pedido no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={stageData} margin={{ top: 4, right: 4, bottom: 48, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#898781' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#898781' }} allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'Pedidos']} contentStyle={{ fontSize: 12, background: '#1a2028', border: '1px solid #2a3644' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stageData.map((d) => (
                    <Cell key={d.stage} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-4">Status Geral</h2>
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-dark-500">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="44%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={STATUS_COLORS_HEX[i]} />
                  ))}
                </Pie>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#898781' }} />
                <Tooltip contentStyle={{ fontSize: 12, background: '#1a2028', border: '1px solid #2a3644' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${isAdmin ? 'lg:grid-cols-2' : ''}`}>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-dark-100 mb-3">Últimos Pedidos</h2>
          {data.recentes.length === 0 ? (
            <p className="text-sm text-dark-500 text-center py-6">Nenhum pedido ainda</p>
          ) : (
            <div className="divide-y divide-dark-700/60">
              {data.recentes.map((o) => (
                <Link key={o.id} to={`${basePath}/${o.id}`} className="flex items-center gap-3 py-2.5 hover:bg-dark-900/40 -mx-2 px-2 rounded-lg transition-colors">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-900/30 text-xs font-bold text-gold-400">#{o.id}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-dark-100 truncate">{o.clienteNome}</p>
                    {isAdmin && <p className="text-xs text-dark-500 truncate">{o.vendedorNome}</p>}
                  </div>
                  <Badge className={STAGE_COLORS[o.stage as Stage]}>{STAGE_LABELS[o.stage as Stage] ?? o.stage}</Badge>
                </Link>
              ))}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-dark-100 mb-3">Performance por Vendedor</h2>
            {data.porVendedor.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-6">Sem dados</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700 text-dark-400 text-[11px] uppercase tracking-wide">
                      <th className="text-left font-semibold py-2">Vendedor</th>
                      <th className="text-right font-semibold py-2">Total</th>
                      <th className="text-right font-semibold py-2">Ativos</th>
                      <th className="text-right font-semibold py-2">Concl.</th>
                      <th className="text-right font-semibold py-2">Canc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700/60">
                    {data.porVendedor.map((v) => (
                      <tr key={v.vendedorId}>
                        <td className="py-2 text-dark-100 font-medium">{v.nome}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-dark-300">{v.total}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-amber-400">{v.active}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-green-400">{v.completed}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-red-400">{v.cancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
