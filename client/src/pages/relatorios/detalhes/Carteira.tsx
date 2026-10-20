import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarClock, HeartHandshake, UserCheck, Users, Wallet, Target } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { formatarDataCurta } from '../../../components/relatorios/filtros'
import { Abas, BarraSegmentada, Chips, Etiqueta, KpiCard, Medidor, MiniNumero, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import { CATEGORIAS_ATIVIDADE, categoriaInfo, contarCategorias, ehAtivado } from '../../../components/relatorios/atividade'
import type { PropsDetalhe } from './tipos'

// ── Positivação de carteira ─────────────────────────────────────────────
export function Positivacao({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data: atividade, isLoading } = trpc.reports.atividadeCarteira.useQuery(f.periodo)
  const { data: posit } = trpc.reports.positivacaoCarteira.useQuery(f.periodo)
  const { data: positAnt } = trpc.reports.positivacaoCarteira.useQuery(f.anterior)
  const { data: porVendedor } = trpc.reports.positivacaoPorVendedor.useQuery(f.periodo, { enabled: !simples })
  const [categoria, setCategoria] = useState<string | null>(null)

  const clientes = atividade?.clientes ?? []
  const segmentos = useMemo(() => contarCategorias(clientes), [clientes])
  const ativados = clientes.filter((c) => ehAtivado(c.categoria)).length
  const compraram = clientes.filter((c) => c.ultimaCompra)
  const mediaDias = compraram.length ? compraram.reduce((s, c) => s + (c.diasSemComprar ?? 0), 0) / compraram.length : 0
  const ltv = compraram.length ? compraram.reduce((s, c) => s + c.valorTotal, 0) / compraram.length : 0

  const resumoVendedores = useMemo(() => {
    const mapa = new Map<number, { vendedorId: number; nome: string; carteira: number; cat: Record<string, number> }>()
    for (const c of clientes) {
      const v = mapa.get(c.vendedorId) ?? { vendedorId: c.vendedorId, nome: c.vendedorNome, carteira: 0, cat: {} }
      v.carteira++
      v.cat[c.categoria] = (v.cat[c.categoria] ?? 0) + 1
      mapa.set(c.vendedorId, v)
    }
    const positPorId = new Map((porVendedor ?? []).map((p) => [p.vendedorId, p]))
    return [...mapa.values()].map((v) => {
      const ativ = v.carteira - (v.cat.inativo ?? 0) - (v.cat.nunca ?? 0)
      const p = positPorId.get(v.vendedorId)
      return {
        ...v,
        taxaAtivacao: v.carteira ? (ativ / v.carteira) * 100 : 0,
        positivacao: p?.percentual ?? 0,
        positivados: p?.ativados ?? 0,
        contatosLigacao: p?.contatosLigacao ?? 0,
        contatosWhatsapp: p?.contatosWhatsapp ?? 0,
      }
    })
  }, [clientes, porVendedor])

  type Cli = (typeof clientes)[number]
  const colunas: Coluna<Cli>[] = [
    { id: 'cliente', rotulo: 'Cliente', valor: (c) => c.razaoSocial, render: (c) => <span className="font-medium text-dark-50">{c.razaoSocial}</span> },
    { id: 'codigo', rotulo: 'Código', valor: (c) => c.codigo, oculta: true },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (c: Cli) => c.vendedorNome }]),
    { id: 'cidade', rotulo: 'Cidade', valor: (c) => (c.cidade ? `${c.cidade}${c.estado ? '/' + c.estado : ''}` : null) },
    {
      id: 'categoria',
      rotulo: 'Situação',
      valor: (c) => categoriaInfo(c.categoria).rotulo,
      render: (c) => <Etiqueta cor={categoriaInfo(c.categoria).cor}>{categoriaInfo(c.categoria).rotulo}</Etiqueta>,
    },
    { id: 'ultima', rotulo: 'Última compra', valor: (c) => c.ultimaCompra?.slice(0, 10) ?? null, formato: 'data' },
    { id: 'dias', rotulo: 'Dias sem comprar', valor: (c) => c.diasSemComprar, formato: 'numero' },
    { id: 'comprasPeriodo', rotulo: 'Compras no período', valor: (c) => c.comprasNoPeriodo, formato: 'numero', somar: true },
    { id: 'valorPeriodo', rotulo: 'Valor no período', valor: (c) => c.valorNoPeriodo, formato: 'moeda', somar: true },
    { id: 'valorTotal', rotulo: 'Valor total (histórico)', valor: (c) => c.valorTotal, formato: 'moeda', oculta: simples, somar: true },
    { id: 'primeira', rotulo: 'Primeira compra', valor: (c) => c.primeiraCompra?.slice(0, 10) ?? null, formato: 'data', oculta: true },
  ]
  const filtrados = categoria ? clientes.filter((c) => c.categoria === categoria) : clientes

  type LinhaV = (typeof resumoVendedores)[number]
  const colunasVend: Coluna<LinhaV>[] = [
    { id: 'nome', rotulo: 'Vendedor', valor: (v) => v.nome, render: (v) => <span className="font-medium text-dark-50">{v.nome}</span> },
    { id: 'carteira', rotulo: 'Carteira', valor: (v) => v.carteira, formato: 'numero', somar: true },
    ...CATEGORIAS_ATIVIDADE.map((c) => ({
      id: c.chave,
      rotulo: c.rotulo,
      valor: (v: LinhaV) => v.cat[c.chave] ?? 0,
      formato: 'numero' as const,
      somar: true,
      oculta: c.chave === 'nunca',
    })),
    { id: 'taxa', rotulo: 'Taxa de ativação', valor: (v) => Math.round(v.taxaAtivacao * 10) / 10, formato: 'pct' },
    {
      id: 'positivacao',
      rotulo: 'Positivação no período',
      valor: (v) => v.positivacao,
      formato: 'pct',
      render: (v) => (
        <span className="inline-flex items-center gap-2 justify-end">
          <span className="w-16 h-1.5 rounded-full bg-dark-700 overflow-hidden">
            <span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, v.positivacao)}%` }} />
          </span>
          {pct(v.positivacao)}
        </span>
      ),
    },
    { id: 'lig', rotulo: 'Ligações', valor: (v) => v.contatosLigacao, formato: 'numero', oculta: true, somar: true },
    { id: 'wpp', rotulo: 'WhatsApp', valor: (v) => v.contatosWhatsapp, formato: 'numero', oculta: true, somar: true },
  ]

  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <Secao titulo={`Posição da carteira em ${formatarDataCurta(f.fim)}`} subtitulo="Carteira categorizada pela data da última compra — clique numa cor pra filtrar a lista">
          <div className="grid md:grid-cols-[220px_1fr] gap-8 items-center">
            <div>
              <p className="text-sm font-semibold text-dark-100">Taxa de ativação</p>
              <p className="text-xs text-dark-400 italic mb-2">% da carteira que não está inativa</p>
              <Medidor percentual={clientes.length ? (ativados / clientes.length) * 100 : 0} />
            </div>
            <div>
              <p className="text-sm font-semibold text-dark-100">Atividade da carteira</p>
              <p className="text-xs text-dark-400 italic mb-3">
                Ativo até 90 dias · quase inativo 91–180 · inativo +180 · novo = 1ª compra no período · recuperado = voltou depois de +180 dias
              </p>
              <BarraSegmentada segmentos={segmentos} selecionado={categoria} aoClicar={(k) => setCategoria(categoria === k ? null : k)} />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
            <MiniNumero icone={Users} cor="#3a86d6" valor={numero(clientes.length)} rotulo="Clientes na carteira" onClick={() => setCategoria(null)} />
            <MiniNumero icone={UserCheck} cor="#22a861" valor={numero(ativados)} rotulo="Clientes ativados" />
            <MiniNumero icone={Target} cor="#0ea5a4" valor={pct(posit?.percentual)} rotulo={`Positivação no período (${numero(posit?.ativados)})`} />
            <MiniNumero icone={CalendarClock} cor="#8b5cf6" valor={`${numero(Math.round(mediaDias))} dias`} rotulo="Tempo médio desde a última compra" />
            <MiniNumero icone={Wallet} cor="#22a861" valor={moeda(ltv)} rotulo="Valor médio por cliente (LTV)" />
          </div>
          <p className="text-xs text-dark-500 mt-3 flex items-center gap-1.5">
            <HeartHandshake size={13} /> Positivação {pct(posit?.percentual)} contra {pct(positAnt?.percentual)} no período anterior.
          </p>
        </Secao>
      )}

      {!simples && (
        <div>
          <h2 className="text-[15px] font-semibold text-dark-50 mb-2">Por vendedor</h2>
          <TabelaDados
            id="positivacao-vendedores"
            linhas={resumoVendedores}
            colunas={colunasVend}
            chave={(v) => v.vendedorId}
            buscaEm={(v) => v.nome}
            placeholderBusca="Buscar vendedor..."
            nomeArquivo="positivacao-por-vendedor.csv"
            ordemInicial={{ coluna: 'taxa', direcao: 'desc' }}
            porPaginaInicial={50}
            carregando={isLoading}
          />
        </div>
      )}

      <div>
        <h2 className="text-[15px] font-semibold text-dark-50 mb-2">Clientes</h2>
        <TabelaDados
          id="positivacao-clientes"
          linhas={filtrados}
          colunas={colunas}
          chave={(c) => c.clienteId}
          buscaEm={(c) => `${c.razaoSocial} ${c.codigo ?? ''} ${c.vendedorNome} ${c.cidade ?? ''}`}
          placeholderBusca={simples ? 'Buscar cliente ou cidade...' : 'Buscar cliente, vendedor ou cidade...'}
          nomeArquivo="atividade-da-carteira.csv"
          link={(c) => `${clientesBase}/${c.clienteId}`}
          ordemInicial={{ coluna: 'dias', direcao: 'asc' }}
          simples={simples}
          carregando={isLoading}
          barraExtra={
            <Chips
              valor={categoria}
              onChange={setCategoria}
              opcoes={CATEGORIAS_ATIVIDADE.map((c) => ({ valor: c.chave as string, rotulo: c.rotulo, cor: c.cor }))}
            />
          }
        />
      </div>
    </div>
  )
}

// ── Curva ABC ───────────────────────────────────────────────────────────
const COR_CLASSE: Record<string, string> = { A: '#22a861', B: '#f2a516', C: '#9aa5b1' }

export function CurvaAbc({ f, mostrarResumo, clientesBase }: PropsDetalhe) {
  const { data, isLoading } = trpc.reports.curvaAbc.useQuery(f.periodo)
  const [classe, setClasse] = useState<string | null>(null)
  const linhas = useMemo(() => {
    const total = (data ?? []).reduce((s, l) => s + (l.valorTotal ?? 0), 0)
    let acumulado = 0
    return (data ?? []).map((l, i) => {
      acumulado += l.valorTotal ?? 0
      return { ...l, posicao: i + 1, participacao: total ? ((l.valorTotal ?? 0) / total) * 100 : 0, acumulado: total ? (acumulado / total) * 100 : 0 }
    })
  }, [data])
  const resumo = (['A', 'B', 'C'] as const).map((k) => {
    const ls = linhas.filter((l) => l.classe === k)
    return { k, qtd: ls.length, valor: ls.reduce((s, l) => s + (l.valorTotal ?? 0), 0), share: ls.reduce((s, l) => s + l.participacao, 0) }
  })
  const top = linhas.slice(0, 12).map((l) => ({ ...l, nome: l.razaoSocial.length > 18 ? l.razaoSocial.slice(0, 17) + '…' : l.razaoSocial }))
  type L = (typeof linhas)[number]
  const colunas: Coluna<L>[] = [
    { id: 'pos', rotulo: '#', valor: (l) => l.posicao, formato: 'numero', largura: '60px' },
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    { id: 'vendedor', rotulo: 'Vendedor', valor: (l) => l.vendedorNome },
    { id: 'classe', rotulo: 'Classe', valor: (l) => l.classe, render: (l) => <Etiqueta cor={COR_CLASSE[l.classe]}>Classe {l.classe}</Etiqueta> },
    { id: 'valor', rotulo: 'Faturamento', valor: (l) => l.valorTotal, formato: 'moeda', somar: true },
    { id: 'part', rotulo: '% do total', valor: (l) => Math.round(l.participacao * 10) / 10, formato: 'pct' },
    { id: 'acum', rotulo: '% acumulado', valor: (l) => Math.round(l.acumulado * 10) / 10, formato: 'pct' },
  ]
  return (
    <div className="space-y-5">
      {mostrarResumo && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {resumo.map((r) => (
              <KpiCard
                key={r.k}
                titulo={`Classe ${r.k}`}
                valor={`${numero(r.qtd)} clientes`}
                detalhe={`${moeda(r.valor)} · ${pct(r.share)} do faturamento`}
                cor={COR_CLASSE[r.k]}
                icone={Users}
              />
            ))}
          </div>
          <Secao titulo="Os 12 clientes que mais faturaram" subtitulo="A = até 80% do faturamento acumulado · B = até 95% · C = o resto">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} margin={{ top: 5, right: 5, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                  <XAxis dataKey="nome" tick={{ fill: 'var(--color-dark-400)', fontSize: 10 }} angle={-30} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fill: 'var(--color-dark-400)', fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip formatter={(v) => moeda(Number(v))} contentStyle={{ background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="valorTotal" name="Faturamento" radius={[6, 6, 0, 0]}>
                    {top.map((l) => (
                      <Cell key={l.clienteId} fill={COR_CLASSE[l.classe]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Secao>
        </>
      )}
      <TabelaDados
        id="curva-abc"
        linhas={classe ? linhas.filter((l) => l.classe === classe) : linhas}
        colunas={colunas}
        chave={(l) => l.clienteId}
        buscaEm={(l) => `${l.razaoSocial} ${l.vendedorNome ?? ''}`}
        placeholderBusca="Buscar cliente ou vendedor..."
        nomeArquivo="curva-abc.csv"
        link={(l) => `${clientesBase}/${l.clienteId}`}
        ordemInicial={{ coluna: 'valor', direcao: 'desc' }}
        carregando={isLoading}
        barraExtra={<Chips valor={classe} onChange={setClasse} opcoes={(['A', 'B', 'C'] as const).map((k) => ({ valor: k as string, rotulo: `Classe ${k}`, cor: COR_CLASSE[k] }))} />}
      />
    </div>
  )
}

// ── Clientes parados ────────────────────────────────────────────────────
type Tipo = 'contato' | 'orcamento' | 'venda' | 'intocados'

export function ClientesParados({ f, simples, mostrarResumo, clientesBase }: PropsDetalhe) {
  const [params, setParams] = useSearchParams()
  const tipo = (params.get('tipo') as Tipo) || 'contato'
  const [dias, setDias] = useState<number>(tipo === 'venda' ? 60 : 30)
  const setTipo = (t: Tipo) => setParams({ tipo: t }, { replace: true })

  const { data: semContato, isLoading: c1 } = trpc.reports.diasSemContato.useQuery({ ...f.filtroAtual, minimoDias: dias }, { enabled: tipo === 'contato' })
  const { data: semOrc, isLoading: c2 } = trpc.reports.clientesSemOrcamentoDias.useQuery({ ...f.filtroAtual, minimoDias: dias }, { enabled: tipo === 'orcamento' })
  const { data: semVenda, isLoading: c3 } = trpc.reports.clientesSemVendaDias.useQuery({ ...f.filtroAtual, minimoDias: dias }, { enabled: tipo === 'venda' })
  const { data: intocados, isLoading: c4 } = trpc.reports.clientesSemOrcamentoEContato.useQuery(f.filtroAtual, { enabled: tipo === 'intocados' })

  type Linha = { clienteId: number; razaoSocial: string; codigo?: string | null; vendedorNome: string; dias: number | null; ultima: string | null; extra?: string }
  const { linhas, total, carregando } = useMemo((): { linhas: Linha[]; total: number | undefined; carregando: boolean } => {
    if (tipo === 'contato')
      return { linhas: (semContato?.itens ?? []).map((c) => ({ ...c, ultima: null })), total: semContato?.totalCarteira, carregando: c1 }
    if (tipo === 'orcamento')
      return { linhas: (semOrc?.itens ?? []).map((c) => ({ ...c, dias: c.diasSemOrcamento, ultima: c.ultimoOrcamentoEm })), total: semOrc?.totalCarteira, carregando: c2 }
    if (tipo === 'venda')
      return {
        linhas: (semVenda?.itens ?? []).map((c) => ({ ...c, dias: c.diasSemVenda, ultima: c.ultimaCompraEm, extra: c.origemUltimaCompra === 'sap' ? 'SAP' : c.origemUltimaCompra === 'crm' ? 'CRM' : undefined })),
        total: semVenda?.totalCarteira,
        carregando: c3,
      }
    return { linhas: (intocados ?? []).map((c) => ({ ...c, dias: null, ultima: null, extra: c.etapa })), total: undefined, carregando: c4 }
  }, [tipo, semContato, semOrc, semVenda, intocados, c1, c2, c3, c4])

  const nunca = linhas.filter((l) => l.dias === null).length
  const rotuloNunca = tipo === 'contato' ? 'Nunca contatado' : tipo === 'orcamento' ? 'Nunca orçou' : 'Nunca comprou'

  const colunas: Coluna<Linha>[] = [
    { id: 'cliente', rotulo: 'Cliente', valor: (l) => l.razaoSocial, render: (l) => <span className="font-medium text-dark-50">{l.razaoSocial}</span> },
    { id: 'codigo', rotulo: 'Código', valor: (l) => l.codigo ?? null, oculta: true },
    ...(simples ? [] : [{ id: 'vendedor', rotulo: 'Vendedor', valor: (l: Linha) => l.vendedorNome }]),
    ...(tipo === 'intocados'
      ? [{ id: 'etapa', rotulo: 'Etapa no Kanban', valor: (l: Linha) => l.extra ?? null }]
      : [
          {
            id: 'dias',
            rotulo: 'Dias parado',
            valor: (l: Linha) => l.dias,
            formato: 'numero' as const,
            render: (l: Linha) =>
              l.dias === null ? (
                <Etiqueta cor="#e5534b">{rotuloNunca}</Etiqueta>
              ) : (
                <span className={`font-semibold ${l.dias >= 90 ? 'text-red-500' : l.dias >= 60 ? 'text-orange-500' : 'text-amber-500'}`}>{numero(l.dias)} dias</span>
              ),
          },
          ...(tipo !== 'contato' ? [{ id: 'ultima', rotulo: tipo === 'venda' ? 'Última compra' : 'Último orçamento', valor: (l: Linha) => l.ultima?.slice(0, 10) ?? null, formato: 'data' as const }] : []),
          ...(tipo === 'venda' ? [{ id: 'origem', rotulo: 'Origem', valor: (l: Linha) => l.extra ?? null, oculta: true }] : []),
        ]),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Abas<Tipo>
          valor={tipo}
          onChange={setTipo}
          opcoes={[
            { valor: 'contato', rotulo: 'Sem contato' },
            { valor: 'orcamento', rotulo: 'Sem orçamento' },
            { valor: 'venda', rotulo: 'Sem comprar' },
            { valor: 'intocados', rotulo: 'Intocados no mês' },
          ]}
        />
        {tipo !== 'intocados' && (
          <Chips<number>
            valor={dias}
            onChange={(v) => v && setDias(v)}
            opcoes={[30, 60, 90, 180].map((d) => ({ valor: d, rotulo: `${d}+ dias` }))}
          />
        )}
      </div>
      {mostrarResumo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            titulo={tipo === 'intocados' ? 'Sem contato e sem orçamento neste mês' : `Clientes parados há ${dias}+ dias`}
            valor={numero(linhas.length)}
            destaque={linhas.length ? 'ruim' : 'bom'}
            detalhe={total !== undefined ? `de ${numero(total)} na carteira (${pct(total ? (linhas.length / total) * 100 : 0)})` : 'cards do mês sem nenhuma tentativa nem valor orçado'}
          />
          {tipo !== 'intocados' && <KpiCard titulo={rotuloNunca} valor={numero(nunca)} detalhe="nenhum registro na história do cliente" />}
          {tipo !== 'intocados' && (
            <KpiCard titulo="Com histórico, mas parados" valor={numero(linhas.length - nunca)} detalhe={`já tiveram ${tipo === 'contato' ? 'contato' : tipo === 'orcamento' ? 'orçamento' : 'compra'}, e pararam`} />
          )}
        </div>
      )}
      <TabelaDados
        id={`parados-${tipo}`}
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.clienteId}
        buscaEm={(l) => `${l.razaoSocial} ${l.codigo ?? ''} ${l.vendedorNome}`}
        placeholderBusca={simples ? 'Buscar cliente...' : 'Buscar cliente ou vendedor...'}
        nomeArquivo={`clientes-parados-${tipo}.csv`}
        link={(l) => `${clientesBase}/${l.clienteId}`}
        ordemInicial={tipo === 'intocados' ? undefined : { coluna: 'dias', direcao: 'desc' }}
        simples={simples}
        carregando={carregando}
        vazio="Nenhum cliente nessa situação. 👏"
      />
    </div>
  )
}
