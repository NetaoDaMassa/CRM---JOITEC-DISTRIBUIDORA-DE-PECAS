import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Package, PackageX, TrendingDown, TrendingUp } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { hojeBrString } from '../../../lib/utils'
import { usePersistedState } from '../../../lib/usePersistedState'
import { Abas, Chips, KpiCard, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import Modal from '../../../components/ui/Modal'
import type { PropsDetalhe } from './tipos'
import { EstoqueSemVenda, MenosVendidos, TempoEstoque } from './ItensSapEstoque'

// Itens do SAP mês a mês — pedido do diretor via João, 2026-10-30: "item
// que em um mês vendeu 1000 e em novembro vendeu 600". Tabela com um mês
// por coluna, comparação entre dois meses (variação em vermelho/verde) e,
// clicando no item, gráfico mês a mês + quem comprou em cada mês. Período
// próprio em meses inteiros (o filtro de datas dos outros relatórios não
// serve pra comparar mês com mês); vendedor e região vêm da barra.

type Medida = 'quantidade' | 'valor'
type Situacao = 'caiu' | 'subiu' | 'parou' | 'novo'

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const eixoY = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(v))

function mesesAtras(mes: string, n: number) {
  let [a, m] = mes.split('-').map(Number)
  m -= n
  while (m < 1) {
    m += 12
    a -= 1
  }
  return `${a}-${String(m).padStart(2, '0')}`
}

const PERIODOS = [
  { valor: '3', rotulo: '3 meses' },
  { valor: '6', rotulo: '6 meses' },
  { valor: '12', rotulo: '12 meses' },
] as const

// Abas (João, 2026-11-10): mês a mês (o relatório do diretor) + três de
// estoque, que vêm do SAP de hora em hora (ItensSapEstoque.tsx).
type AbaItens = 'mes' | 'menos' | 'sem_venda' | 'tempo'

export function ItensSap(props: PropsDetalhe) {
  const [aba, setAba] = usePersistedState<AbaItens>('rel:itensSap:aba', 'mes')
  return (
    <div className="space-y-5">
      <Abas<AbaItens>
        valor={aba}
        onChange={setAba}
        opcoes={[
          { valor: 'mes', rotulo: 'Mês a mês' },
          { valor: 'menos', rotulo: 'Menos vendidos' },
          { valor: 'sem_venda', rotulo: 'Estoque sem venda' },
          { valor: 'tempo', rotulo: 'Tempo de estoque' },
        ]}
      />
      {aba === 'mes' && <ItensMesAMes {...props} />}
      {aba === 'menos' && <MenosVendidos simples={props.simples} mostrarResumo={props.mostrarResumo} />}
      {aba === 'sem_venda' && <EstoqueSemVenda simples={props.simples} mostrarResumo={props.mostrarResumo} />}
      {aba === 'tempo' && <TempoEstoque simples={props.simples} mostrarResumo={props.mostrarResumo} />}
    </div>
  )
}

function ItensMesAMes({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const mesAtual = hojeBrString().slice(0, 7)
  const [periodo, setPeriodo] = usePersistedState<string>('rel:itensSap:meses', '6')
  const [medida, setMedida] = usePersistedState<Medida>('rel:itensSap:medida', 'quantidade')
  const mesInicio = mesesAtras(mesAtual, Number(periodo) - 1)
  const entrada = { mesInicio, mesFim: mesAtual, vendedorId: f.periodo.vendedorId, regiao: f.periodo.regiao }
  const { data, isLoading } = trpc.reports.itensSapPorMes.useQuery(entrada)
  const meses = data?.meses ?? []

  // Comparação: por padrão o mês passado × o atual; dá pra trocar.
  const [mesA, setMesA] = useState<string | null>(null)
  const [mesB, setMesB] = useState<string | null>(null)
  const a = mesA && meses.includes(mesA) ? mesA : meses[meses.length - 2] ?? mesAtual
  const b = mesB && meses.includes(mesB) ? mesB : meses[meses.length - 1] ?? mesAtual
  const [situacao, setSituacao] = useState<Situacao | null>(null)
  const [aberto, setAberto] = useState<{ chave: string; descricao: string; codigo: string | null } | null>(null)

  const ehValor = medida === 'valor'
  const fmt = (v: number) => (ehValor ? moeda(v) : numero(Math.round(v * 100) / 100))
  const nomeMes = (m: string) => `${rotuloMes(m)}${m === mesAtual ? ' (até hoje)' : ''}`

  const linhas = useMemo(
    () =>
      (data?.itens ?? []).map((it) => {
        const va = it.meses[a]?.[medida] ?? 0
        const vb = it.meses[b]?.[medida] ?? 0
        const variacao = vb - va
        const variacaoPct = va > 0 ? (vb - va) / va : null
        const sit: Situacao | null = va > 0 && vb === 0 ? 'parou' : va === 0 && vb > 0 ? 'novo' : vb < va ? 'caiu' : vb > va ? 'subiu' : null
        return { ...it, va, vb, variacao, variacaoPct, situacao: sit, total: it[medida] }
      }),
    [data, a, b, medida]
  )
  const contar = (s: Situacao) => linhas.filter((l) => l.situacao === s || (s === 'caiu' && l.situacao === 'parou')).length
  const filtradas = situacao ? linhas.filter((l) => l.situacao === situacao || (situacao === 'caiu' && l.situacao === 'parou')) : linhas
  const totalA = linhas.reduce((s, l) => s + l.va, 0)
  const totalB = linhas.reduce((s, l) => s + l.vb, 0)
  const serieTotal = meses.map((m) => ({ mes: rotuloMes(m), valor: linhas.reduce((s, l) => s + (l.meses[m]?.[medida] ?? 0), 0) }))
  const maioresQuedas = linhas.filter((l) => l.variacao < 0).sort((x, y) => x.variacao - y.variacao).slice(0, 8)

  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo, render: (l) => <span className="text-dark-400 text-xs">{l.codigo ?? '—'}</span> },
    {
      id: 'item',
      rotulo: 'Item',
      quebrar: true,
      valor: (l) => l.descricao,
      render: (l) => (
        <button type="button" onClick={() => setAberto({ chave: l.chave, descricao: l.descricao, codigo: l.codigo })} className="font-medium text-dark-50 hover:text-gold-400 text-left inline-flex items-center gap-1.5">
          <BarChart3 size={13} className="text-dark-500 shrink-0" />
          {l.descricao}
        </button>
      ),
    },
    ...meses.map(
      (m): Coluna<L> => ({
        id: `m-${m}`,
        rotulo: rotuloMes(m),
        valor: (l) => l.meses[m]?.[medida] ?? 0,
        formato: ehValor ? 'moeda' : 'numero',
        somar: true,
        render: (l) => {
          const v = l.meses[m]?.[medida] ?? 0
          return <span className={m === a || m === b ? 'font-semibold text-dark-50' : 'text-dark-300'}>{v ? fmt(v) : '—'}</span>
        },
      })
    ),
    {
      id: 'variacao',
      rotulo: `${rotuloMes(a)} → ${rotuloMes(b)}`,
      valor: (l) => l.variacao,
      formato: ehValor ? 'moeda' : 'numero',
      somar: true,
      render: (l) => <span className={`font-semibold ${l.variacao < 0 ? 'text-red-500' : l.variacao > 0 ? 'text-emerald-500' : 'text-dark-400'}`}>{l.variacao > 0 ? '+' : ''}{fmt(l.variacao)}</span>,
    },
    {
      id: 'variacaoPct',
      rotulo: 'Variação %',
      valor: (l) => l.variacaoPct,
      formato: 'pct',
      render: (l) =>
        l.variacaoPct === null ? (
          <span className="text-xs text-emerald-500">{l.vb > 0 ? 'novo' : '—'}</span>
        ) : (
          <span className={`font-semibold ${l.variacaoPct < 0 ? 'text-red-500' : l.variacaoPct > 0 ? 'text-emerald-500' : 'text-dark-400'}`}>
            {l.variacaoPct > 0 ? '+' : ''}
            {pct(l.variacaoPct * 100)}
          </span>
        ),
    },
    { id: 'total', rotulo: 'Total no período', valor: (l) => l.total, formato: ehValor ? 'moeda' : 'numero', somar: true, oculta: meses.length > 6 },
  ]

  const classeCampo = 'h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5 focus:outline-none focus:border-gold-500'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Abas<string> valor={periodo} onChange={setPeriodo} opcoes={PERIODOS.map((p) => ({ valor: p.valor, rotulo: `Últimos ${p.rotulo}` }))} />
        <Abas<Medida>
          valor={medida}
          onChange={setMedida}
          opcoes={[
            { valor: 'quantidade', rotulo: 'Quantidade' },
            { valor: 'valor', rotulo: 'Valor (R$)' },
          ]}
        />
        <label className="flex items-center gap-1.5 text-sm text-dark-300">
          Comparar
          <select value={a} onChange={(e) => setMesA(e.target.value)} className={classeCampo}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {nomeMes(m)}
              </option>
            ))}
          </select>
          com
          <select value={b} onChange={(e) => setMesB(e.target.value)} className={classeCampo}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {nomeMes(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mostrarResumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              titulo={`Total ${rotuloMes(b)}`}
              icone={Package}
              cor="#0ea5a4"
              valor={fmt(totalB)}
              detalhe={`${rotuloMes(a)}: ${fmt(totalA)}${totalA ? ` (${totalB >= totalA ? '+' : ''}${pct(((totalB - totalA) / totalA) * 100)})` : ''}`}
              destaque={totalB < totalA ? 'ruim' : totalB > totalA ? 'bom' : undefined}
            />
            <KpiCard titulo="Itens que caíram" icone={TrendingDown} cor="#e5534b" valor={numero(contar('caiu'))} detalhe={`Inclui os que pararam`} />
            <KpiCard titulo="Itens que pararam" icone={PackageX} cor="#f97316" valor={numero(contar('parou'))} detalhe={`Venderam em ${rotuloMes(a)} e nada em ${rotuloMes(b)}`} />
            <KpiCard titulo="Itens que subiram" icone={TrendingUp} cor="#22a861" valor={numero(contar('subiu') + contar('novo'))} detalhe={`Inclui ${numero(contar('novo'))} novo(s)`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Secao titulo={ehValor ? 'Valor vendido por mês' : 'Quantidade vendida por mês'} subtitulo="Todos os itens somados">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serieTotal} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-dark-700)" />
                    <XAxis dataKey="mes" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={eixoY} width={40} />
                    <Tooltip contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} formatter={(v) => [fmt(Number(v)), ehValor ? 'Valor' : 'Quantidade']} />
                    <Bar dataKey="valor" fill="#0ea5a4" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Secao>
            <Secao titulo="Maiores quedas" subtitulo={`${rotuloMes(a)} → ${rotuloMes(b)} — clique pra ver o gráfico do item`}>
              {maioresQuedas.length ? (
                <ul className="space-y-1.5">
                  {maioresQuedas.map((l) => (
                    <li key={l.chave}>
                      <button type="button" onClick={() => setAberto({ chave: l.chave, descricao: l.descricao, codigo: l.codigo })} className="w-full flex items-center justify-between gap-3 text-sm hover:bg-dark-700/60 rounded-lg px-2 py-1.5 text-left">
                        <span className="text-dark-100 truncate">{l.descricao}</span>
                        <span className="shrink-0 text-xs text-dark-400">
                          {fmt(l.va)} → {fmt(l.vb)} <span className="font-semibold text-red-500 ml-1">{l.variacaoPct !== null ? pct(l.variacaoPct * 100) : ''}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dark-400">Nenhum item caiu nesse período.</p>
              )}
            </Secao>
          </div>
        </>
      )}

      <Chips<Situacao>
        valor={situacao}
        onChange={setSituacao}
        opcoes={[
          { valor: 'caiu', rotulo: `Caíram (${contar('caiu')})`, cor: '#e5534b' },
          { valor: 'parou', rotulo: `Pararam (${contar('parou')})`, cor: '#f97316' },
          { valor: 'subiu', rotulo: `Subiram (${contar('subiu')})`, cor: '#22a861' },
          { valor: 'novo', rotulo: `Novos (${contar('novo')})`, cor: '#0ea5a4' },
        ]}
      />
      <TabelaDados
        id={`itens-sap-${meses.length}`}
        linhas={filtradas}
        colunas={colunas}
        chave={(l) => l.chave}
        buscaEm={(l) => `${l.codigo ?? ''} ${l.descricao}`}
        placeholderBusca="Buscar código ou nome do item..."
        nomeArquivo="itens-sap-por-mes.csv"
        ordemInicial={{ coluna: 'variacao', direcao: 'asc' }}
        simples={simples}
        carregando={isLoading}
        vazio="Nenhum item do SAP nesse período (a Odin Compressores ainda não puxa itens do SAP)."
      />
      <p className="text-xs text-dark-500">
        Itens das notas de venda do SAP (sem devoluções e sem notas canceladas). O cliente conta pro vendedor que tem ele na carteira hoje. Clique no nome do item pra ver o gráfico e quem comprou.
      </p>

      {aberto && <DetalheItem item={aberto} entrada={entrada} meses={meses} medida={medida} fmt={fmt} destaque={[a, b]} clientesBase={clientesBase} onClose={() => setAberto(null)} />}
    </div>
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
    const porCliente = new Map<number, { clienteId: number; razaoSocial: string; codigo: string | null; vendedorNome: string | null; meses: Record<string, number> }>()
    for (const l of data ?? []) {
      porMes.set(l.mes, (porMes.get(l.mes) ?? 0) + l[medida])
      const c = porCliente.get(l.clienteId) ?? { clienteId: l.clienteId, razaoSocial: l.razaoSocial, codigo: l.codigo, vendedorNome: l.vendedorNome, meses: {} }
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
    { id: 'cliente', rotulo: 'Cliente', quebrar: true, valor: (c) => c.razaoSocial, render: (c) => <Link to={`${clientesBase}/${c.clienteId}`} className="font-medium text-dark-50 hover:text-gold-400">{c.razaoSocial}</Link> },
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
