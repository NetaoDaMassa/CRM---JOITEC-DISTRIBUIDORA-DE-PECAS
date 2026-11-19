import { useMemo, useState } from 'react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { parseValorBr } from '../../../lib/valorBr'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import type { PropsDetalhe } from './tipos'
import { AvisoDados } from './ItensSapEstoque'
import { ComoCalcula, Pergunta, classeCampo, mesesAtras, moedaCurta, rotuloMes } from './itensSapComum'

// Aba "Itens que vendem pouco" do relatório Itens do SAP (João, 2026-11-18:
// vendedor diz que não bateu meta porque faltou tal item — e o item fatura
// R$ 500 no mês). Junta a antiga "Faturam pouco" com os itens com estoque
// que não venderam nada (antiga "Menos vendidos"); redesenho 2026-11-19.
// Faturamento direto das notas do SAP da filial, de todos os clientes, já
// sem as devoluções (server/src/lib/sapEstoque.ts).

type Props = Pick<PropsDetalhe, 'simples' | 'mostrarResumo'>
type Mostrar = 'abaixo' | 'todos'
type Periodo = '3' | '6' | '12'

const qtd = (v: number) => numero(Math.round(v * 10) / 10)
const ultimoDia = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function VendemPouco({ simples, mostrarResumo }: Props) {
  const mesAtual = hojeBrString().slice(0, 7)
  const [limiteTexto, setLimiteTexto] = usePersistedState<string>('rel:itensSap:pouco:limite', '1000')
  const [periodo, setPeriodo] = usePersistedState<Periodo>('rel:itensSap:pouco:meses', '3')
  const [comZerados, setComZerados] = usePersistedState<boolean>('rel:itensSap:pouco:zerados', false)
  const [mostrar, setMostrar] = useState<Mostrar>('abaixo')

  const limite = Math.max(0, parseValorBr(String(limiteTexto)) || 0)
  const n = Number(periodo)
  // Só meses fechados: o mês pela metade puxaria a média pra baixo.
  const mesFim = mesesAtras(mesAtual, 1)
  const mesInicio = mesesAtras(mesFim, n - 1)
  const meses = useMemo(() => Array.from({ length: n }, (_, i) => mesesAtras(mesInicio, -i)), [mesInicio, n])
  const { data, isLoading } = trpc.reports.itensSapFaturamentoMensal.useQuery({ mesInicio, mesFim })
  const zerados = trpc.reports.itensSapMenosVendidos.useQuery({ de: `${mesInicio}-01`, ate: ultimoDia(mesFim) }, { enabled: comZerados })

  const todas = useMemo(() => {
    const vendidos = (data?.itens ?? []).map((it) => {
      const porMes = meses.map((m) => it.meses[m] ?? { quantidade: 0, valor: 0, notas: 0 })
      const valor = porMes.reduce((s, m) => s + m.valor, 0)
      const quantidade = porMes.reduce((s, m) => s + m.quantidade, 0)
      return {
        codigo: it.codigo,
        codigoAntigo: it.codigoAntigo,
        descricao: it.descricao,
        estoque: it.estoque,
        meses: it.meses,
        valor: Math.round(valor * 100) / 100,
        quantidade,
        precoMedio: quantidade > 0 ? valor / quantidade : null,
        mediaMes: valor / meses.length,
        mediaQtd: quantidade / meses.length,
        mesesComVenda: porMes.filter((m) => m.notas > 0).length,
        semVenda: false,
      }
    })
    if (!comZerados) return vendidos
    const ja = new Set(vendidos.map((v) => v.codigo))
    const semVenda = (zerados.data?.itens ?? [])
      .filter((z) => z.quantidade === 0 && z.estoque > 0 && !ja.has(z.codigo))
      .map((z) => ({ codigo: z.codigo, codigoAntigo: z.codigoAntigo, descricao: z.descricao, estoque: z.estoque, meses: {} as Record<string, { quantidade: number; valor: number; notas: number }>, valor: 0, quantidade: 0, precoMedio: null, mediaMes: 0, mediaQtd: 0, mesesComVenda: 0, semVenda: true }))
    return [...vendidos, ...semVenda]
  }, [data, zerados.data, comZerados, meses])
  // Item com faturamento zerado ou negativo no período (só devolução, ou
  // devolvido mais do que vendeu) não é "vende pouco": fica só em Todos.
  const abaixo = todas.filter((l) => l.mediaMes < limite && (l.semVenda || l.valor > 0))
  const linhas = mostrar === 'abaixo' ? abaixo : todas
  const totalGeral = todas.reduce((s, l) => s + l.valor, 0)
  const totalAbaixo = abaixo.reduce((s, l) => s + l.valor, 0)
  const parte = totalGeral > 0 ? (totalAbaixo / totalGeral) * 100 : 0
  const vendidosAbaixo = abaixo.filter((l) => !l.semVenda).length

  type L = (typeof todas)[number]
  const colunas: Coluna<L>[] = [
    {
      id: 'item',
      rotulo: 'Item',
      quebrar: true,
      valor: (l) => l.descricao,
      render: (l) => (
        <span>
          <span className="font-medium text-dark-50">{l.descricao}</span>
          <span className="block text-[11px] text-dark-500">
            {l.codigo}
            {l.codigoAntigo ? ` · ${l.codigoAntigo}` : ''}
            {mostrar === 'todos' && l.mediaMes >= limite && <span className="ml-2 text-emerald-400">acima de {moeda(limite)}/mês</span>}
          </span>
        </span>
      ),
    },
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, oculta: true },
    { id: 'antigo', rotulo: 'Cód. antigo', valor: (l) => l.codigoAntigo, oculta: true },
    {
      id: 'media',
      rotulo: 'Fatura por mês',
      valor: (l) => Math.round(l.mediaMes * 100) / 100,
      formato: 'moeda',
      render: (l) =>
        l.semVenda ? (
          <span className="text-xs font-semibold text-red-400">não vendeu</span>
        ) : (
          <span className={`font-semibold ${l.mediaMes < limite ? 'text-red-400' : 'text-emerald-400'}`}>{moeda(l.mediaMes)}</span>
        ),
    },
    { id: 'mediaQtd', rotulo: 'Unidades por mês', valor: (l) => Math.round(l.mediaQtd * 10) / 10, formato: 'numero', render: (l) => <span className="text-dark-200">{qtd(l.mediaQtd)}</span> },
    { id: 'preco', rotulo: 'Preço médio', valor: (l) => (l.precoMedio === null ? null : Math.round(l.precoMedio * 100) / 100), formato: 'moeda' },
    {
      id: 'mesesVenda',
      rotulo: 'Vendeu em',
      valor: (l) => l.mesesComVenda,
      render: (l) => <span className="text-dark-300">{l.mesesComVenda} de {meses.length} meses</span>,
    },
    { id: 'estoque', rotulo: 'Estoque hoje', valor: (l) => l.estoque, formato: 'numero', oculta: simples },
    { id: 'valor', rotulo: 'Faturado no período', valor: (l) => l.valor, formato: 'moeda', somar: true, oculta: true },
    { id: 'quantidade', rotulo: 'Unidades no período', valor: (l) => Math.round(l.quantidade * 100) / 100, formato: 'numero', oculta: true },
    ...meses.map(
      (m): Coluna<L> => ({
        id: `m-${m}`,
        rotulo: `${rotuloMes(m)} (R$)`,
        valor: (l) => l.meses[m]?.valor ?? 0,
        formato: 'moeda',
        somar: true,
        oculta: true,
      })
    ),
  ]

  return (
    <div className="space-y-5">
      <Pergunta titulo="Quais itens vendem pouco?" apoio={`Média por mês de ${rotuloMes(mesInicio)} a ${rotuloMes(mesFim)} (meses fechados). Bom para conferir quando alguém diz que "faltou tal item".`}>
        <label className="flex items-center gap-2 text-sm text-dark-300">
          Faturam menos de R$
          <input inputMode="decimal" value={limiteTexto} onChange={(e) => setLimiteTexto(e.target.value)} className={`${classeCampo} w-28`} aria-label="Valor por mês" />
          por mês
        </label>
        <Abas<Periodo>
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { valor: '3', rotulo: '3 meses' },
            { valor: '6', rotulo: '6 meses' },
            { valor: '12', rotulo: '12 meses' },
          ]}
        />
      </Pergunta>
      <AvisoDados s={data} />

      {mostrarResumo && data?.temFilial && (
        <>
          <div className="rounded-2xl border border-dark-600 bg-dark-800 p-5">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-3">
              <span><span className="text-3xl font-bold text-dark-50">{numero(vendidosAbaixo)}</span> <span className="text-sm text-dark-400">itens abaixo de {moeda(limite)}/mês</span></span>
              <span><span className="text-3xl font-bold text-orange-400">{moedaCurta(totalAbaixo / meses.length)}</span> <span className="text-sm text-dark-400">é o que eles faturam juntos por mês</span></span>
              <span><span className="text-3xl font-bold text-dark-50">{pct(parte)}</span> <span className="text-sm text-dark-400">do faturamento em itens</span></span>
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-dark-700 overflow-hidden" role="img" aria-label={`${pct(parte)} do faturamento`}>
              <div className="h-full rounded-full bg-orange-500/80" style={{ width: `${Math.min(100, parte)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-dark-500">A barra laranja é a parte do faturamento que vem desses itens; o resto vem dos itens que vendem mais.</p>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Abas<Mostrar>
          valor={mostrar}
          onChange={setMostrar}
          opcoes={[
            { valor: 'abaixo', rotulo: `Abaixo de ${moeda(limite)}`, contagem: abaixo.length },
            { valor: 'todos', rotulo: 'Todos os itens', contagem: todas.length },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-dark-300">
          <input type="checkbox" checked={comZerados} onChange={(e) => setComZerados(e.target.checked)} />
          Incluir itens com estoque que não venderam nada
        </label>
      </div>
      <TabelaDados
        id="itens-sap-vendem-pouco"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.codigo}
        buscaEm={(l) => `${l.codigo} ${l.codigoAntigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar o item (ex.: o que o vendedor disse que faltou)..."
        nomeArquivo={`itens-vendem-pouco-${mesInicio}-a-${mesFim}.csv`}
        ordemInicial={{ coluna: 'media', direcao: 'asc' }}
        simples={simples}
        carregando={isLoading || (comZerados && zerados.isLoading)}
        vazio={mostrar === 'abaixo' ? `Nenhum item faturou menos de ${moeda(limite)} por mês.` : 'Nenhum item vendido no período.'}
      />
      <ComoCalcula
        itens={[
          'Faturamento = valor das notas de venda do SAP da filial, sem impostos, menos as devoluções. Entram todos os clientes (até quem não está no CRM).',
          `"Fatura por mês" = faturado no período ÷ ${meses.length} meses; mês sem venda conta como zero. O mês atual não entra porque ainda não fechou.`,
          '"Preço médio" = faturado ÷ unidades vendidas no período.',
          'Tubos e conexões de PPR (grupos PPR e ODIN TUBOS do SAP) contam só na Odin Tubos, inclusive os que saíram pela filial da Joitec para cliente de fora. Ficam de fora os grupos ATIVO e CONSUMO.',
          'Para ver o faturamento de cada mês, ligue as colunas dos meses em "Colunas".',
        ]}
      />
    </div>
  )
}
