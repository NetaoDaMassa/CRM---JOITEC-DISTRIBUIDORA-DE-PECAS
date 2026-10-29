import { useState } from 'react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function dataHoraBr(utc: string | null): string {
  if (!utc) return '—'
  const d = new Date(`${utc.replace(' ', 'T')}Z`)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const EMPRESA: Record<string, string> = {
  joitec: 'Joitec',
  'odin-tubos': 'Odin Tubos',
  'odin-compressores': 'Odin Compressores',
  'joitec-automacao': 'Odin Automação',
}

const TIPO: Record<string, string> = { nota: 'Nota', titulo_antigo: 'Título antigo', devolucao: 'Devolução', adiantamento: 'Fatura de adiantamento' }

function corAtraso(dias: number): string {
  if (dias > 90) return 'bg-red-900/30 text-red-300'
  if (dias > 30) return 'bg-orange-900/30 text-orange-300'
  return 'bg-yellow-900/30 text-yellow-300'
}

// Quem está devendo, direto do SAP (pedido do João, 2026-10-29) — ficha do
// cliente e card do Kanban. Só aparece se o cliente tem algo em aberto no
// SAP. `compacto` (card do Kanban): só a faixa, com a lista abrindo no clique.
export default function InadimplenciaCliente({ clienteId, compacto = false }: { clienteId: number; compacto?: boolean }) {
  const { data } = trpc.sapFinanceiro.doCliente.useQuery({ clienteId })
  const [aberto, setAberto] = useState(!compacto)

  if (!data || data.titulos.length === 0) return null

  const faixa = data.inadimplente ? (
    <div className="flex gap-3 items-start bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
      <span className="text-lg leading-none">⚠️</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-red-200">
          Cliente com {formatarMoeda(data.vencido)} vencido, com atraso de até {data.maiorAtraso} dias
        </p>
        <p className="text-xs text-red-300/90 mt-0.5">
          Confirme com o financeiro antes de vender a prazo.
          {compacto && (
            <button type="button" onClick={() => setAberto((v) => !v)} className="ml-2 underline hover:text-red-200">
              {aberto ? 'Esconder parcelas' : 'Ver parcelas'}
            </button>
          )}
        </p>
      </div>
    </div>
  ) : null

  if (compacto && !data.inadimplente) return null

  return (
    <div className={compacto ? 'space-y-2' : 'bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4'}>
      {!compacto && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-dark-100">💰 Situação financeira</h2>
          <span className="text-xs text-dark-500">SAP · atualizado {dataHoraBr(data.atualizadoEm)}</span>
        </div>
      )}
      {faixa}
      {aberto && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-dark-400">Vencido</p>
              <p className={`text-lg font-bold font-mono ${data.vencido > 0 ? 'text-red-300' : 'text-dark-50'}`}>{formatarMoeda(data.vencido)}</p>
            </div>
            <div>
              <p className="text-xs text-dark-400">Maior atraso</p>
              <p className={`text-lg font-bold font-mono ${data.maiorAtraso > 0 ? 'text-red-300' : 'text-dark-50'}`}>{data.maiorAtraso} dias</p>
            </div>
            <div>
              <p className="text-xs text-dark-400">A vencer</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.aVencer)}</p>
            </div>
            <div>
              <p className="text-xs text-dark-400">Saldo no SAP</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.saldoSap)}</p>
              {data.creditos < 0 && <p className="text-xs text-dark-500">já descontada devolução de {formatarMoeda(-data.creditos)}</p>}
            </div>
          </div>
          {!data.confereComSap && (
            <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
              A soma das parcelas abaixo não bate com o saldo do cliente no SAP. Confira no SAP antes de cobrar.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-dark-400 text-left">
                  <th className="py-1.5 pr-3 font-medium">Vencimento</th>
                  <th className="py-1.5 pr-3 font-medium">Atraso</th>
                  <th className="py-1.5 pr-3 font-medium">Documento</th>
                  <th className="py-1.5 pr-3 font-medium">Empresa</th>
                  <th className="py-1.5 font-medium text-right">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {data.titulos.map((t, i) => (
                  <tr key={i} className="border-t border-dark-700/70">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{t.tipo === 'devolucao' ? `emitida ${dataBr(t.emissao)}` : dataBr(t.vencimento)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {t.diasAtraso > 0 ? (
                        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${corAtraso(t.diasAtraso)}`}>{t.diasAtraso} dias</span>
                      ) : (
                        <span className="text-xs text-dark-500">{t.tipo === 'devolucao' ? 'crédito' : 'no prazo'}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-dark-300">
                      {TIPO[t.tipo]} <span className="font-mono">{t.documento}</span>
                      {t.parcela && <span className="text-dark-500"> · parc. {t.parcela}</span>}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-dark-300">{(t.empresaSlug && EMPRESA[t.empresaSlug]) || '—'}</td>
                    <td className={`py-1.5 text-right font-mono whitespace-nowrap ${t.valor < 0 ? 'text-green-300' : ''}`}>{formatarMoeda(t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.titulos.some((t) => t.tipo === 'titulo_antigo') && (
            <p className="text-xs text-dark-500">"Título antigo" = conta do sistema anterior, lançada no SAP quando ele começou (31/03/2026).</p>
          )}
        </>
      )}
    </div>
  )
}
