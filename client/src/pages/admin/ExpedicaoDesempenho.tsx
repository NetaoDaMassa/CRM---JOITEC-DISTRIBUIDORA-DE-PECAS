import { Fragment, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import { ehErroDeEmbalagem, labelTipoErro, TIPOS_ERRO } from '../../lib/expedicaoErros'

// Desempenho do estoque (pedido do João, 2026-10-29) — substitui o "Painel
// Diário" e o "Painel Mensal" da planilha "Análise de Desempenho Estoque":
// mesma conta (pedidos, peças, erros, volumes, cabeçotes, paletes; erros ÷
// pedidos ≤ limite = elegível à bonificação), só que sai sozinha das
// anotações da tela Expedição.

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}
const CARGO: Record<string, string> = { separador: 'Separador', conferente: 'Conferente', embalador: 'Embalador', expedicao: 'Expedição', geral: 'Faz tudo' }
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (n: number) => n.toLocaleString('pt-BR')

export default function ExpedicaoDesempenho() {
  const hoje = hojeBr()
  const [de, setDe] = useState(`${hoje.slice(0, 8)}01`)
  const [ate, setAte] = useState(hoje)
  const [aba, setAba] = useState<'desempenho' | 'abc'>(() => {
    try {
      return localStorage.getItem('expedicao-desempenho-aba') === 'abc' ? 'abc' : 'desempenho'
    } catch {
      return 'desempenho'
    }
  })
  const trocarAba = (a: 'desempenho' | 'abc') => {
    setAba(a)
    try {
      localStorage.setItem('expedicao-desempenho-aba', a)
    } catch {
      /* sem storage */
    }
  }
  const { data, isLoading } = trpc.expedicao.desempenho.useQuery({ de, ate }, { enabled: aba === 'desempenho' })
  const atalho = (d: string, a: string) => (setDe(d), setAte(a))
  const mesPassado = (() => {
    const d = new Date(`${hoje.slice(0, 8)}01T12:00:00Z`)
    d.setUTCDate(0)
    const fim = d.toISOString().slice(0, 10)
    return { de: `${fim.slice(0, 8)}01`, ate: fim }
  })()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
            <BarChart3 size={20} className="text-teal-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Desempenho do estoque</h1>
            <p className="text-sm text-dark-400">Produção, erros e bonificação de cada pessoa, calculados sozinhos</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {[
            { l: 'Hoje', d: hoje, a: hoje },
            { l: 'Este mês', d: `${hoje.slice(0, 8)}01`, a: hoje },
            { l: 'Mês passado', d: mesPassado.de, a: mesPassado.ate },
          ].map((x) => (
            <button
              key={x.l}
              type="button"
              onClick={() => atalho(x.d, x.a)}
              className={`text-sm rounded-lg px-3 py-2 border ${de === x.d && ate === x.a ? 'border-gold-600 text-gold-300' : 'border-dark-600 text-dark-300 hover:bg-dark-800'}`}
            >
              {x.l}
            </button>
          ))}
          <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {([
          { v: 'desempenho', l: 'Desempenho' },
          { v: 'abc', l: 'Curva ABC de erros' },
        ] as const).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => trocarAba(t.v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === t.v ? 'border-gold-500 text-gold-300' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {aba === 'abc' ? (
        <CurvaAbcErros de={de} ate={ate} />
      ) : (
      <>
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi titulo="Pedidos coletados" valor={num(data.coletados)} />
          <Kpi titulo="No prazo (48h úteis)" valor={data.coletados ? pct(data.noPrazo / data.coletados) : '—'} sub={`${data.noPrazo} de ${data.coletados}`} />
          <Kpi titulo="Tempo médio picking → coleta" valor={data.horasMediasAteColeta != null ? `${data.horasMediasAteColeta.toLocaleString('pt-BR')}h` : '—'} />
          <Kpi titulo="Erros anotados" valor={num(data.erros)} />
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 overflow-x-auto">
        {isLoading || !data ? (
          <div className="h-40 animate-pulse" />
        ) : data.linhas.length === 0 ? (
          <p className="text-sm text-dark-400">Ninguém cadastrado na equipe ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Bonificação</th>
                <th className="py-2 pr-3 font-medium">Colaborador</th>
                <th className="py-2 pr-3 font-medium">Cargo</th>
                <th className="py-2 pr-3 font-medium text-right">Pedidos</th>
                <th className="py-2 pr-3 font-medium text-right">Peças</th>
                <th className="py-2 pr-3 font-medium text-right">Erros</th>
                <th className="py-2 pr-3 font-medium text-right">Taxa de erro</th>
                <th className="py-2 pr-3 font-medium text-right">Limite</th>
                <th className="py-2 pr-3 font-medium text-right">Volumes</th>
                <th className="py-2 pr-3 font-medium text-right">Cabeçotes</th>
                <th className="py-2 pr-3 font-medium text-right">Paletes</th>
                <th className="py-2 font-medium text-right">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {data.linhas.map((l) => (
                <tr key={l.id} className="border-t border-dark-700/70">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {l.status === 'elegivel' && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-green-900/30 text-green-300">Elegível</span>}
                    {l.status === 'nao_elegivel' && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-red-900/30 text-red-300">Não elegível</span>}
                    {l.status === 'sem_producao' && <span className="text-xs text-dark-500">Sem produção</span>}
                  </td>
                  <td className="py-2 pr-3 text-dark-100 font-medium">{l.nome}</td>
                  <td className="py-2 pr-3 text-dark-300">{CARGO[l.cargo]}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.pedidos)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.pecas)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{num(l.erros)}</td>
                  <td className={`py-2 pr-3 text-right font-mono ${l.pedidos && l.taxaErro > l.limiteErro ? 'text-red-300' : ''}`}>{l.pedidos ? pct(l.taxaErro) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-dark-400">{pct(l.limiteErro)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.volumes) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.cabecotes) : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono">{l.cargo === 'embalador' || l.cargo === 'geral' ? num(l.paletes) : '—'}</td>
                  <td className="py-2 text-right font-mono text-dark-300">{l.minutosPorPedido != null ? `${l.minutosPorPedido} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-dark-500 mt-3">
          Erro achado na conferência conta para o separador; na embalagem, para o conferente; na expedição — inclusive depois da coleta (volume que ficou, transporte errado, não despachou) — para o embalador. Elegível = erros ÷ pedidos até o limite da pessoa.
        </p>
      </div>

      <ErrosDoPeriodo de={de} ate={ate} />

      <VendedoresProblemas de={de} ate={ate} />
      </>
      )}
    </div>
  )
}

const ETAPA_ERRO: Record<string, string> = { conferencia: 'Conferência', embalagem: 'Embalagem', expedicao: 'Expedição' }

// Erros do período, um por linha, com pra quem contou — o "placar" que
// entra na bonificação. Filtro rápido só embalagem/despacho.
function ErrosDoPeriodo({ de, ate }: { de: string; ate: string }) {
  const { data, isLoading } = trpc.expedicao.errosPeriodo.useQuery({ de, ate })
  const [soEmbalagem, setSoEmbalagem] = useState(false)
  const dataHora = (utc: string) => new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const lista = (data ?? []).filter((e) => !soEmbalagem || ehErroDeEmbalagem(e.tipo))
  const porPessoa = new Map<string, number>()
  for (const e of lista) porPessoa.set(e.responsavelNome ?? '—', (porPessoa.get(e.responsavelNome ?? '—') ?? 0) + 1)
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-dark-100">Erros anotados no período</h2>
          <p className="text-xs text-dark-400">Cada erro conta 1 na taxa de erro de quem aparece em "Conta para". Para corrigir, abra o pedido na Expedição e apague o erro.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" className="accent-gold-500" checked={soEmbalagem} onChange={(e) => setSoEmbalagem(e.target.checked)} />
          Só embalagem e despacho
        </label>
      </div>
      {porPessoa.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...porPessoa].sort((a, b) => b[1] - a[1]).map(([nome, n]) => (
            <span key={nome} className="rounded-lg bg-red-900/20 border border-red-800/40 px-2.5 py-1 text-xs text-red-200">
              {nome}: <b>{n}</b>
            </span>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="h-24 animate-pulse" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-dark-400">Nenhum erro anotado neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Quando</th>
                <th className="py-2 pr-3 font-medium">Pedido</th>
                <th className="py-2 pr-3 font-medium">Tipo</th>
                <th className="py-2 pr-3 font-medium">Onde achou</th>
                <th className="py-2 pr-3 font-medium">Conta para</th>
                <th className="py-2 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-t border-dark-700/70">
                  <td className="py-2 pr-3 text-dark-300 whitespace-nowrap">{dataHora(e.createdAt)}</td>
                  <td className="py-2 pr-3 text-dark-100">
                    {e.pedidosSap}
                    {e.nfNumero ? <span className="text-dark-500"> · NF {e.nfNumero}</span> : null}
                    <span className="block text-xs text-dark-500 truncate max-w-[220px]">{e.clienteNome ?? ''}</span>
                  </td>
                  <td className={`py-2 pr-3 font-medium ${ehErroDeEmbalagem(e.tipo) ? 'text-orange-300' : 'text-red-300'}`}>{labelTipoErro(e.tipo)}</td>
                  <td className="py-2 pr-3 text-dark-300">{ETAPA_ERRO[e.etapa] ?? e.etapa}</td>
                  <td className="py-2 pr-3 text-dark-100">{e.responsavelNome ?? '—'}</td>
                  <td className="py-2 text-dark-300">
                    {[e.itemCodigo, e.descricao, e.quantidade ? `${e.quantidade} ${e.tipo === 'volume_ficou' ? 'vol.' : 'un'}` : null, e.observacao].filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const ROTULO_OCORRENCIA = { picking: 'Voltou picking', falta_item: 'Falta de item', troca_item: 'Troca de item' } as const

// Vendedores que mais voltam picking ou têm pedido travado por falta de item
// ou troca (ver server/src/lib/expedicaoVendedores.ts).
function VendedoresProblemas({ de, ate }: { de: string; ate: string }) {
  const { data, isLoading, error } = trpc.expedicao.vendedoresProblemas.useQuery({ de, ate })
  const [aberto, setAberto] = useState<string | null>(null)
  const dataHora = (utc: string) => new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-dark-100">Vendedores: picking que volta e pedido travado</h2>
        <p className="text-xs text-dark-400">
          {data ? `${num(data.voltouPicking)} picking(s) voltaram · ${num(data.faltaItem)} travado(s) por falta de item · ${num(data.trocaItem)} por troca de item. ` : ''}Clique no vendedor para ver os pedidos.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-red-300">{error.message}</p>
      ) : isLoading || !data ? (
        <div className="h-32 animate-pulse" />
      ) : data.linhas.length === 0 ? (
        <p className="text-sm text-dark-400">Nenhum pedido neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 text-left">
                <th className="py-2 pr-3 font-medium">Vendedor</th>
                <th className="py-2 pr-3 font-medium text-right">Pedidos</th>
                <th className="py-2 pr-3 font-medium text-right">Voltou picking</th>
                <th className="py-2 pr-3 font-medium text-right">Falta de item</th>
                <th className="py-2 pr-3 font-medium text-right">Troca de item</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 font-medium text-right">% dos pedidos</th>
              </tr>
            </thead>
            <tbody>
              {data.linhas.map((l) => (
                <Fragment key={l.vendedor}>
                  <tr className={`border-t border-dark-700/70 ${l.total ? 'cursor-pointer hover:bg-dark-700/40' : ''}`} onClick={() => l.total && setAberto(aberto === l.vendedor ? null : l.vendedor)}>
                    <td className="py-2 pr-3 text-dark-100 font-medium">
                      {l.total > 0 && <span className="text-dark-500 mr-1">{aberto === l.vendedor ? '▾' : '▸'}</span>}
                      {l.vendedor}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{num(l.pedidos)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{num(l.voltouPicking)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{num(l.faltaItem)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{num(l.trocaItem)}</td>
                    <td className={`py-2 pr-3 text-right font-mono font-semibold ${l.total ? 'text-red-300' : 'text-dark-500'}`}>{num(l.total)}</td>
                    <td className="py-2 text-right font-mono text-dark-300">{l.pedidos ? pct(l.pedidosAfetados / l.pedidos) : '—'}</td>
                  </tr>
                  {aberto === l.vendedor &&
                    l.ocorrencias.map((o) => (
                      <tr key={`${o.tipo}-${o.expedicaoId}-${o.data}`} className="bg-dark-900/40 text-xs">
                        <td colSpan={7} className="py-2 px-3 text-dark-300">
                          <b className="text-dark-100">{ROTULO_OCORRENCIA[o.tipo]}</b> · Pedido {o.pedido} · {o.cliente ?? '—'} · {dataHora(o.data)} · {o.detalhe}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-dark-500">
        Voltou picking = o SAP gerou um picking novo para o mesmo pedido. Travado = o estoque pausou o pedido marcando falta ou troca de item; o motivo é registrado assim desde esta versão. % dos pedidos = pedidos com algum desses problemas.
      </p>
    </div>
  )
}

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <p className="text-xs text-dark-400">{titulo}</p>
      <p className="text-2xl font-bold font-mono text-dark-50 mt-1">{valor}</p>
      {sub && <p className="text-xs text-dark-500">{sub}</p>}
    </div>
  )
}

// Curva ABC dos erros (João, 2026-11-11: "queremos identificar qual tipo de
// erro e quais itens eles mais têm errado pra tomarmos as medidas"). Mesmos
// erros do "Erros anotados no período", agrupados por item, do que mais erra
// pro que menos. Classe A = itens que somam até 80% dos erros, B até 95%,
// C o resto. Filtros: período (o de cima), pessoa e tipo de erro.
const CLASSE_COR = { A: 'bg-red-900/30 text-red-300 border-red-800/50', B: 'bg-amber-900/30 text-amber-300 border-amber-800/50', C: 'bg-dark-700 text-dark-300 border-dark-600' } as const

function CurvaAbcErros({ de, ate }: { de: string; ate: string }) {
  const { data, isLoading } = trpc.expedicao.errosPeriodo.useQuery({ de, ate })
  const [pessoa, setPessoa] = useState('')
  const [tipos, setTipos] = useState<string[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const dataHora = (utc: string) => new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const todos = data ?? []
  const pessoas = [...new Map(todos.map((e) => [String(e.responsavelId ?? ''), e.responsavelNome ?? 'Sem responsável'])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const porPessoa = todos.filter((e) => !pessoa || String(e.responsavelId ?? '') === pessoa)
  const lista = porPessoa.filter((e) => !tipos.length || tipos.includes(e.tipo))

  // Contagem por tipo (respeita a pessoa, não o filtro de tipo — pra ver todos os tipos e escolher)
  const contTipo = new Map<string, number>()
  for (const e of porPessoa) contTipo.set(e.tipo, (contTipo.get(e.tipo) ?? 0) + 1)
  const tiposOrdenados = [...contTipo].sort((a, b) => b[1] - a[1])
  const maxTipo = tiposOrdenados[0]?.[1] ?? 0

  // Agrupa por item
  type Grupo = { chave: string; codigo: string | null; descricao: string; erros: typeof lista; tipos: Map<string, number>; pessoas: Map<string, number> }
  const grupos = new Map<string, Grupo>()
  let semItem = 0
  for (const e of lista) {
    const codigo = e.itemCodigo?.trim() || null
    if (!codigo && !e.descricao?.trim()) {
      semItem++
      continue
    }
    const chave = codigo ? codigo.toUpperCase() : `desc:${e.descricao!.trim().toUpperCase()}`
    let g = grupos.get(chave)
    if (!g) grupos.set(chave, (g = { chave, codigo, descricao: e.descricao?.trim() || '', erros: [], tipos: new Map(), pessoas: new Map() }))
    if (!g.descricao && e.descricao) g.descricao = e.descricao.trim()
    g.erros.push(e)
    g.tipos.set(e.tipo, (g.tipos.get(e.tipo) ?? 0) + 1)
    const nome = e.responsavelNome ?? 'Sem responsável'
    g.pessoas.set(nome, (g.pessoas.get(nome) ?? 0) + 1)
  }
  const ordenados = [...grupos.values()].sort((a, b) => b.erros.length - a.erros.length || (a.codigo ?? '').localeCompare(b.codigo ?? ''))
  const totalItens = ordenados.reduce((s, g) => s + g.erros.length, 0)
  let acumulado = 0
  const linhas = ordenados.map((g) => {
    const antes = acumulado
    acumulado += g.erros.length
    const pctAcum = totalItens ? acumulado / totalItens : 0
    // Classe pelo acumulado ANTES do item: o item que cruza 80% ainda é A
    const classe: 'A' | 'B' | 'C' = totalItens && antes / totalItens < 0.8 ? 'A' : totalItens && antes / totalItens < 0.95 ? 'B' : 'C'
    return { ...g, pct: totalItens ? g.erros.length / totalItens : 0, pctAcum, classe }
  })
  const resumo = (['A', 'B', 'C'] as const).map((c) => {
    const ls = linhas.filter((l) => l.classe === c)
    return { c, itens: ls.length, erros: ls.reduce((s, l) => s + l.erros.length, 0) }
  })
  const alternarTipo = (t: string) => setTipos((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))

  return (
    <div className="space-y-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-dark-100">Tipos de erro</h2>
            <p className="text-xs text-dark-400">Do que mais acontece para o que menos. Clique para filtrar a curva (pode marcar vários).</p>
          </div>
          <label className="text-sm text-dark-300 flex flex-col gap-1">
            <span className="text-xs text-dark-400">Pessoa (conta para)</span>
            <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 min-w-[200px]">
              <option value="">Todas</option>
              {pessoas.map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isLoading ? (
          <div className="h-24 animate-pulse" />
        ) : tiposOrdenados.length === 0 ? (
          <p className="text-sm text-dark-400">Nenhum erro anotado neste período.</p>
        ) : (
          <div className="space-y-1.5">
            {tiposOrdenados.map(([t, n]) => {
              const ativo = tipos.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => alternarTipo(t)}
                  className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm border ${ativo ? 'border-gold-600 bg-gold-900/10' : 'border-transparent hover:bg-dark-700/50'}`}
                >
                  <span className={`w-56 shrink-0 truncate ${ehErroDeEmbalagem(t) ? 'text-orange-300' : 'text-red-300'}`}>{labelTipoErro(t)}</span>
                  <span className="flex-1 h-3 rounded bg-dark-900 overflow-hidden">
                    <span className={`block h-full ${ehErroDeEmbalagem(t) ? 'bg-orange-500/70' : 'bg-red-500/70'}`} style={{ width: `${maxTipo ? (n / maxTipo) * 100 : 0}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-dark-200">
                    {num(n)} <span className="text-dark-500 text-xs">{pct(porPessoa.length ? n / porPessoa.length : 0)}</span>
                  </span>
                </button>
              )
            })}
            {tipos.length > 0 && (
              <button type="button" onClick={() => setTipos([])} className="text-xs text-gold-300 hover:underline">
                Limpar filtro de tipo ({tipos.map(labelTipoErro).join(', ')})
              </button>
            )}
          </div>
        )}
        {TIPOS_ERRO.length > tiposOrdenados.length && tiposOrdenados.length > 0 && (
          <p className="text-xs text-dark-500">Tipos sem nenhum erro no período não aparecem.</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {resumo.map((r) => (
          <div key={r.c} className={`rounded-2xl border p-3 ${CLASSE_COR[r.c]}`}>
            <p className="text-xs opacity-80">Classe {r.c} {r.c === 'A' ? '(até 80% dos erros)' : r.c === 'B' ? '(80% a 95%)' : '(últimos 5%)'}</p>
            <p className="text-xl font-bold font-mono mt-1">{num(r.itens)} {r.itens === 1 ? 'item' : 'itens'}</p>
            <p className="text-xs opacity-80">{num(r.erros)} erro(s)</p>
          </div>
        ))}
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-dark-100">Curva ABC — itens que mais erram</h2>
          <p className="text-xs text-dark-400">
            {num(totalItens)} erro(s) em {num(linhas.length)} item(ns){semItem ? ` · ${num(semItem)} erro(s) sem item informado (ex.: volume ficou, transporte errado) ficam fora da curva` : ''}. Clique no item para ver cada erro.
          </p>
        </div>
        {isLoading ? (
          <div className="h-40 animate-pulse" />
        ) : linhas.length === 0 ? (
          <p className="text-sm text-dark-400">Nenhum erro com item neste filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-xs text-dark-400 text-left">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Classe</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium text-right">Erros</th>
                  <th className="py-2 pr-3 font-medium text-right">% </th>
                  <th className="py-2 pr-3 font-medium text-right">% acumulado</th>
                  <th className="py-2 pr-3 font-medium">Tipos</th>
                  <th className="py-2 font-medium">Quem errou</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <Fragment key={l.chave}>
                    <tr className="border-t border-dark-700/70 cursor-pointer hover:bg-dark-700/40 align-top" onClick={() => setAberto(aberto === l.chave ? null : l.chave)}>
                      <td className="py-2 pr-3 text-dark-500 font-mono">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <span className={`text-xs font-bold rounded-full border px-2 py-0.5 ${CLASSE_COR[l.classe]}`}>{l.classe}</span>
                      </td>
                      <td className="py-2 pr-3 text-dark-100">
                        <span className="text-dark-500 mr-1">{aberto === l.chave ? '▾' : '▸'}</span>
                        {l.codigo && <span className="font-mono">{l.codigo}</span>}
                        <span className="block text-xs text-dark-400 truncate max-w-[280px]">{l.descricao}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-red-300">{num(l.erros.length)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-dark-300">{pct(l.pct)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-dark-300">{pct(l.pctAcum)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {[...l.tipos].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                            <span key={t} className={`text-xs rounded px-1.5 py-0.5 bg-dark-900 ${ehErroDeEmbalagem(t) ? 'text-orange-300' : 'text-red-300'}`}>
                              {labelTipoErro(t)}: {n}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-xs text-dark-300">
                        {[...l.pessoas].sort((a, b) => b[1] - a[1]).map(([n, q]) => `${n} (${q})`).join(', ')}
                      </td>
                    </tr>
                    {aberto === l.chave &&
                      l.erros.map((e) => (
                        <tr key={e.id} className="bg-dark-900/40 text-xs">
                          <td colSpan={8} className="py-1.5 px-3 text-dark-300">
                            {dataHora(e.createdAt)} · Pedido {e.pedidosSap}
                            {e.nfNumero ? ` · NF ${e.nfNumero}` : ''} · {e.clienteNome ?? '—'} · <b className="text-dark-100">{labelTipoErro(e.tipo)}</b>
                            {e.quantidade ? ` · ${e.quantidade} un` : ''} · achado na {ETAPA_ERRO[e.etapa] ?? e.etapa} · conta para {e.responsavelNome ?? '—'}
                            {e.observacao ? ` · ${e.observacao}` : ''}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
