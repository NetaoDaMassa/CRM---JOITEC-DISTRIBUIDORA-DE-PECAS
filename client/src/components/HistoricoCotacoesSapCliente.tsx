import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
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
// não tiver nenhuma cotação em lote ligado. Desde 2026-10-22, clicar na
// cotação abre os itens que foram orçados nela. Também mostra os
// orçamentos feitos no CRM (cards com valor orçado ou PDF de proposta) e
// aparece em todo cliente, mesmo sem nada.
export default function HistoricoCotacoesSapCliente({ clienteId }: { clienteId: number }) {
  const { data, isLoading } = trpc.historicoSap.cotacoesDoCliente.useQuery({ clienteId })
  const [filtro, setFiltro] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  const [verTodosCrm, setVerTodosCrm] = useState(false)

  if (isLoading) return <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 h-40 animate-pulse" />
  if (!data) return null
  const orcamentosCrm = verTodosCrm ? data.orcamentosCrm : data.orcamentosCrm.slice(0, 10)

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
        <h2 className="text-sm font-semibold text-dark-100">📝 Histórico de cotações e orçamentos</h2>
        <span className="text-xs text-dark-500">SAP + CRM · só consulta</span>
      </div>

      {data.total.qtd === 0 && data.orcamentosCrm.length === 0 && <p className="text-sm text-dark-500">Nenhuma cotação ou orçamento registrado para este cliente ainda.</p>}

      {data.orcamentosCrm.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-dark-300">Orçamentos no CRM · {data.orcamentosCrm.length}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-dark-400">
                <tr>
                  <th className="text-left font-normal py-1.5">Data</th>
                  <th className="text-left font-normal py-1.5">Situação</th>
                  <th className="text-left font-normal py-1.5 hidden md:table-cell">Vendedor</th>
                  <th className="text-left font-normal py-1.5">Proposta</th>
                  <th className="text-right font-normal py-1.5">Valor orçado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/60">
                {orcamentosCrm.map((o) => (
                  <tr key={o.id} className="text-dark-200">
                    <td className="py-1.5">{dataBr(o.data)}</td>
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-xs ${STATUS[o.status]?.classe ?? STATUS.outro.classe}`} title={o.motivoPerda ?? undefined}>
                        {o.status === 'cancelado' ? 'Perdido' : o.status === 'outro' ? 'Saiu da negociação' : STATUS[o.status]?.rotulo}
                      </span>
                    </td>
                    <td className="py-1.5 text-xs text-dark-400 hidden md:table-cell">{o.vendedorNome}</td>
                    <td className="py-1.5">
                      {o.pdfPropostaPath ? (
                        <a href={o.pdfPropostaPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gold-400 hover:underline">
                          <FileText size={13} /> PDF
                        </a>
                      ) : (
                        <span className="text-xs text-dark-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono">{o.valor != null ? formatarMoeda(o.valor) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.orcamentosCrm.length > 10 && (
            <button onClick={() => setVerTodosCrm((v) => !v)} className="text-xs text-gold-400 hover:underline">
              {verTodosCrm ? 'Mostrar menos' : `Ver todos os ${data.orcamentosCrm.length} orçamentos`}
            </button>
          )}
        </div>
      )}

      {data.total.qtd > 0 && (
        <>
          {data.orcamentosCrm.length > 0 && <p className="text-xs font-semibold text-dark-300 pt-2 border-t border-dark-700">Cotações do SAP · {data.total.qtd}</p>}

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
                  <th className="w-5" />
                  <th className="text-left font-normal py-1.5">Data</th>
                  <th className="text-left font-normal py-1.5">Nº Cotação</th>
                  <th className="text-left font-normal py-1.5">Situação</th>
                  <th className="text-right font-normal py-1.5 hidden sm:table-cell">Itens</th>
                  <th className="text-right font-normal py-1.5">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/60">
                {visiveis.map((c) => (
                  <Fragment key={c.chave}>
                    <tr className={`text-dark-200 ${c.itens.length ? 'cursor-pointer hover:bg-dark-700/40' : ''}`} onClick={() => c.itens.length && setAberta((a) => (a === c.chave ? null : c.chave))}>
                      <td className="py-1.5 text-dark-500">{c.itens.length > 0 && (aberta === c.chave ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</td>
                      <td className="py-1.5">{dataBr(c.dataCotacao)}</td>
                      <td className="py-1.5 font-mono">{c.numeroCotacao}</td>
                      <td className="py-1.5">
                        <span className={`px-2 py-0.5 rounded-md text-xs ${STATUS[c.status]?.classe ?? STATUS.outro.classe}`}>{STATUS[c.status]?.rotulo ?? c.status}</span>
                      </td>
                      <td className="py-1.5 text-right text-xs text-dark-400 hidden sm:table-cell">{c.itens.length || '—'}</td>
                      <td className="py-1.5 text-right font-mono">{formatarMoeda(c.valor)}</td>
                    </tr>
                    {aberta === c.chave && (
                      <tr>
                        <td />
                        <td colSpan={5} className="pb-3">
                          <div className="rounded-lg bg-dark-900/60 border border-dark-700 overflow-x-auto">
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
                                {c.itens.map((i, idx) => (
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
                            <p className="px-3 py-1.5 text-[11px] text-dark-500 border-t border-dark-700">O valor da cotação no SAP inclui impostos, por isso pode ser maior que a soma dos itens.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {lista.length > 10 && (
            <button onClick={() => setVerTodos((v) => !v)} className="text-xs text-gold-400 hover:underline">
              {verTodos ? 'Mostrar menos' : `Ver todas as ${lista.length} cotações`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
