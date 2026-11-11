import { useMemo, useState } from 'react'
import { BadgeDollarSign, Globe, Receipt, ShoppingBag } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { formatarMoeda } from '../../../lib/moeda'
import { Abas, KpiCard, Ranking, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'

// Vendas de Lead Site (pedido do João, 2026-11-11, Compretec Loja Física):
// total vendido pra quem veio do site e quanto cada vendedor vendeu. Entra a
// venda do cliente marcado "Cliente de Marketing → Lead Site" e a venda de
// balcão marcada assim na hora de registrar.
export function LeadSite({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data: lista, isLoading } = trpc.reports.vendasLeadSite.useQuery(f.periodo)
  const { data: listaAnt } = trpc.reports.vendasLeadSite.useQuery(f.anterior)
  const [tabela, setTabela] = useState<'vendedor' | 'lista'>(simples ? 'lista' : 'vendedor')

  const resumo = useMemo(() => {
    const soma = (l: typeof lista) => (l ?? []).reduce((s, v) => s + v.valor, 0)
    const total = soma(lista)
    const qtd = lista?.length ?? 0
    const vend = new Map<number, { nome: string; qtd: number; valor: number }>()
    for (const v of lista ?? []) {
      const x = vend.get(v.vendedorId) ?? { nome: v.vendedor, qtd: 0, valor: 0 }
      x.qtd += 1
      x.valor += v.valor
      vend.set(v.vendedorId, x)
    }
    return {
      total,
      qtd,
      ticket: qtd ? total / qtd : 0,
      totalAnt: soma(listaAnt),
      qtdAnt: listaAnt?.length ?? 0,
      ticketAnt: listaAnt?.length ? soma(listaAnt) / listaAnt.length : 0,
      porVendedor: [...vend.values()].map((v) => ({ ...v, ticket: v.qtd ? v.valor / v.qtd : 0, share: total ? (v.valor / total) * 100 : 0 })),
    }
  }, [lista, listaAnt])

  type V = (typeof resumo.porVendedor)[number]
  type L = NonNullable<typeof lista>[number]
  const colVend: Coluna<V>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (v) => v.nome, render: (v) => <span className="font-medium text-dark-50">{v.nome}</span> },
    { id: 'qtd', rotulo: 'Vendas', valor: (v) => v.qtd, formato: 'numero', somar: true },
    { id: 'valor', rotulo: 'Total vendido', valor: (v) => v.valor, formato: 'moeda', somar: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (v) => v.ticket, formato: 'moeda' },
    { id: 'share', rotulo: '% do total', valor: (v) => Math.round(v.share * 10) / 10, formato: 'pct', render: (v) => pct(v.share) },
  ]
  const colLista: Coluna<L>[] = [
    { id: 'data', rotulo: 'Data', valor: (l) => l.data, formato: 'data' },
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.cliente, render: (l) => <span className="font-medium text-dark-50">{l.cliente}</span> },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (l: L) => l.vendedor }]),
    { id: 'valor', rotulo: 'Valor', valor: (l) => l.valor, formato: 'moeda', somar: true, render: (l) => formatarMoeda(l.valor) },
    { id: 'condicao', rotulo: 'Pagamento', valor: (l) => l.condicaoPagamento },
    { id: 'numero', rotulo: 'Nº pedido / nota', valor: (l) => l.numero },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard titulo="Total vendido (Lead Site)" icone={BadgeDollarSign} valor={moeda(resumo.total)} atual={resumo.total} anterior={listaAnt ? resumo.totalAnt : undefined} />
            <KpiCard titulo="Vendas" icone={ShoppingBag} cor="#8b5cf6" valor={numero(resumo.qtd)} atual={resumo.qtd} anterior={listaAnt ? resumo.qtdAnt : undefined} />
            <KpiCard titulo="Ticket médio" icone={Receipt} cor="#0ea5a4" valor={moeda(resumo.ticket)} atual={resumo.ticket} anterior={listaAnt ? resumo.ticketAnt : undefined} />
          </div>
          {!simples && (
            <Secao titulo="Quanto cada vendedor vendeu" subtitulo="Vendas de clientes que vieram do site">
              <Ranking
                itens={[...resumo.porVendedor].sort((a, b) => b.valor - a.valor).map((v) => ({ rotulo: v.nome, valor: v.valor, extra: `${numero(v.qtd)} venda(s)` }))}
                formatar={moeda}
                cor="#24aff4"
                vazio="Nenhuma venda de Lead Site no período."
              />
            </Secao>
          )}
        </>
      )}
      <Abas<'vendedor' | 'lista'>
        valor={tabela}
        onChange={setTabela}
        opcoes={[
          ...(simples ? [] : [{ valor: 'vendedor' as const, rotulo: 'Por vendedor', contagem: resumo.porVendedor.length }]),
          { valor: 'lista', rotulo: 'Venda a venda', contagem: lista?.length },
        ]}
      />
      {tabela === 'vendedor' && !simples ? (
        <TabelaDados id="lead-site-vendedor" linhas={resumo.porVendedor} colunas={colVend} chave={(v) => v.nome} buscaEm={(v) => v.nome} placeholderBusca="Buscar vendedor..." nomeArquivo="vendas-lead-site-por-vendedor.csv" ordemInicial={{ coluna: 'valor', direcao: 'desc' }} carregando={isLoading} vazio="Nenhuma venda de Lead Site no período." />
      ) : (
        <TabelaDados
          key="lead-site-lista"
          id="lead-site-lista"
          linhas={lista}
          colunas={colLista}
          chave={(l) => l.chave}
          buscaEm={(l) => `${l.cliente} ${l.vendedor} ${l.numero ?? ''}`}
          placeholderBusca="Buscar cliente, vendedor ou nº..."
          nomeArquivo="vendas-lead-site.csv"
          link={(l) => `${clientesBase}/${l.clienteId}`}
          ordemInicial={{ coluna: 'data', direcao: 'desc' }}
          simples={simples}
          carregando={isLoading}
          vazio="Nenhuma venda de Lead Site no período. A venda entra aqui quando o cliente (ou a venda de balcão) está marcado como Cliente de Marketing → Lead Site."
        />
      )}
      <p className="text-xs text-dark-500 flex items-center gap-1.5">
        <Globe size={12} /> Entra a venda do cliente marcado como "Cliente de Marketing → Lead Site" e a venda de balcão marcada assim na hora de registrar.
      </p>
    </div>
  )
}
