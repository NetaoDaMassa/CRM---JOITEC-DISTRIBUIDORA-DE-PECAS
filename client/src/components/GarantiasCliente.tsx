import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

// Pedidos de GARANTIA do cliente no SAP (pedido do João, 2026-11-03): não
// viram venda (não contam em meta/faturamento), mas o vendedor vê aqui — no
// card aberto do Kanban e na ficha. Some se o cliente não tiver nenhuma.
export default function GarantiasCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.historicoSap.garantiasDoCliente.useQuery({ clienteId })
  if (!data?.length) return null
  const dataBr = (iso: string) => iso.split('-').reverse().join('/')
  return (
    <div className="rounded-xl border border-indigo-700/40 bg-indigo-900/15 px-4 py-3 space-y-1.5">
      <p className="text-sm font-semibold text-indigo-200">🛡 Garantias deste cliente ({data.length}) — não contam como venda nem na meta</p>
      {data.slice(0, 8).map((g) => (
        <p key={g.id} className="text-xs text-indigo-100/90">
          {dataBr(g.dataPedido)} · pedido <b>{g.numeroPedido}</b>
          {g.nfNumero ? ` · NF ${g.nfNumero}` : ''}
          {g.valor ? ` · ${formatarMoeda(g.valor)}` : ''}
          {g.observacao ? <span className="text-indigo-200/70"> · {g.observacao.slice(0, 90)}</span> : null}
        </p>
      ))}
      {data.length > 8 && <p className="text-xs text-indigo-200/70">+ {data.length - 8} garantia(s)</p>}
    </div>
  )
}
