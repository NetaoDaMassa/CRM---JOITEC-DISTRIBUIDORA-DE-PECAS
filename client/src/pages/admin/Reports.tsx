import { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { hojeBrString, primeiroDiaMesString } from '../../lib/utils'
import { paraCsv, baixarCsv } from '../../lib/csv'

function BotaoExportar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-gold-400 hover:underline shrink-0">
      Exportar CSV
    </button>
  )
}

function formatarMoeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'R$ 0,00'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const CATEGORIA_LABEL: Record<string, string> = {
  estoque: 'Estoque',
  financeiro: 'Financeiro',
  compras: 'Compras',
}

export default function AdminReports() {
  const { user } = useAuth()
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesString())
  const [dataFim, setDataFim] = useState(hojeBrString())
  const [vendedorId, setVendedorId] = useState('')

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })

  const periodo = { dataInicio, dataFim, vendedorId: vendedorId ? Number(vendedorId) : undefined }

  const { data: curvaAbc } = trpc.reports.curvaAbc.useQuery(periodo)
  const { data: positivacao } = trpc.reports.positivacaoCarteira.useQuery(periodo)
  const { data: contatos } = trpc.reports.contatosPorCliente.useQuery(periodo)
  const { data: vendas } = trpc.reports.vendas.useQuery(periodo)
  const { data: diasSemContato } = trpc.reports.diasSemContato.useQuery({ vendedorId: periodo.vendedorId })
  const { data: orcamentosAbertos } = trpc.reports.orcamentosAbertos.useQuery({ vendedorId: periodo.vendedorId })
  const { data: itensMaisComprados } = trpc.reports.itensMaisComprados.useQuery(periodo)
  const { data: motivosPerdas } = trpc.reports.motivosPerdas.useQuery(periodo)

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Relatórios</h1>
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          {user?.role === 'admin' && (
            <Select
              label="Vendedor"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos"
              options={(vendors ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-500">Vendas no período</p>
          <p className="text-lg font-semibold text-dark-50">{vendas?.quantidade ?? 0}</p>
          <p className="text-xs text-dark-400">{formatarMoeda(vendas?.valorTotal)}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-500">Ticket médio</p>
          <p className="text-lg font-semibold text-dark-50">{formatarMoeda(vendas?.ticketMedio)}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-xs text-dark-500">Positivação de carteira</p>
          <p className="text-lg font-semibold text-dark-50">{(positivacao?.percentual ?? 0).toFixed(1)}%</p>
          <p className="text-xs text-dark-400">
            {positivacao?.ativados ?? 0} de {positivacao?.totalCarteira ?? 0} clientes compraram
          </p>
        </div>
      </div>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">Curva ABC de clientes</h2>
          <BotaoExportar
            onClick={() =>
              baixarCsv(
                'curva-abc.csv',
                paraCsv(
                  [
                    { chave: 'razaoSocial', rotulo: 'Cliente' },
                    { chave: 'valorTotal', rotulo: 'Valor total' },
                    { chave: 'classe', rotulo: 'Classe' },
                  ],
                  curvaAbc ?? []
                )
              )
            }
          />
        </div>
        <div className="divide-y divide-dark-700">
          {curvaAbc?.map((c) => (
            <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
              <span className="text-dark-200">{c.razaoSocial}</span>
              <span className="text-dark-400">
                {formatarMoeda(c.valorTotal)} ·{' '}
                <span
                  className={
                    c.classe === 'A' ? 'text-green-400' : c.classe === 'B' ? 'text-yellow-400' : 'text-dark-400'
                  }
                >
                  Classe {c.classe}
                </span>
              </span>
            </div>
          ))}
          {!curvaAbc?.length && <p className="text-sm text-dark-500 py-2">Nenhuma venda fechada no período.</p>}
        </div>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">Contatos e ligações por cliente</h2>
          <BotaoExportar
            onClick={() =>
              baixarCsv(
                'contatos-por-cliente.csv',
                paraCsv(
                  [
                    { chave: 'razaoSocial', rotulo: 'Cliente' },
                    { chave: 'totalContatos', rotulo: 'Total de contatos' },
                    { chave: 'totalLigacoes', rotulo: 'Total de ligações' },
                  ],
                  contatos ?? []
                )
              )
            }
          />
        </div>
        <div className="divide-y divide-dark-700">
          {contatos?.map((c) => (
            <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
              <span className="text-dark-200">{c.razaoSocial}</span>
              <span className="text-dark-400">
                {c.totalContatos} contato(s) · {c.totalLigacoes} ligação(ões)
              </span>
            </div>
          ))}
          {!contatos?.length && <p className="text-sm text-dark-500 py-2">Nenhum contato registrado no período.</p>}
        </div>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">Orçamentos em aberto (negociação, mês corrente)</h2>
          <BotaoExportar
            onClick={() =>
              baixarCsv(
                'orcamentos-em-aberto.csv',
                paraCsv(
                  [
                    { chave: 'razaoSocial', rotulo: 'Cliente' },
                    { chave: 'vendedorNome', rotulo: 'Vendedor' },
                    { chave: 'valorOrcado', rotulo: 'Valor orçado' },
                  ],
                  orcamentosAbertos?.linhas ?? []
                )
              )
            }
          />
        </div>
        <p className="text-xs text-dark-500 mb-2">
          {orcamentosAbertos?.quantidade ?? 0} proposta(s) em aberto · {formatarMoeda(orcamentosAbertos?.valorTotal)} no total
        </p>
        <div className="divide-y divide-dark-700">
          {orcamentosAbertos?.linhas.map((l) => (
            <div key={l.clienteId} className="flex items-center justify-between py-2 text-sm">
              <span className="text-dark-200">{l.razaoSocial}</span>
              <span className="text-dark-400">
                {l.valorOrcado != null ? formatarMoeda(l.valorOrcado) : '—'} · {l.vendedorNome}
              </span>
            </div>
          ))}
          {!orcamentosAbertos?.linhas.length && <p className="text-sm text-dark-500 py-2">Nenhum orçamento em aberto.</p>}
        </div>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">Clientes há mais tempo sem contato</h2>
          <BotaoExportar
            onClick={() =>
              baixarCsv(
                'dias-sem-contato.csv',
                paraCsv(
                  [
                    { chave: 'razaoSocial', rotulo: 'Cliente' },
                    { chave: 'dias', rotulo: 'Dias sem contato' },
                  ],
                  diasSemContato ?? []
                )
              )
            }
          />
        </div>
        <div className="divide-y divide-dark-700">
          {diasSemContato?.slice(0, 20).map((c) => (
            <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
              <span className="text-dark-200">{c.razaoSocial}</span>
              <span className="text-dark-400">{c.dias} dia(s)</span>
            </div>
          ))}
          {!diasSemContato?.length && <p className="text-sm text-dark-500 py-2">Sem dados.</p>}
        </div>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-100">Itens mais comprados</h2>
          <BotaoExportar
            onClick={() =>
              baixarCsv(
                'itens-mais-comprados.csv',
                paraCsv(
                  [
                    { chave: 'descricao', rotulo: 'Item' },
                    { chave: 'quantidadeTotal', rotulo: 'Quantidade' },
                    { chave: 'valorTotal', rotulo: 'Valor total' },
                  ],
                  itensMaisComprados ?? []
                )
              )
            }
          />
        </div>
        <div className="divide-y divide-dark-700">
          {itensMaisComprados?.map((i) => (
            <div key={i.descricao} className="flex items-center justify-between py-2 text-sm">
              <span className="text-dark-200">{i.descricao}</span>
              <span className="text-dark-400">
                {i.quantidadeTotal} un. · {formatarMoeda(i.valorTotal)}
              </span>
            </div>
          ))}
          {!itensMaisComprados?.length && (
            <p className="text-sm text-dark-500 py-2">Nenhum item registrado no período (depende da extração de PDF do bloco 11).</p>
          )}
        </div>
      </section>

      <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-dark-100 mb-3">Motivo de pedido perdido</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-dark-500">Por categoria</p>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'motivos-perda-categoria.csv',
                    paraCsv(
                      [
                        { chave: 'categoria', rotulo: 'Categoria' },
                        { chave: 'quantidade', rotulo: 'Quantidade' },
                      ],
                      (motivosPerdas?.porCategoria ?? []).map((m) => ({
                        categoria: m.categoria ? CATEGORIA_LABEL[m.categoria] : '—',
                        quantidade: m.quantidade,
                      }))
                    )
                  )
                }
              />
            </div>
            {motivosPerdas?.porCategoria.map((m) => (
              <div key={m.categoria ?? 'sem categoria'} className="flex items-center justify-between text-sm py-1">
                <span className="text-dark-200">{m.categoria ? CATEGORIA_LABEL[m.categoria] : '—'}</span>
                <span className="text-dark-400">{m.quantidade}</span>
              </div>
            ))}
            {!motivosPerdas?.porCategoria.length && <p className="text-sm text-dark-500">Nenhuma perda no período.</p>}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-dark-500">Por peça/item</p>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'motivos-perda-item.csv',
                    paraCsv(
                      [
                        { chave: 'item', rotulo: 'Item' },
                        { chave: 'quantidade', rotulo: 'Quantidade' },
                      ],
                      motivosPerdas?.porItem ?? []
                    )
                  )
                }
              />
            </div>
            {motivosPerdas?.porItem.map((m) => (
              <div key={m.item} className="flex items-center justify-between text-sm py-1">
                <span className="text-dark-200">{m.item}</span>
                <span className="text-dark-400">{m.quantidade}</span>
              </div>
            ))}
            {!motivosPerdas?.porItem.length && <p className="text-sm text-dark-500">Nenhuma perda com peça informada.</p>}
          </div>
        </div>
      </section>
    </div>
  )
}
