import { useMemo, useState } from 'react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

// Histórico de compra aberto direto no card do Kanban (pedido do João,
// 2026-11-11, Compretec Loja Física): o vendedor clica no cliente e já vê o
// que ele comprou, sem precisar abrir o "histórico completo".
const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/')

export default function HistoricoComprasCard({ clienteId }: { clienteId: number }) {
  const { data, isLoading, error } = trpc.clientes.historico.useQuery({ id: clienteId })
  const [verTodas, setVerTodas] = useState(false)

  const compras = useMemo(
    () =>
      (data?.funis ?? [])
        .flatMap((f) => f.vendas.map((v) => ({ ...v, vendedorNome: f.vendedorNome })))
        .sort((a, b) => (a.dataFechamento < b.dataFechamento ? 1 : -1)),
    [data]
  )

  if (error) return null
  const total = compras.reduce((s, v) => s + v.valorFechado, 0)
  const visiveis = verTodas ? compras : compras.slice(0, 5)
  const itensTop = (data?.itensMaisComprados ?? []).slice(0, 5)

  return (
    <div className="bg-emerald-900/10 border border-emerald-700/40 rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-emerald-200">🛒 Histórico de compras</h3>
        {compras.length > 0 && (
          <span className="text-xs text-emerald-300/80">
            {compras.length} {compras.length === 1 ? 'compra' : 'compras'} · {formatarMoeda(total)} · última em {dataBr(compras[0].dataFechamento)}
          </span>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-dark-500">Carregando...</p>
      ) : compras.length === 0 ? (
        <p className="text-xs text-dark-400">Esse cliente ainda não tem compra registrada no CRM.</p>
      ) : (
        <>
          <div className="divide-y divide-dark-700/70">
            {visiveis.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="text-dark-300 min-w-0 truncate">
                  <span className="text-dark-100 font-medium">{dataBr(v.dataFechamento)}</span>
                  {v.numeroPedido ? ` · Pedido ${v.numeroPedido}` : ''}
                  {v.numeroNotaFiscal ? ` · NF ${v.numeroNotaFiscal}` : ''}
                  {v.numeroCupomFiscal ? ` · Cupom ${v.numeroCupomFiscal}` : ''}
                  {v.condicaoPagamento ? ` · ${v.condicaoPagamento}` : ''}
                </span>
                <span className="text-dark-100 font-semibold shrink-0">{formatarMoeda(v.valorFechado)}</span>
              </div>
            ))}
          </div>
          {compras.length > 5 && (
            <button type="button" onClick={() => setVerTodas((x) => !x)} className="text-xs text-gold-400 hover:underline">
              {verTodas ? 'Mostrar só as últimas 5' : `Ver todas as ${compras.length} compras`}
            </button>
          )}
        </>
      )}
      {itensTop.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] uppercase tracking-wide text-dark-500 mb-1">O que mais compra</p>
          <div className="flex flex-wrap gap-1.5">
            {itensTop.map((i) => (
              <span key={i.descricao} className="text-[11px] bg-dark-800 border border-dark-600 rounded-full px-2 py-0.5 text-dark-200" title={formatarMoeda(i.valorTotal)}>
                {i.descricao}
                {i.quantidadeTotal > 0 ? ` · ${i.quantidadeTotal} un.` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
