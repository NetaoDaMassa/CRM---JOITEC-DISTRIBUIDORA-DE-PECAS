import { useMemo, useState } from 'react'
import { Coins, PackageSearch, Percent } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { parseValorBr } from '../../../lib/valorBr'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, KpiCard, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'
import { AvisoDados, Rodape } from './ItensSapEstoque'

// Aba "Faturam pouco" do relatório Itens do SAP (João, 2026-11-18): itens
// que faturam menos que R$ X por mês, com quantas unidades venderam, o preço
// médio de venda e quanto faturaram em cada mês. Serve pra comparar com o
// que o vendedor diz ("não bati a meta porque faltou tal item" — e o item
// fatura R$ 500 no mês). Dados direto das notas do SAP da filial, de todos
// os clientes, já descontadas as devoluções (server/src/lib/sapEstoque.ts).

type Props = Pick<PropsDetalhe, 'simples' | 'mostrarResumo'>
type Regra = 'media' | 'todos'
type Mostrar = 'abaixo' | 'todos'

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const qtd = (v: number) => numero(Math.round(v * 100) / 100)
const classeCampo = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500'

function somarMeses(mes: string, n: number) {
  let [a, m] = mes.split('-').map(Number)
  m += n
  while (m < 1) {
    m += 12
    a -= 1
  }
  while (m > 12) {
    m -= 12
    a += 1
  }
  return `${a}-${String(m).padStart(2, '0')}`
}

export function FaturamPouco({ simples, mostrarResumo }: Props) {
  const mesAtual = hojeBrString().slice(0, 7)
  const [limiteTexto, setLimiteTexto] = usePersistedState<string>('rel:itensSap:pouco:limite', '1000')
  const [periodo, setPeriodo] = usePersistedState<'3' | '6' | '12'>('rel:itensSap:pouco:meses', '3')
  const [regra, setRegra] = usePersistedState<Regra>('rel:itensSap:pouco:regra', 'media')
  // Mês atual está pela metade: por padrão fica de fora pra não puxar a
  // média pra baixo.
  const [comMesAtual, setComMesAtual] = usePersistedState<boolean>('rel:itensSap:pouco:mesAtual', false)
  const [mostrar, setMostrar] = useState<Mostrar>('abaixo')

  const limite = Math.max(0, parseValorBr(String(limiteTexto)) || 0)
  const n = Number(periodo)
  const mesFim = comMesAtual ? mesAtual : somarMeses(mesAtual, -1)
  const mesInicio = somarMeses(mesFim, -(n - 1))
  const meses = useMemo(() => Array.from({ length: n }, (_, i) => somarMeses(mesInicio, i)), [mesInicio, n])
  const { data, isLoading } = trpc.reports.itensSapFaturamentoMensal.useQuery({ mesInicio, mesFim })

  const todas = useMemo(
    () =>
      (data?.itens ?? []).map((it) => {
        const porMes = meses.map((m) => it.meses[m] ?? { quantidade: 0, valor: 0, notas: 0 })
        const valor = porMes.reduce((s, m) => s + m.valor, 0)
        const quantidade = porMes.reduce((s, m) => s + m.quantidade, 0)
        const mediaMes = valor / meses.length
        const maiorMes = Math.max(...porMes.map((m) => m.valor))
        const abaixo = regra === 'media' ? mediaMes < limite : maiorMes < limite
        return {
          ...it,
          valor: Math.round(valor * 100) / 100,
          quantidade,
          precoMedio: quantidade > 0 ? valor / quantidade : null,
          mediaMes,
          mediaQtd: quantidade / meses.length,
          mesesComVenda: porMes.filter((m) => m.notas > 0).length,
          abaixo,
        }
      }),
    [data, meses, regra, limite]
  )
  const abaixo = todas.filter((l) => l.abaixo)
  const linhas = mostrar === 'abaixo' ? abaixo : todas
  const totalGeral = todas.reduce((s, l) => s + l.valor, 0)
  const totalAbaixo = abaixo.reduce((s, l) => s + l.valor, 0)

  type L = (typeof todas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, render: (l) => <span className="text-dark-400 text-xs">{l.codigo}</span> },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: simples },
    {
      id: 'item',
      rotulo: 'Item',
      quebrar: true,
      valor: (l) => l.descricao,
      render: (l) => (
        <span className="font-medium text-dark-50">
          {l.descricao}
          {mostrar === 'todos' && !l.abaixo && <span className="ml-2 text-[11px] font-normal text-emerald-400">acima de {moeda(limite)}</span>}
        </span>
      ),
    },
    ...meses.map(
      (m): Coluna<L> => ({
        id: `m-${m}`,
        rotulo: `${rotuloMes(m)}${m === mesAtual ? ' (até hoje)' : ''}`,
        valor: (l) => l.meses[m]?.valor ?? 0,
        formato: 'moeda',
        somar: true,
        render: (l) => {
          const c = l.meses[m]
          if (!c || (!c.valor && !c.quantidade)) return <span className="text-dark-600">—</span>
          return (
            <span className={`block text-right ${c.valor < limite ? 'text-red-400' : 'text-dark-100'}`}>
              {moeda(c.valor)}
              <span className="block text-[11px] text-dark-500">{qtd(c.quantidade)} un</span>
            </span>
          )
        },
      })
    ),
    { id: 'quantidade', rotulo: 'Qtd vendida', valor: (l) => Math.round(l.quantidade * 100) / 100, formato: 'numero', somar: true },
    { id: 'preco', rotulo: 'Preço médio de venda', valor: (l) => (l.precoMedio === null ? null : Math.round(l.precoMedio * 100) / 100), formato: 'moeda' },
    { id: 'valor', rotulo: 'Faturado no período', valor: (l) => l.valor, formato: 'moeda', somar: true },
    {
      id: 'media',
      rotulo: 'Média por mês',
      valor: (l) => Math.round(l.mediaMes * 100) / 100,
      formato: 'moeda',
      render: (l) => <span className={`font-semibold ${l.mediaMes < limite ? 'text-red-400' : 'text-emerald-400'}`}>{moeda(l.mediaMes)}</span>,
    },
    { id: 'mediaQtd', rotulo: 'Unidades por mês', valor: (l) => Math.round(l.mediaQtd * 10) / 10, formato: 'numero', oculta: simples },
    { id: 'mesesVenda', rotulo: 'Meses com venda', valor: (l) => l.mesesComVenda, formato: 'numero', render: (l) => <span className="text-dark-300">{l.mesesComVenda} de {meses.length}</span> },
    { id: 'estoque', rotulo: 'Estoque hoje', valor: (l) => l.estoque, formato: 'numero', oculta: simples },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-dark-400">
          Fatura menos que (R$ por mês)
          <input inputMode="decimal" value={limiteTexto} onChange={(e) => setLimiteTexto(e.target.value)} className={`${classeCampo} w-36`} />
        </label>
        <Abas<'3' | '6' | '12'>
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { valor: '3', rotulo: '3 meses' },
            { valor: '6', rotulo: '6 meses' },
            { valor: '12', rotulo: '12 meses' },
          ]}
        />
        <Abas<Regra>
          valor={regra}
          onChange={setRegra}
          opcoes={[
            { valor: 'media', rotulo: 'Pela média do mês' },
            { valor: 'todos', rotulo: 'Em todos os meses' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-dark-300 h-9">
          <input type="checkbox" checked={comMesAtual} onChange={(e) => setComMesAtual(e.target.checked)} />
          Contar o mês atual ({rotuloMes(mesAtual)}, até hoje)
        </label>
      </div>
      <AvisoDados s={data} />
      {mostrarResumo && data?.temFilial && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard titulo={`Itens abaixo de ${moeda(limite)}/mês`} icone={PackageSearch} cor="#e5534b" valor={numero(abaixo.length)} detalhe={`de ${numero(todas.length)} itens que venderam de ${rotuloMes(mesInicio)} a ${rotuloMes(mesFim)}`} />
          <KpiCard titulo="Quanto esses itens faturam juntos" icone={Coins} cor="#f97316" valor={moeda(totalAbaixo / meses.length)} detalhe={`por mês, em média (${moeda(totalAbaixo)} no período)`} />
          <KpiCard titulo="Parte do faturamento" icone={Percent} cor="#a855f7" valor={pct(totalGeral > 0 ? (totalAbaixo / totalGeral) * 100 : 0)} detalhe={`de ${moeda(totalGeral / meses.length)}/mês de todos os itens`} />
        </div>
      )}
      <Abas<Mostrar>
        valor={mostrar}
        onChange={setMostrar}
        opcoes={[
          { valor: 'abaixo', rotulo: `Só os abaixo de ${moeda(limite)}`, contagem: abaixo.length },
          { valor: 'todos', rotulo: 'Todos os itens (para buscar um item)', contagem: todas.length },
        ]}
      />
      <TabelaDados
        id="itens-sap-faturam-pouco"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item que o vendedor disse que faltou..."
        nomeArquivo={`itens-faturam-menos-que-${limite}-${mesInicio}-a-${mesFim}.csv`}
        ordemInicial={{ coluna: 'media', direcao: 'asc' }}
        simples={simples}
        carregando={isLoading}
        vazio={mostrar === 'abaixo' ? `Nenhum item faturou menos que ${moeda(limite)} por mês no período.` : 'Nenhum item vendido no período.'}
      />
      <Rodape
        s={data}
        extra={`Faturamento = valor das notas de saída do SAP (sem impostos, como no SAP), menos as devoluções. "Pela média do mês" = faturado no período ÷ ${meses.length} meses (mês sem venda conta como zero). "Em todos os meses" = nenhum mês chegou a ${moeda(limite)}. Só entram itens que tiveram nota no período; os que não venderam nada estão na aba Menos vendidos. Aqui entram TODAS as notas da filial no SAP (inclusive cliente que não está no CRM e venda para as empresas do grupo); o Mês a mês conta só os clientes do CRM, por isso os números podem ser diferentes. Tubos e conexões (grupos PPR e ODIN TUBOS do SAP) contam só na Odin Tubos, inclusive os que saíram pela filial da Joitec para cliente de fora.`}
      />
    </div>
  )
}
