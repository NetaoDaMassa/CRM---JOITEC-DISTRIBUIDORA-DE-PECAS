import { useState } from 'react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  aberto: { rotulo: 'Aberta', classe: 'bg-sky-500/15 text-sky-400' },
  fechado: { rotulo: 'Fechada', classe: 'bg-emerald-500/15 text-emerald-400' },
  cancelado: { rotulo: 'Cancelada', classe: 'bg-red-500/15 text-red-400' },
  outro: { rotulo: '—', classe: 'bg-dark-700 text-dark-300' },
}

// Cotações/orçamentos importados do SAP (pedido do João, 2026-10-20) — só
// consulta, igual ao Histórico de vendas (SAP) logo acima. Some se o cliente
// não tiver nenhuma cotação em lote ligado.
export default function HistoricoCotacoesSapCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.historicoSap.cotacoesDoCliente.useQuery({ clienteId })
  const [filtro, setFiltro] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  if (!data || data.total.qtd === 0) return null

  const lista = filtro ? data.cotacoes.filter((c) => c.status === filtro) : data.cotacoes
  const visiveis = verTodos ? lista : lista.slice(0, 10)
  const chips = [
    { chave: null, rotulo: 'Todas', ...data.total },
    { chave: 'aberto', rotulo: 'Abertas', ...data.aberto },
    { chave: 'fechado', rotulo: 'Fechadas', ...data.fechado },
    { chave: 'cancelado', rotulo: 'Canceladas', ...data.cancelado },
  ].filter((c) => c.chave === null || c.qtd > 0)

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dark-100">📝 Histórico de cotações (SAP)</h2>
        <span className="text-xs text-dark-500">só consulta</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-dark-400">Cotações</p>
          <p className="text-lg font-bold font-mono text-dark-50">{data.total.qtd}</p>
          <p className="text-xs text-dark-500">{formatarMoeda(data.total.valor, { casas: 0 })}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Fechadas</p>
          <p className="text-lg font-bold font-mono text-dark-50">{data.fechado.qtd}</p>
          <p className="text-xs text-dark-500">{formatarMoeda(data.fechado.valor, { casas: 0 })}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400" title="Fechadas ÷ (fechadas + canceladas). Cotação aberta ainda não conta.">
            Taxa de fechamento
          </p>
          <p className="text-lg font-bold font-mono text-dark-50">{data.taxaFechamento == null ? '—' : `${data.taxaFechamento.toFixed(0)}%`}</p>
          <p className="text-xs text-dark-500">{data.aberto.qtd} ainda aberta(s)</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Última cotação</p>
          <p className="text-lg font-bold font-mono text-dark-50">{dataBr(data.ultima)}</p>
          <p className="text-xs text-dark-500">desde {dataBr(data.primeira)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.rotulo}
            onClick={() => setFiltro(c.chave)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
              filtro === c.chave ? 'border-gold-500 text-gold-400 bg-gold-600/10' : 'border-dark-600 text-dark-300 hover:border-dark-400'
            }`}
          >
            {c.rotulo} · {c.qtd}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400">
            <tr>
              <th className="text-left font-normal py-1.5">Data</th>
              <th className="text-left font-normal py-1.5">Nº Cotação</th>
              <th className="text-left font-normal py-1.5">Situação</th>
              <th className="text-right font-normal py-1.5">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {visiveis.map((c) => (
              <tr key={c.id} className="text-dark-200">
                <td className="py-1.5">{dataBr(c.dataCotacao)}</td>
                <td className="py-1.5 font-mono">{c.numeroCotacao}</td>
                <td className="py-1.5">
                  <span className={`px-2 py-0.5 rounded-md text-xs ${STATUS[c.status]?.classe ?? STATUS.outro.classe}`}>{STATUS[c.status]?.rotulo ?? c.status}</span>
                </td>
                <td className="py-1.5 text-right font-mono">{formatarMoeda(c.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > 10 && (
        <button onClick={() => setVerTodos((v) => !v)} className="text-xs text-gold-400 hover:underline">
          {verTodos ? 'Mostrar menos' : `Ver todas as ${lista.length} cotações`}
        </button>
      )}
    </div>
  )
}
