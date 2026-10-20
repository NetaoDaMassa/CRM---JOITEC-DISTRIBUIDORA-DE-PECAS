import { useState } from 'react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

// Histórico de vendas importado do SAP (tela Histórico SAP) — só consulta,
// separado das vendas do CRM. Não aparece nada se o cliente não tiver
// nenhum pedido em importação ligada.
export default function HistoricoSapCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.historicoSap.doCliente.useQuery({ clienteId })
  const [anoFiltro, setAnoFiltro] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  if (!data || data.qtdPedidos === 0) return null

  const pedidos = anoFiltro ? data.pedidos.filter((p) => p.dataPedido.startsWith(anoFiltro)) : data.pedidos
  const visiveis = verTodos ? pedidos : pedidos.slice(0, 10)

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dark-100">🧾 Histórico de vendas (SAP)</h2>
        <span className="text-xs text-dark-500">só consulta · não entra em metas</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-dark-400">Total comprado</p>
          <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.total, { casas: 0 })}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Pedidos</p>
          <p className="text-lg font-bold font-mono text-dark-50">{data.qtdPedidos}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Ticket médio</p>
          <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.ticketMedio, { casas: 0 })}</p>
        </div>
        <div>
          <p className="text-xs text-dark-400">Última compra</p>
          <p className="text-lg font-bold font-mono text-dark-50">{dataBr(data.ultimaCompra)}</p>
          <p className="text-xs text-dark-500">desde {dataBr(data.primeiraCompra)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setAnoFiltro(null)}
          className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
            !anoFiltro ? 'border-gold-500 text-gold-400 bg-gold-600/10' : 'border-dark-600 text-dark-300 hover:border-dark-400'
          }`}
        >
          Todos
        </button>
        {data.porAno.map((a) => (
          <button
            key={a.ano}
            onClick={() => setAnoFiltro(a.ano === anoFiltro ? null : a.ano)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
              anoFiltro === a.ano ? 'border-gold-500 text-gold-400 bg-gold-600/10' : 'border-dark-600 text-dark-300 hover:border-dark-400'
            }`}
          >
            {a.ano} · {formatarMoeda(a.total, { casas: 0 })} · {a.qtd} ped.
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-dark-400">
            <tr>
              <th className="text-left font-normal py-1.5">Data</th>
              <th className="text-left font-normal py-1.5">Nº Pedido</th>
              <th className="text-right font-normal py-1.5">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700/60">
            {visiveis.map((p) => (
              <tr key={p.id} className="text-dark-200">
                <td className="py-1.5">{dataBr(p.dataPedido)}</td>
                <td className="py-1.5 font-mono">{p.numeroPedido ?? '—'}</td>
                <td className="py-1.5 text-right font-mono">{formatarMoeda(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pedidos.length > 10 && (
        <button onClick={() => setVerTodos((v) => !v)} className="text-xs text-gold-400 hover:underline">
          {verTodos ? 'Mostrar menos' : `Ver todos os ${pedidos.length} pedidos`}
        </button>
      )}
    </div>
  )
}
