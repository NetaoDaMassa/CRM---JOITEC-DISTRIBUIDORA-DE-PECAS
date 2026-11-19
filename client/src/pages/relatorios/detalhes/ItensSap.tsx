import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, BarChart3, Wallet } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, KpiCard, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import Modal from '../../../components/ui/Modal'
import type { PropsDetalhe } from './tipos'
import { EstoqueParado } from './ItensSapEstoque'
import { ComoCalcula, Pergunta, classeCampo, eixoY, estiloTooltip, mesLongo, mesesAtras, moedaCurta, rotuloMes, tick } from './itensSapComum'
import { VendemPouco } from './ItensSapFaturamento'

// Itens do SAP — redesenho pedido pelo João em 2026-11-19 ("muito
// complicado, difícil de entender; precisa ficar visível pra diretoria"):
// eram 5 abas com perguntas parecidas. Agora são 3, cada uma com UMA
// pergunta em português, no máximo 3 números no topo, tabela enxuta (o resto
// em "Colunas") e o "como é calculado" escondido num botão.
//   1. Como os itens estão indo — mês × mês (o relatório do diretor,
//      2026-10-30: "item que em um mês vendeu 1000 e em novembro 600").
//   2. Itens que vendem pouco — faturam pouco + os que não venderam nada.
//   3. Estoque parado — sem venda + pra quantos meses o estoque dá.

type AbaItens = 'evolucao' | 'pouco' | 'parado'

export function ItensSap(props: PropsDetalhe) {
  const [aba, setAba] = usePersistedState<AbaItens>('rel:itensSap:aba3', 'evolucao')
  return (
    <div className="space-y-6">
      <Abas<AbaItens>
        valor={aba}
        onChange={setAba}
        opcoes={[
          { valor: 'evolucao', rotulo: 'Como os itens estão indo' },
          { valor: 'pouco', rotulo: 'Itens que vendem pouco' },
          { valor: 'parado', rotulo: 'Estoque parado' },
        ]}
      />
      {aba === 'evolucao' && <ItensMesAMes {...props} />}
      {aba === 'pouco' && <VendemPouco simples={props.simples} mostrarResumo={props.mostrarResumo} />}
      {aba === 'parado' && <EstoqueParado simples={props.simples} mostrarResumo={props.mostrarResumo} />}
    </div>
  )
}

type Medida = 'valor' | 'quantidade'
type Situacao = 'caiu' | 'parou' | 'subiu' | 'novo'
const SITUACAO: Record<Situacao, { rotulo: string; classe: string }> = {
  caiu: { rotulo: 'caiu', classe: 'bg-red-500/15 text-red-400' },
  parou: { rotulo: 'parou de vender', classe: 'bg-orange-500/15 text-orange-400' },
  subiu: { rotulo: 'subiu', classe: 'bg-emerald-500/15 text-emerald-400' },
  novo: { rotulo: 'novo', classe: 'bg-sky-500/15 text-sky-400' },
}

function ItensMesAMes({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const mesAtual = hojeBrString().slice(0, 7)
  // 12 meses sempre (a consulta leva ~0,1 s): o gráfico mostra o ano e os
  // seletores escolhem dentro dele.
  const mesInicio = mesesAtras(mesAtual, 11)
  const entrada = { mesInicio, mesFim: mesAtual, vendedorId: f.periodo.vendedorId, regiao: f.periodo.regiao }
  const { data, isLoading } = trpc.reports.itensSapPorMes.useQuery(entrada)
  // Meses antes do SAP começar (31/03/2026) ficam vazios: não mostra.
  const meses = useMemo(() => {
    const todos = data?.meses ?? []
    const primeiro = todos.findIndex((m) => (data?.itens ?? []).some((it) => (it.meses[m]?.valor ?? 0) > 0))
    return primeiro > 0 ? todos.slice(primeiro) : todos
  }, [data])
  const [medida, setMedida] = usePersistedState<Medida>('rel:itensSap:medida2', 'valor')
  const [todosMeses, setTodosMeses] = usePersistedState<boolean>('rel:itensSap:todosMeses', false)

  // Por padrão os dois últimos meses FECHADOS (mês pela metade faz tudo
  // parecer queda). O mais antigo fica sempre à esquerda.
  const [mesA, setMesA] = useState<string | null>(null)
  const [mesB, setMesB] = useState<string | null>(null)
  const fechados = meses.filter((m) => m < mesAtual)
  const escolhaA = mesA && meses.includes(mesA) ? mesA : fechados[fechados.length - 2] ?? meses[0] ?? mesAtual
  const escolhaB = mesB && meses.includes(mesB) ? mesB : fechados[fechados.length - 1] ?? mesAtual
  const [a, b] = escolhaA <= escolhaB ? [escolhaA, escolhaB] : [escolhaB, escolhaA]
  const bParcial = b === mesAtual
  const [situacao, setSituacao] = useState<Situacao | 'todos'>('todos')
  const [aberto, setAberto] = useState<{ chave: string; descricao: string; codigo: string | null } | null>(null)

  const ehValor = medida === 'valor'
  const fmt = (v: number) => (ehValor ? moeda(v) : `${numero(Math.round(v * 100) / 100)} un`)
  const nomeMes = (m: string) => `${rotuloMes(m)}${m === mesAtual ? ' (até hoje)' : ''}`

  const linhas = useMemo(
    () =>
      (data?.itens ?? []).map((it) => {
        const va = it.meses[a]?.[medida] ?? 0
        const vb = it.meses[b]?.[medida] ?? 0
        const ra = it.meses[a]?.valor ?? 0
        const rb = it.meses[b]?.valor ?? 0
        const sit: Situacao | null = va > 0 && vb <= 0 ? 'parou' : va <= 0 && vb > 0 ? 'novo' : vb < va ? 'caiu' : vb > va ? 'subiu' : null
        return { ...it, va, vb, variacao: vb - va, variacaoPct: va > 0 ? ((vb - va) / va) * 100 : null, variacaoReais: rb - ra, situacao: sit }
      }),
    [data, a, b, medida]
  )
  const conta = (s: Situacao) => linhas.filter((l) => l.situacao === s).length
  const cairam = linhas.filter((l) => l.situacao === 'caiu' || l.situacao === 'parou')
  const subiram = linhas.filter((l) => l.situacao === 'subiu' || l.situacao === 'novo')
  const perdido = cairam.reduce((s, l) => s + Math.min(0, l.variacaoReais), 0)
  const ganho = subiram.reduce((s, l) => s + Math.max(0, l.variacaoReais), 0)
  const totalA = linhas.reduce((s, l) => s + (l.meses[a]?.valor ?? 0), 0)
  const totalB = linhas.reduce((s, l) => s + (l.meses[b]?.valor ?? 0), 0)
  const serie = meses.map((m) => ({ mes: m, rotulo: rotuloMes(m), valor: linhas.reduce((s, l) => s + (l.meses[m]?.valor ?? 0), 0) }))
  const quedas = [...linhas].filter((l) => l.variacaoReais < 0).sort((x, y) => x.variacaoReais - y.variacaoReais).slice(0, 6)
  const altas = [...linhas].filter((l) => l.variacaoReais > 0).sort((x, y) => y.variacaoReais - x.variacaoReais).slice(0, 6)
  const filtradas =
    situacao === 'todos' ? linhas : situacao === 'caiu' ? cairam : situacao === 'subiu' ? subiram : linhas.filter((l) => l.situacao === situacao)
  const abrir = (l: { chave: string; descricao: string; codigo: string | null }) => setAberto({ chave: l.chave, descricao: l.descricao, codigo: l.codigo })

  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    {
      id: 'item',
      rotulo: 'Item',
      quebrar: true,
      valor: (l) => l.descricao,
      render: (l) => (
        <button type="button" onClick={() => abrir(l)} className="text-left group">
          <span className="font-medium text-dark-50 group-hover:text-gold-400 inline-flex items-center gap-1.5">
            <BarChart3 size={13} className="text-dark-500 shrink-0" />
            {l.descricao}
          </span>
          {l.codigo && <span className="block text-[11px] text-dark-500 ml-5">{l.codigo}</span>}
        </button>
      ),
    },
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, oculta: true },
    ...(todosMeses
      ? meses
          .filter((m) => m !== a && m !== b)
          .map(
            (m): Coluna<L> => ({
              id: `m-${m}`,
              rotulo: nomeMes(m),
              valor: (l) => l.meses[m]?.[medida] ?? 0,
              formato: ehValor ? 'moeda' : 'numero',
              somar: ehValor,
              render: (l) => <span className="text-dark-400">{l.meses[m]?.[medida] ? fmt(l.meses[m][medida]) : '—'}</span>,
            })
          )
      : []),
    { id: 'a', rotulo: nomeMes(a), valor: (l) => l.va, formato: ehValor ? 'moeda' : 'numero', somar: ehValor, render: (l) => <span className="text-dark-200">{l.va ? fmt(l.va) : '—'}</span> },
    { id: 'b', rotulo: nomeMes(b), valor: (l) => l.vb, formato: ehValor ? 'moeda' : 'numero', somar: ehValor, render: (l) => <span className="font-semibold text-dark-50">{l.vb ? fmt(l.vb) : '—'}</span> },
    {
      id: 'variacao',
      rotulo: 'Diferença',
      valor: (l) => l.variacao,
      formato: ehValor ? 'moeda' : 'numero',
      somar: ehValor,
      render: (l) => (
        <span className={`font-semibold ${l.variacao < 0 ? 'text-red-400' : l.variacao > 0 ? 'text-emerald-400' : 'text-dark-500'}`}>
          {l.variacao > 0 ? '+' : ''}
          {fmt(l.variacao)}
          {l.variacaoPct !== null && l.variacao !== 0 && <span className="ml-1.5 text-xs font-normal opacity-80">({l.variacaoPct > 0 ? '+' : ''}{pct(l.variacaoPct, 0)})</span>}
        </span>
      ),
    },
    { id: 'variacaoPct', rotulo: 'Variação %', valor: (l) => (l.variacaoPct === null ? null : Math.round(l.variacaoPct * 10) / 10), formato: 'pct', oculta: true },
    {
      id: 'situacao',
      rotulo: 'Situação',
      valor: (l) => (l.situacao ? SITUACAO[l.situacao].rotulo : ''),
      render: (l) => (l.situacao ? <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SITUACAO[l.situacao].classe}`}>{SITUACAO[l.situacao].rotulo}</span> : <span className="text-dark-600">—</span>),
    },
    {
      id: 'devolvido',
      rotulo: `Devolvido em ${rotuloMes(b)}`,
      valor: (l) => Math.round(((ehValor ? l.meses[b]?.devolvidoValor : l.meses[b]?.devolvidoQtd) ?? 0) * 100) / 100,
      formato: ehValor ? 'moeda' : 'numero',
      oculta: true,
    },
  ]

  return (
    <div className="space-y-5">
      <Pergunta titulo="Quais itens caíram e quais subiram?" apoio={`Comparando ${mesLongo(a)} com ${mesLongo(b)}${bParcial ? ' (até hoje)' : ''}. Clique em um item para ver o gráfico e quem comprou.`}>
        <label className="flex items-center gap-1.5 text-sm text-dark-300">
          <select value={a} onChange={(e) => (setMesA(e.target.value), setMesB(b))} className={classeCampo} aria-label="Mês de comparação">
            {meses.map((m) => (
              <option key={m} value={m}>
                {nomeMes(m)}
              </option>
            ))}
          </select>
          com
          <select value={b} onChange={(e) => (setMesB(e.target.value), setMesA(a))} className={classeCampo} aria-label="Mês comparado">
            {meses.map((m) => (
              <option key={m} value={m}>
                {nomeMes(m)}
              </option>
            ))}
          </select>
        </label>
        <Abas<Medida>
          valor={medida}
          onChange={setMedida}
          opcoes={[
            { valor: 'valor', rotulo: 'Em R$' },
            { valor: 'quantidade', rotulo: 'Em unidades' },
          ]}
        />
      </Pergunta>

      {bParcial && (
        <p className="text-sm text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
          ⚠️ {rotuloMes(b)} ainda está no dia {Number(hojeBrString().slice(8, 10))}: comparado com um mês inteiro, quase todo item parece ter caído. Para comparar de verdade, escolha dois meses fechados.
        </p>
      )}

      {mostrarResumo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            titulo={`Faturado em ${nomeMes(b)}`}
            icone={Wallet}
            cor="#0ea5a4"
            valor={moedaCurta(totalB)}
            detalhe={`${rotuloMes(a)}: ${moedaCurta(totalA)}${totalA ? ` · ${totalB >= totalA ? '+' : ''}${pct(((totalB - totalA) / totalA) * 100)}` : ''}`}
            destaque={totalB < totalA ? 'ruim' : totalB > totalA ? 'bom' : undefined}
          />
          <KpiCard
            titulo="Itens que caíram"
            icone={ArrowDownRight}
            cor="#e5534b"
            valor={numero(cairam.length)}
            detalhe={`${moedaCurta(perdido)} · ${numero(conta('parou'))} pararam de vender`}
            onClick={() => setSituacao('caiu')}
          />
          <KpiCard
            titulo="Itens que subiram"
            icone={ArrowUpRight}
            cor="#22a861"
            valor={numero(subiram.length)}
            detalhe={`+${moedaCurta(ganho)} · ${numero(conta('novo'))} novos`}
            onClick={() => setSituacao('subiu')}
          />
        </div>
      )}

      {mostrarResumo && (
        <div className="grid grid-cols-1 gap-4">
          <div className="min-w-0">
            <Secao titulo="Faturado por mês" subtitulo={`Todos os itens, já sem as devoluções. Em destaque: ${rotuloMes(a)} e ${rotuloMes(b)}.`}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-dark-700)" />
                    <XAxis dataKey="rotulo" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={eixoY} width={44} />
                    <Tooltip
                      contentStyle={estiloTooltip}
                      cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }}
                      labelFormatter={(_, p) => (p?.[0]?.payload?.mes ? nomeMes(p[0].payload.mes) : '')}
                      formatter={(v) => [moeda(Number(v)), 'Faturado']}
                    />
                    <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} onClick={(d) => d?.payload?.mes && setMesB((d.payload as { mes: string }).mes)}>
                      {serie.map((s) => (
                        <Cell key={s.mes} cursor="pointer" fill={s.mes === a || s.mes === b ? '#0ea5a4' : 'var(--color-dark-600)'} fillOpacity={s.mes === mesAtual ? 0.55 : 1} />
                      ))}
                      <LabelList dataKey="valor" position="top" formatter={(v) => (v ? eixoY(Number(v)) : '')} style={{ fill: 'var(--color-dark-400)', fontSize: 10 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Secao>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 [&>*]:min-w-0">
            <ListaVariacao titulo="Maiores quedas" itens={quedas} vazio="Nenhum item caiu." aoAbrir={abrir} />
            <ListaVariacao titulo="Maiores altas" itens={altas} vazio="Nenhum item subiu." aoAbrir={abrir} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Abas<Situacao | 'todos'>
          valor={situacao}
          onChange={setSituacao}
          opcoes={[
            { valor: 'todos', rotulo: 'Todos', contagem: linhas.length },
            { valor: 'caiu', rotulo: 'Caíram', contagem: cairam.length },
            { valor: 'parou', rotulo: 'Pararam', contagem: conta('parou') },
            { valor: 'subiu', rotulo: 'Subiram', contagem: subiram.length },
            { valor: 'novo', rotulo: 'Novos', contagem: conta('novo') },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-dark-300">
          <input type="checkbox" checked={todosMeses} onChange={(e) => setTodosMeses(e.target.checked)} />
          Mostrar os outros meses na tabela
        </label>
      </div>
      <TabelaDados
        id={`itens-sap-evolucao-${todosMeses ? 'todos' : 'dois'}`}
        linhas={filtradas}
        colunas={colunas}
        chave={(l) => l.chave}
        buscaEm={(l) => `${l.codigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo={`itens-sap-${a}-x-${b}.csv`}
        ordemInicial={{ coluna: 'variacao', direcao: 'asc' }}
        simples={simples}
        carregando={isLoading}
        vazio="Nenhum item vendido nesses meses."
      />
      <ComoCalcula
        itens={[
          'Itens das notas de venda do SAP dos clientes cadastrados no CRM (na Odin Compressores, só a carteira da Bruna).',
          'Devoluções são descontadas no mês em que o cliente devolveu. Nota cancelada no SAP sai na próxima atualização.',
          'Tubos e conexões de PPR (grupos PPR e ODIN TUBOS do SAP) contam só na Odin Tubos — inclusive os que saíram pela filial da Joitec para cliente de fora. Venda da Joitec para a própria Odin Tubos não conta (é abastecimento).',
          '"Caíram" inclui os que pararam de vender; "Subiram" inclui os novos. Valores sem impostos, como nas linhas da nota no SAP.',
          'O cliente conta para o vendedor que tem ele na carteira hoje. Cliente excluído do CRM continua contando nos meses em que comprou.',
          'Na aba "Itens que vendem pouco" entram todas as notas da filial (até de cliente que não está no CRM), por isso os totais podem ser um pouco maiores.',
        ]}
      />

      {aberto && <DetalheItem item={aberto} entrada={entrada} meses={meses} medida={medida} fmt={fmt} destaque={[a, b]} clientesBase={clientesBase} onClose={() => setAberto(null)} />}
    </div>
  )
}

function ListaVariacao({
  titulo,
  itens,
  vazio,
  aoAbrir,
}: {
  titulo: string
  itens: { chave: string; descricao: string; codigo: string | null; variacaoReais: number }[]
  vazio: string
  aoAbrir: (l: { chave: string; descricao: string; codigo: string | null }) => void
}) {
  const max = Math.max(1, ...itens.map((l) => Math.abs(l.variacaoReais)))
  const queda = titulo.includes('queda')
  return (
    <Secao titulo={titulo} subtitulo="Em R$, clique para ver o item">
      {itens.length ? (
        <ul className="space-y-1 min-w-0">
          {itens.map((l) => (
            <li key={l.chave}>
              <button type="button" onClick={() => aoAbrir(l)} className="w-full min-w-0 text-left rounded-lg px-2 py-1.5 hover:bg-dark-700/60">
                <span className="flex items-center justify-between gap-3 text-sm min-w-0">
                  <span className="text-dark-100 truncate min-w-0" title={l.descricao}>{l.descricao}</span>
                  <span className={`shrink-0 font-semibold ${queda ? 'text-red-400' : 'text-emerald-400'}`}>
                    {queda ? '' : '+'}
                    {moedaCurta(l.variacaoReais)}
                  </span>
                </span>
                <span className="mt-1 block h-1 rounded-full bg-dark-700 overflow-hidden">
                  <span className={`block h-full rounded-full ${queda ? 'bg-red-500/70' : 'bg-emerald-500/70'}`} style={{ width: `${(Math.abs(l.variacaoReais) / max) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-dark-400">{vazio}</p>
      )}
    </Secao>
  )
}

function DetalheItem({
  item,
  entrada,
  meses,
  medida,
  fmt,
  destaque,
  clientesBase,
  onClose,
}: {
  item: { chave: string; descricao: string; codigo: string | null }
  entrada: { mesInicio: string; mesFim: string; vendedorId?: number; regiao?: PropsDetalhe['f']['periodo']['regiao'] }
  meses: string[]
  medida: Medida
  fmt: (v: number) => string
  destaque: [string, string]
  clientesBase: string
  onClose: () => void
}) {
  const { data, isLoading } = trpc.reports.itemSapClientes.useQuery({ ...entrada, chave: item.chave })
  const [mesA, mesB] = destaque

  const { serie, clientes } = useMemo(() => {
    const porMes = new Map<string, number>()
    const porCliente = new Map<number, { clienteId: number; razaoSocial: string; codigo: string | null; excluido: boolean; soNaJoitec: boolean; vendedorNome: string | null; meses: Record<string, number> }>()
    for (const l of data ?? []) {
      porMes.set(l.mes, (porMes.get(l.mes) ?? 0) + l[medida])
      const c = porCliente.get(l.clienteId) ?? { clienteId: l.clienteId, razaoSocial: l.razaoSocial, codigo: l.codigo, excluido: l.excluido, soNaJoitec: l.soNaJoitec, vendedorNome: l.vendedorNome, meses: {} }
      c.meses[l.mes] = (c.meses[l.mes] ?? 0) + l[medida]
      porCliente.set(l.clienteId, c)
    }
    return {
      serie: meses.map((m) => ({ mes: m, rotulo: rotuloMes(m), valor: porMes.get(m) ?? 0 })),
      clientes: [...porCliente.values()].map((c) => ({ ...c, va: c.meses[mesA] ?? 0, vb: c.meses[mesB] ?? 0 })),
    }
  }, [data, meses, medida, mesA, mesB])
  type C = (typeof clientes)[number]
  const colunas: Coluna<C>[] = [
    { id: 'cliente', rotulo: 'Cliente', quebrar: true, valor: (c) => c.razaoSocial, render: (c) => (c.excluido || c.soNaJoitec ? <span className="font-medium text-dark-300">{c.razaoSocial} <span className="text-[11px] text-dark-500">{c.excluido ? '(cliente excluído)' : '(cadastro só na Joitec)'}</span></span> : <Link to={`${clientesBase}/${c.clienteId}`} className="font-medium text-dark-50 hover:text-gold-400">{c.razaoSocial}</Link>) },
    { id: 'vendedor', rotulo: 'Vendedor', valor: (c) => c.vendedorNome ?? '—' },
    ...meses.map((m): Coluna<C> => ({ id: `m-${m}`, rotulo: rotuloMes(m), valor: (c) => c.meses[m] ?? 0, formato: medida === 'valor' ? 'moeda' : 'numero', somar: true, render: (c) => <span className={m === mesA || m === mesB ? 'font-semibold text-dark-50' : 'text-dark-300'}>{c.meses[m] ? fmt(c.meses[m]) : '—'}</span> })),
    {
      id: 'situacao',
      rotulo: `${rotuloMes(mesA)} → ${rotuloMes(mesB)}`,
      valor: (c) => c.vb - c.va,
      render: (c) =>
        c.va > 0 && c.vb === 0 ? (
          <span className="text-xs font-semibold text-orange-500">parou de comprar</span>
        ) : (
          <span className={`font-semibold ${c.vb < c.va ? 'text-red-500' : c.vb > c.va ? 'text-emerald-500' : 'text-dark-400'}`}>{c.vb - c.va > 0 ? '+' : ''}{fmt(c.vb - c.va)}</span>
        ),
    },
  ]

  return (
    <Modal open onClose={onClose} title={item.codigo ? `${item.codigo} — ${item.descricao}` : item.descricao} size="xl">
      <div className="space-y-4">
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-dark-700)" />
              <XAxis dataKey="rotulo" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={eixoY} width={40} />
              <Tooltip contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} formatter={(v) => [fmt(Number(v)), medida === 'valor' ? 'Valor' : 'Quantidade']} />
              <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {serie.map((s) => (
                  <Cell key={s.mes} fill={s.mes === mesA || s.mes === mesB ? '#0ea5a4' : '#0ea5a466'} />
                ))}
                <LabelList dataKey="valor" position="top" formatter={(v) => (v ? fmt(Number(v)) : '')} style={{ fill: 'var(--color-dark-300)', fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-sm font-semibold text-dark-100">Quem comprou ({clientes.length})</p>
        <TabelaDados
          id={`itens-sap-clientes-${meses.length}`}
          linhas={clientes}
          colunas={colunas}
          chave={(c) => c.clienteId}
          buscaEm={(c) => `${c.razaoSocial} ${c.codigo ?? ''} ${c.vendedorNome ?? ''}`}
          placeholderBusca="Buscar cliente..."
          nomeArquivo={`item-${item.codigo ?? 'sap'}-clientes.csv`}
          ordemInicial={{ coluna: 'situacao', direcao: 'asc' }}
          porPaginaInicial={10}
          carregando={isLoading}
        />
      </div>
    </Modal>
  )
}
