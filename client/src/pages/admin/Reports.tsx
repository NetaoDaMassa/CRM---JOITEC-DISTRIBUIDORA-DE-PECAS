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

const ETAPA_LABEL_REPORT: Record<string, string> = {
  novo: 'Novo',
  abordagem: 'Abordagem',
  interessado: 'Interessado',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  perdido: 'Perdido',
  sem_contato: 'Sem contato',
  consumidor_final: 'Consumidor Final',
}

function pluralizarSimples(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

const ABAS = [
  { value: 'visao_geral', label: 'Visão geral' },
  { value: 'contatos', label: 'Contatos & Ligações' },
  { value: 'orcamentos', label: 'Orçamentos & Vendas' },
  { value: 'alertas', label: 'Alertas' },
] as const
type Aba = (typeof ABAS)[number]['value']

export default function AdminReports() {
  const { user } = useAuth()
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesString())
  const [dataFim, setDataFim] = useState(hojeBrString())
  const [vendedorId, setVendedorId] = useState('')
  const [granularidadeOrcamentos, setGranularidadeOrcamentos] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [aba, setAba] = useState<Aba>('visao_geral')

  const { data: vendors } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })

  const periodo = { dataInicio, dataFim, vendedorId: vendedorId ? Number(vendedorId) : undefined }

  const { data: curvaAbc } = trpc.reports.curvaAbc.useQuery(periodo)
  const { data: positivacao } = trpc.reports.positivacaoCarteira.useQuery(periodo)
  const { data: positivacaoPorVendedor } = trpc.reports.positivacaoPorVendedor.useQuery(periodo)
  const { data: contatos } = trpc.reports.contatosPorCliente.useQuery(periodo)
  const { data: contatosCoberturaPorVendedor } = trpc.reports.contatosCoberturaPorVendedor.useQuery(periodo)
  const { data: ligacoesEfetividade } = trpc.reports.ligacoesEfetividade.useQuery(periodo)
  const { data: ligacoesPorCliente } = trpc.reports.ligacoesPorCliente.useQuery(periodo)
  const { data: mixProdutosPorVendedor } = trpc.reports.mixProdutosPorVendedor.useQuery(periodo)
  const { data: vendas } = trpc.reports.vendas.useQuery(periodo)
  const { data: diasSemContato } = trpc.reports.diasSemContato.useQuery({ vendedorId: periodo.vendedorId })
  const { data: orcamentosAbertos } = trpc.reports.orcamentosAbertos.useQuery({ vendedorId: periodo.vendedorId })
  const { data: clientesSemOrcamentoEContato } = trpc.reports.clientesSemOrcamentoEContato.useQuery({ vendedorId: periodo.vendedorId })
  const { data: orcamentosPorVendedor } = trpc.reports.orcamentosPorVendedor.useQuery({ ...periodo, granularidade: granularidadeOrcamentos })
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

      <div className="flex gap-1 border-b border-dark-700 overflow-x-auto">
        {ABAS.map((t) => (
          <button
            key={t.value}
            onClick={() => setAba(t.value)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              aba === t.value ? 'border-gold-500 text-gold-400' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'visao_geral' && (
        <div className="space-y-6">
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
                    <span className={c.classe === 'A' ? 'text-green-400' : c.classe === 'B' ? 'text-yellow-400' : 'text-dark-400'}>
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
              <h2 className="text-sm font-semibold text-dark-100">Positivação de carteira por vendedor</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'positivacao-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'totalCarteira', rotulo: 'Total na carteira' },
                        { chave: 'ativados', rotulo: 'Compraram no período' },
                        { chave: 'percentual', rotulo: '% positivação' },
                      ],
                      positivacaoPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">De quantos clientes da carteira cada vendedor conseguiu vender no período.</p>
            <div className="divide-y divide-dark-700">
              {positivacaoPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.ativados} de {v.totalCarteira} clientes · {v.percentual.toFixed(1)}%
                  </span>
                </div>
              ))}
              {!positivacaoPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum vendedor com carteira nesse filtro.</p>}
            </div>
          </section>
        </div>
      )}

      {aba === 'contatos' && (
        <div className="space-y-6">
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
              <h2 className="text-sm font-semibold text-dark-100">Cobertura de contatos por vendedor (WhatsApp + telefone)</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'cobertura-contatos-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'totalCarteira', rotulo: 'Total na carteira' },
                        { chave: 'contatados', rotulo: 'Contatados no período' },
                        { chave: 'semContato', rotulo: 'Sem contato' },
                        { chave: 'percentual', rotulo: '% cobertura' },
                      ],
                      contatosCoberturaPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              De quantos clientes da carteira cada vendedor conseguiu falar (ligação ou WhatsApp) no período — não conta e-mail nem visita.
            </p>
            <div className="divide-y divide-dark-700">
              {contatosCoberturaPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.contatados} de {v.totalCarteira} clientes · {v.percentual.toFixed(1)}%
                    {v.semContato > 0 && <span className="text-amber-400"> · {v.semContato} sem contato</span>}
                  </span>
                </div>
              ))}
              {!contatosCoberturaPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum vendedor com carteira nesse filtro.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Ligações: tentativa x efetiva (por vendedor)</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'ligacoes-tentativa-x-efetiva.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'tentativas', rotulo: 'Tentativas' },
                        { chave: 'efetivas', rotulo: 'Efetivas' },
                        { chave: 'percentualEfetividade', rotulo: '% efetividade' },
                      ],
                      ligacoesEfetividade ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Efetiva = durou pelo menos {15}s (ligação automática via GoTo) ou foi marcada como "respondeu" (registro manual).
            </p>
            <div className="divide-y divide-dark-700">
              {ligacoesEfetividade?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.efetivas} efetiva(s) de {v.tentativas} tentativa(s) · {v.percentualEfetividade.toFixed(1)}%
                  </span>
                </div>
              ))}
              {!ligacoesEfetividade?.length && <p className="text-sm text-dark-500 py-2">Nenhuma ligação registrada no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Ligações por cliente</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'ligacoes-por-cliente.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'tentativas', rotulo: 'Tentativas' },
                        { chave: 'efetivas', rotulo: 'Efetivas' },
                        { chave: 'pendentes', rotulo: 'Pendentes de confirmação' },
                        { chave: 'percentualEfetividade', rotulo: '% efetividade' },
                        { chave: 'duracaoMediaSegundos', rotulo: 'Duração média (s)' },
                      ],
                      ligacoesPorCliente ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Pendente = ligação sem o vendedor confirmar se atendeu, não atendeu ou caiu na caixa postal — não conta como efetiva até ser
              confirmada.
            </p>
            <div className="divide-y divide-dark-700">
              {ligacoesPorCliente?.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="text-dark-200 truncate">{c.razaoSocial}</span>
                  <span className="text-dark-400 text-right shrink-0">
                    {c.efetivas} efetiva(s) de {c.tentativas} tentativa(s) · {c.percentualEfetividade.toFixed(1)}%
                    {c.pendentes > 0 && <span className="text-amber-400"> · {c.pendentes} pendente(s)</span>}
                    {c.duracaoMediaSegundos > 0 && ` · ${Math.round(c.duracaoMediaSegundos)}s méd.`}
                  </span>
                </div>
              ))}
              {!ligacoesPorCliente?.length && <p className="text-sm text-dark-500 py-2">Nenhuma ligação registrada no período.</p>}
            </div>
          </section>
        </div>
      )}

      {aba === 'orcamentos' && (
        <div className="space-y-6">
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
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-dark-100">Orçamentos feitos por vendedor</h2>
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Select
                    value={granularidadeOrcamentos}
                    onChange={(e) => setGranularidadeOrcamentos(e.target.value as 'dia' | 'semana' | 'mes')}
                    options={[
                      { value: 'dia', label: 'Por dia' },
                      { value: 'semana', label: 'Por semana' },
                      { value: 'mes', label: 'Por mês' },
                    ]}
                  />
                </div>
                <BotaoExportar
                  onClick={() =>
                    baixarCsv(
                      'orcamentos-por-vendedor.csv',
                      paraCsv(
                        [
                          { chave: 'nome', rotulo: 'Vendedor' },
                          { chave: 'periodo', rotulo: 'Período' },
                          { chave: 'quantidade', rotulo: 'Orçamentos feitos' },
                        ],
                        orcamentosPorVendedor ?? []
                      )
                    )
                  }
                />
              </div>
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Quantas vezes cada vendedor moveu um card pra "Negociação" (1º orçamento feito) — conta pela data de verdade da mudança de
              etapa, não pela última edição do card.
            </p>
            <div className="divide-y divide-dark-700">
              {orcamentosPorVendedor?.map((l) => (
                <div key={`${l.vendedorId}-${l.periodo}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">
                    {l.nome} <span className="text-dark-500">· {l.periodo}</span>
                  </span>
                  <span className="text-dark-400">{pluralizarSimples(l.quantidade, 'orçamento', 'orçamentos')}</span>
                </div>
              ))}
              {!orcamentosPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhum orçamento feito no período.</p>}
            </div>
          </section>

          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Mix de produtos por vendedor</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'mix-produtos-por-vendedor.csv',
                    paraCsv(
                      [
                        { chave: 'nome', rotulo: 'Vendedor' },
                        { chave: 'clientesComVenda', rotulo: 'Clientes que compraram' },
                        { chave: 'mediaItensPorCliente', rotulo: 'Média de itens diferentes por cliente' },
                        { chave: 'mediaQuantidadePorCliente', rotulo: 'Média de unidades por cliente' },
                      ],
                      mixProdutosPorVendedor ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Entre os clientes que compraram no período, quantos itens diferentes (e quantas unidades) cada vendedor costuma vender por
              cliente — mede o tamanho da cesta, não só se vendeu.
            </p>
            <div className="divide-y divide-dark-700">
              {mixProdutosPorVendedor?.map((v) => (
                <div key={v.vendedorId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{v.nome}</span>
                  <span className="text-dark-400">
                    {v.mediaItensPorCliente.toFixed(1)} itens/cliente · {v.mediaQuantidadePorCliente.toFixed(1)} un./cliente · {v.clientesComVenda}{' '}
                    cliente(s)
                  </span>
                </div>
              ))}
              {!mixProdutosPorVendedor?.length && <p className="text-sm text-dark-500 py-2">Nenhuma venda com itens no período.</p>}
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
        </div>
      )}

      {aba === 'alertas' && (
        <div className="space-y-6">
          <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dark-100">Clientes sem orçamento e sem contato no mês</h2>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    'clientes-sem-orcamento-e-contato.csv',
                    paraCsv(
                      [
                        { chave: 'razaoSocial', rotulo: 'Cliente' },
                        { chave: 'vendedorNome', rotulo: 'Vendedor' },
                        { chave: 'etapa', rotulo: 'Etapa' },
                      ],
                      clientesSemOrcamentoEContato ?? []
                    )
                  )
                }
              />
            </div>
            <p className="text-xs text-dark-500 mb-2">
              Clientes completamente intocados neste mês — zero contato registrado e nenhum orçamento lançado. Foto do mês corrente, não
              filtra por período.
            </p>
            <div className="divide-y divide-dark-700">
              {clientesSemOrcamentoEContato?.map((c) => (
                <div key={c.clienteId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-dark-200">{c.razaoSocial}</span>
                  <span className="text-dark-400">
                    {ETAPA_LABEL_REPORT[c.etapa] ?? c.etapa} · {c.vendedorNome}
                  </span>
                </div>
              ))}
              {!clientesSemOrcamentoEContato?.length && (
                <p className="text-sm text-dark-500 py-2">Nenhum cliente esquecido — todo mundo tem contato ou orçamento neste mês.</p>
              )}
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
      )}
    </div>
  )
}
