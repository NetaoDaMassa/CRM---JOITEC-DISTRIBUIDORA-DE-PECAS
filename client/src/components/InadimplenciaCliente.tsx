import { useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
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

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}

function diasAte(iso: string): number {
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(hojeBr())) / 86400000)
}

const EMPRESA: Record<string, string> = {
  joitec: 'Joitec',
  'odin-tubos': 'Odin Tubos',
  'odin-compressores': 'Odin Compressores',
  'joitec-automacao': 'Odin Automação',
}

const TIPO: Record<string, string> = { nota: 'NF', titulo_antigo: 'Título antigo', devolucao: 'Devolução', adiantamento: 'Fatura de adiantamento' }

function corAtraso(dias: number): string {
  if (dias > 90) return 'bg-red-900/30 text-red-300'
  if (dias > 30) return 'bg-orange-900/30 text-orange-300'
  return 'bg-yellow-900/30 text-yellow-300'
}

type Titulo = NonNullable<inferRouterOutputs<AppRouter>['sapFinanceiro']['doCliente']>['titulos'][number]

function TabelaBoletos({ titulos, aVencer }: { titulos: Titulo[]; aVencer: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-dark-400 text-left">
            <th className="py-1.5 pr-3 font-medium">Vencimento</th>
            <th className="py-1.5 pr-3 font-medium">{aVencer ? 'Vence em' : 'Atraso'}</th>
            <th className="py-1.5 pr-3 font-medium">Documento</th>
            <th className="py-1.5 pr-3 font-medium">Empresa</th>
            <th className="py-1.5 font-medium text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {titulos.map((t, i) => {
            const falta = t.vencimento ? diasAte(t.vencimento) : 0
            return (
              <tr key={i} className="border-t border-dark-700/70">
                <td className="py-1.5 pr-3 whitespace-nowrap">{dataBr(t.vencimento)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {aVencer ? (
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${falta <= 7 ? 'bg-amber-900/40 text-amber-200' : 'text-dark-300'}`}>
                      {falta === 0 ? 'hoje' : falta === 1 ? 'amanhã' : `${falta} dias`}
                    </span>
                  ) : (
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${corAtraso(t.diasAtraso)}`}>{t.diasAtraso} dias</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-dark-300">
                  {TIPO[t.tipo]} <span className="font-mono">{t.documento}</span>
                  {t.parcela && <span className="text-dark-500"> · parc. {t.parcela}</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-dark-300">{(t.empresaSlug && EMPRESA[t.empresaSlug]) || '—'}</td>
                <td className="py-1.5 text-right font-mono whitespace-nowrap">{formatarMoeda(t.valor)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Situação financeira do cliente direto do SAP (pedidos do João,
// 2026-10-29/30) — ficha do cliente e card do Kanban: boletos vencidos (com
// a faixa de inadimplência) e boletos a vencer (destaque nos próximos 7
// dias). `compacto` (card do Kanban): só as faixas, com as listas abrindo no
// clique.
export default function InadimplenciaCliente({ clienteId, compacto = false }: { clienteId: number; compacto?: boolean }) {
  const { data } = trpc.sapFinanceiro.doCliente.useQuery({ clienteId })
  const [aberto, setAberto] = useState(!compacto)

  if (!data || data.titulos.length === 0) return null

  const vencidos = data.titulos.filter((t) => t.valor > 0 && t.diasAtraso > 0)
  const aVencer = data.titulos.filter((t) => t.valor > 0 && t.diasAtraso === 0 && t.vencimento)
  const creditos = data.titulos.filter((t) => t.valor < 0)
  const proximos7 = aVencer.filter((t) => diasAte(t.vencimento!) <= 7)
  const proximo = aVencer[0]

  if (compacto && !data.inadimplente && aVencer.length === 0) return null

  const faixaVencido = data.inadimplente ? (
    <div className="flex gap-3 items-start bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
      <span className="text-lg leading-none">⚠️</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-red-200">
          Cliente com {formatarMoeda(data.vencido)} vencido, com atraso de até {data.maiorAtraso} dias
        </p>
        <p className="text-xs text-red-300/90 mt-0.5">Confirme com o financeiro antes de vender a prazo.</p>
      </div>
    </div>
  ) : null

  const faixaAVencer =
    aVencer.length > 0 ? (
      <div className="flex gap-3 items-start bg-sky-900/15 border border-sky-700/40 rounded-xl px-4 py-2.5">
        <span className="text-lg leading-none">📄</span>
        <p className="text-sm text-sky-100 min-w-0">
          {aVencer.length} boleto(s) a vencer · {formatarMoeda(data.aVencer)}
          {proximo?.vencimento && <span className="text-sky-300"> · próximo {dataBr(proximo.vencimento)}</span>}
          {proximos7.length > 0 && <span className="ml-1 font-semibold text-amber-200">({proximos7.length} vence(m) em até 7 dias)</span>}
        </p>
      </div>
    ) : null

  return (
    <div className={compacto ? 'space-y-2' : 'bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4'}>
      {!compacto && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-dark-100">💰 Situação financeira · boletos</h2>
          <span className="text-xs text-dark-500">SAP · atualizado {dataHoraBr(data.atualizadoEm)}</span>
        </div>
      )}
      {faixaVencido}
      {faixaAVencer}
      {compacto && (
        <button type="button" onClick={() => setAberto((v) => !v)} className="text-xs text-gold-400 hover:underline">
          {aberto ? '▾ Esconder boletos' : '▸ Ver boletos'}
        </button>
      )}
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
          {vencidos.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-red-300">Boletos vencidos ({vencidos.length})</p>
              <TabelaBoletos titulos={vencidos} aVencer={false} />
            </div>
          )}
          {aVencer.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-sky-300">Boletos a vencer ({aVencer.length})</p>
              <TabelaBoletos titulos={aVencer} aVencer />
            </div>
          )}
          {creditos.length > 0 && (
            <p className="text-xs text-green-300">
              Crédito do cliente: {creditos.map((c) => `${TIPO[c.tipo]} ${c.documento} (${formatarMoeda(-c.valor)})`).join(' · ')}
            </p>
          )}
          {data.titulos.some((t) => t.tipo === 'titulo_antigo') && (
            <p className="text-xs text-dark-500">"Título antigo" = conta do sistema anterior, lançada no SAP quando ele começou (31/03/2026).</p>
          )}
        </>
      )}
    </div>
  )
}
