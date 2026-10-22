import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { formatarMoeda } from '../lib/moeda'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

// Histórico de vendas do cliente na ficha (pedido do João, 2026-10-22): os
// pedidos do SAP (abr–jul, antes do CRM) e as vendas lançadas no CRM numa
// lista só, com o PDF do pedido e os itens (da nota do SAP quando achada,
// senão os lidos do PDF). Aparece em todo cliente, mesmo sem nenhuma venda.
export default function HistoricoSapCliente({ clienteId }: { clienteId: number }) {
  const { data, isLoading } = trpc.historicoSap.vendasDoCliente.useQuery({ clienteId })
  const [anoFiltro, setAnoFiltro] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  if (isLoading) return <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 h-40 animate-pulse" />
  if (!data) return null

  const linhas = anoFiltro ? data.linhas.filter((l) => l.data.startsWith(anoFiltro)) : data.linhas
  const visiveis = verTodos ? linhas : linhas.slice(0, 10)

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dark-100">🧾 Histórico de vendas</h2>
        <span className="text-xs text-dark-500">SAP (até jul) + CRM (desde ago)</span>
      </div>

      {data.qtd === 0 ? (
        <p className="text-sm text-dark-500">Nenhuma venda registrada para este cliente ainda.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-dark-400">Total comprado</p>
              <p className="text-lg font-bold font-mono text-dark-50">{formatarMoeda(data.total, { casas: 0 })}</p>
            </div>
            <div>
              <p className="text-xs text-dark-400">Pedidos</p>
              <p className="text-lg font-bold font-mono text-dark-50">{data.qtd}</p>
              <p className="text-xs text-dark-500">
                {data.qtdSap} SAP · {data.qtdCrm} CRM
              </p>
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

          {data.porAno.length > 1 && (
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
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-dark-400">
                <tr>
                  <th className="w-5" />
                  <th className="text-left font-normal py-1.5">Data</th>
                  <th className="text-left font-normal py-1.5">Origem</th>
                  <th className="text-left font-normal py-1.5 hidden sm:table-cell">Pedido / NF</th>
                  <th className="text-left font-normal py-1.5 hidden md:table-cell">Vendedor</th>
                  <th className="text-right font-normal py-1.5 hidden sm:table-cell">Itens</th>
                  <th className="text-right font-normal py-1.5">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/60">
                {visiveis.map((l) => {
                  const podeAbrir = l.itens.length > 0 || !!l.pdfPedidoPath || !!l.condicaoPagamento
                  return (
                    <Fragment key={l.chave}>
                      <tr className={`text-dark-200 ${podeAbrir ? 'cursor-pointer hover:bg-dark-700/40' : ''}`} onClick={() => podeAbrir && setAberta((a) => (a === l.chave ? null : l.chave))}>
                        <td className="py-1.5 text-dark-500">{podeAbrir && (aberta === l.chave ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</td>
                        <td className="py-1.5">{dataBr(l.data)}</td>
                        <td className="py-1.5">
                          <span className={`px-2 py-0.5 rounded-md text-xs ${l.origem === 'sap' ? 'bg-sky-500/15 text-sky-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                            {l.origem === 'sap' ? 'SAP' : 'CRM'}
                          </span>
                          {l.pdfPedidoPath && <FileText size={13} className="inline ml-1.5 text-dark-400" aria-label="tem PDF" />}
                        </td>
                        <td className="py-1.5 font-mono text-xs hidden sm:table-cell">{[l.numeroPedido, l.numeroNota && `NF ${l.numeroNota}`].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="py-1.5 text-xs text-dark-400 hidden md:table-cell">{l.vendedorNome ?? '—'}</td>
                        <td className="py-1.5 text-right text-xs text-dark-400 hidden sm:table-cell">{l.itens.length || '—'}</td>
                        <td className="py-1.5 text-right font-mono">{formatarMoeda(l.valor)}</td>
                      </tr>
                      {aberta === l.chave && (
                        <tr>
                          <td />
                          <td colSpan={6} className="pb-3">
                            <div className="rounded-lg bg-dark-900/60 border border-dark-700 overflow-x-auto">
                              {(l.pdfPedidoPath || l.condicaoPagamento) && (
                                <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-dark-700 text-xs text-dark-300">
                                  {l.condicaoPagamento && <span>Pagamento: {l.condicaoPagamento}</span>}
                                  {l.pdfPedidoPath && (
                                    <a href={l.pdfPedidoPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold-400 hover:underline">
                                      <FileText size={13} /> Abrir PDF do pedido
                                    </a>
                                  )}
                                </div>
                              )}
                              {l.itens.length > 0 ? (
                                <table className="w-full text-xs">
                                  <thead className="text-dark-500">
                                    <tr>
                                      <th className="text-left font-normal px-3 py-1.5">Item</th>
                                      <th className="text-right font-normal px-3 py-1.5">Qtd</th>
                                      <th className="text-right font-normal px-3 py-1.5">Preço un.</th>
                                      <th className="text-right font-normal px-3 py-1.5">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-dark-700/60 text-dark-200">
                                    {l.itens.map((i, idx) => (
                                      <tr key={idx}>
                                        <td className="px-3 py-1.5">
                                          {i.descricao}
                                          {i.codigoItem && <span className="ml-1.5 text-dark-500 font-mono">{i.codigoItem}</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono">{i.quantidade?.toLocaleString('pt-BR') ?? '—'}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{i.valorUnitario != null ? formatarMoeda(i.valorUnitario) : '—'}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{i.valorTotal != null ? formatarMoeda(i.valorTotal) : '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="px-3 py-2 text-xs text-dark-500">Sem itens: a nota ainda não veio do SAP e o PDF não tinha itens legíveis.</p>
                              )}
                              {l.itens.length > 0 && (
                                <p className="px-3 py-1.5 text-[11px] text-dark-500 border-t border-dark-700">
                                  {l.itensDe === 'nota' ? `Itens da nota fiscal ${l.numeroNota} do SAP.` : 'Itens lidos do PDF do pedido.'}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {linhas.length > 10 && (
            <button onClick={() => setVerTodos((v) => !v)} className="text-xs text-gold-400 hover:underline">
              {verTodos ? 'Mostrar menos' : `Ver todos os ${linhas.length} pedidos`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
