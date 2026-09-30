import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import { formatarMoeda } from '../../lib/moeda'
import { hojeBrString } from '../../lib/utils'

function formatarHoras(h: number): string {
  if (!h || h <= 0) return '0h'
  const horas = Math.floor(h)
  const min = Math.round((h - horas) * 60)
  return min > 0 ? `${horas}h ${min}min` : `${horas}h`
}

function formatarDias(n: number): string {
  return n > 0 ? `${n.toFixed(1)} dias` : '—'
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <p className="text-[10px] text-dark-500 uppercase tracking-wide font-semibold">{label}</p>
      <p
        className={`font-bold font-mono tabular-nums text-dark-50 mt-1 break-words ${
          String(value).length > 13 ? 'text-lg' : String(value).length > 9 ? 'text-xl' : 'text-2xl'
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-dark-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// Relatório geral de Marketing — pedido do João, 2026-09-30: junta os
// números de Leads (tempo médio até 1º contato, tempo médio de
// fechamento, leads atendidos/criados no mês, vendas fechadas) de TODAS as
// empresas do grupo numa tela só, mais as vendas de Carteira de clientes
// marcados como "origem Marketing" — dado que não vem de Leads nenhum,
// vem do pipeline normal de clientes (Completar Cadastro > Marketing).
// Só o admin principal (superAdmin) enxerga (ver Sidebar.tsx e
// marketingGeral.ts — superAdminProcedure, nunca delegável por
// Permissões, mesmo padrão de Painel Financeiro/Painel de TV).
export default function MarketingRelatorioGeral() {
  const [mesReferencia, setMesReferencia] = useState(hojeBrString().slice(0, 7))
  const { data, isLoading } = trpc.marketingGeral.relatorioGeral.useQuery({ mesReferencia })

  return (
    <div className="p-6 max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-gold-400" />
          <div>
            <h1 className="font-heading text-xl text-dark-50">Marketing — Relatório Geral</h1>
            <p className="text-sm text-dark-400">Leads e vendas de Marketing de todas as empresas do grupo.</p>
          </div>
        </div>
        <Input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="w-40" />
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {data && (
        <>
          <div>
            <p className="text-xs text-dark-500 uppercase tracking-wide font-semibold mb-2">Total do grupo</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile
                label="Tempo médio até 1º contato"
                value={formatarHoras(data.total.tempoMedioPrimeiroContatoHoras)}
                sub="horas úteis"
              />
              <StatTile label="Tempo médio de fechamento" value={formatarDias(data.total.tempoMedioFechamentoDias)} sub="da atribuição até fechar" />
              <StatTile label="Leads atendidos no mês" value={String(data.total.leadsAtendidosNoPeriodo)} sub="com ao menos 1 contato" />
              <StatTile label="Leads novos no mês" value={String(data.total.leadsCriadosNoPeriodo)} sub="entraram no período" />
              <StatTile
                label="Vendas fechadas (Leads)"
                value={formatarMoeda(data.total.vendasFechadasValor)}
                sub={`${data.total.vendasFechadasQtd} lead(s) ganho(s)`}
              />
              <StatTile
                label="Vendas de Marketing (Carteira)"
                value={formatarMoeda(data.total.vendasMarketingValor)}
                sub={`${data.total.vendasMarketingQtd} venda(s) de cliente marcado como Marketing`}
              />
            </div>
          </div>

          <div>
            <p className="text-xs text-dark-500 uppercase tracking-wide font-semibold mb-2">Por empresa</p>
            <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-600 bg-dark-900/40">
                      <th className="text-left text-dark-400 font-medium px-4 py-3">Empresa</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">1º contato</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">Fechamento</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">Atendidos</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">Novos</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">Vendas (Leads)</th>
                      <th className="text-right text-dark-400 font-medium px-4 py-3">Vendas Marketing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {data.porEmpresa.map((e) => (
                      <tr key={e.empresaId}>
                        <td className="px-4 py-3 text-dark-100 font-medium">{e.empresaNome}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">
                          {e.amostraPrimeiroContato > 0 ? formatarHoras(e.tempoMedioPrimeiroContatoHoras) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">
                          {e.amostraFechamento > 0 ? formatarDias(e.tempoMedioFechamentoDias) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">{e.leadsAtendidosNoPeriodo}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">{e.leadsCriadosNoPeriodo}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">
                          {formatarMoeda(e.vendasFechadasValor)} <span className="text-dark-500 text-xs">({e.vendasFechadasQtd})</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-dark-300">
                          {formatarMoeda(e.vendasMarketingValor)} <span className="text-dark-500 text-xs">({e.vendasMarketingQtd})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
