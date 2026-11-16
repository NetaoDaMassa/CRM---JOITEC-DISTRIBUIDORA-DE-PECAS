import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { formatarMoeda } from '../../lib/moeda'
import { paraCsv, baixarCsv } from '../../lib/csv'

// Relatórios de Cotações (João, 2026-11-16: "deixar prontos relatórios, e
// filtros ali, por vendedor e etc"). Tudo calculado das mesmas cotações da
// lista, já com os filtros da tela (vendedor, período, cadastro, busca).
// Clicar numa linha filtra a lista com aquilo.

export type CadastroSituacao = 'com' | 'pendente' | 'aguardando' | 'convertido'
export type LinhaRelatorio = {
  id: number
  status: string
  total: number
  vendedorId: number
  vendedorNome: string
  clienteId: number
  clienteNome: string
  clienteDoc: string | null
  diaBr: string
  sapPedidoNum: number | null
  motivoPerda: string | null
  vencida: boolean
  cadastro: CadastroSituacao
  vencidaSemCadastro: boolean
}
export type FiltroRelatorio = { vendedorId?: number; cadastro?: string; mes?: string; status?: string }

const ABERTAS = ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const dataBr = (d: string) => d.split('-').reverse().join('/')
const num2 = (n: number) => n.toFixed(2).replace('.', ',')

type Metricas = {
  qtd: number
  valor: number
  abertas: number
  ganhas: number
  valorGanho: number
  pedidos: number
  perdidas: number
  semCadastro: number
}
function metricas(l: LinhaRelatorio[]): Metricas {
  const m: Metricas = { qtd: 0, valor: 0, abertas: 0, ganhas: 0, valorGanho: 0, pedidos: 0, perdidas: 0, semCadastro: 0 }
  for (const c of l) {
    m.qtd++
    m.valor += c.total
    if (ABERTAS.includes(c.status)) m.abertas++
    if (c.status === 'ganha') {
      m.ganhas++
      m.valorGanho += c.total
    }
    if (c.sapPedidoNum) m.pedidos++
    if (c.status === 'perdida') m.perdidas++
    if (c.cadastro !== 'com') m.semCadastro++
  }
  return m
}
// Conversão = cliente aprovou ÷ (aprovou + perdeu), igual ao card "Conversão no mês".
const conversao = (m: Metricas) => pct(m.ganhas, m.ganhas + m.perdidas)
const ticket = (m: Metricas) => (m.ganhas ? m.valorGanho / m.ganhas : 0)

const COLS_METRICAS = [
  { chave: 'qtd', rotulo: 'Cotações' },
  { chave: 'valor', rotulo: 'Valor cotado (R$)' },
  { chave: 'abertas', rotulo: 'Em aberto' },
  { chave: 'ganhas', rotulo: 'Cliente aprovou' },
  { chave: 'valorGanho', rotulo: 'Valor aprovado (R$)' },
  { chave: 'pedidos', rotulo: 'Viraram pedido SAP' },
  { chave: 'perdidas', rotulo: 'Perdidas' },
  { chave: 'conversao', rotulo: 'Conversão' },
  { chave: 'ticket', rotulo: 'Ticket médio aprovado (R$)' },
  { chave: 'semCadastro', rotulo: 'Sem cadastro' },
] as const
const paraLinhaCsv = (rotulo: string, m: Metricas) => ({
  nome: rotulo,
  qtd: m.qtd,
  valor: num2(m.valor),
  abertas: m.abertas,
  ganhas: m.ganhas,
  valorGanho: num2(m.valorGanho),
  pedidos: m.pedidos,
  perdidas: m.perdidas,
  conversao: conversao(m),
  ticket: num2(ticket(m)),
  semCadastro: m.semCadastro,
})
function exportar(arquivo: string, primeira: string, linhas: { rotulo: string; m: Metricas }[]) {
  const colunas = [{ chave: 'nome' as const, rotulo: primeira }, ...COLS_METRICAS.map((c) => ({ chave: c.chave, rotulo: c.rotulo }))]
  baixarCsv(arquivo, paraCsv(colunas, linhas.map((l) => paraLinhaCsv(l.rotulo, l.m))))
}

function BotaoCsv({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-lg border border-dark-600 px-2.5 py-1 text-xs font-semibold text-dark-200 hover:bg-dark-700">
      <Download className="h-3.5 w-3.5" /> Excel (CSV)
    </button>
  )
}

function Secao({ titulo, sub, onCsv, children }: { titulo: string; sub?: string; onCsv?: () => void; children: React.ReactNode }) {
  return (
    <section className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-dark-700">
        <div>
          <h3 className="text-sm font-bold text-dark-50">{titulo}</h3>
          {sub && <p className="text-[11px] text-dark-400">{sub}</p>}
        </div>
        {onCsv && <BotaoCsv onClick={onCsv} />}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function TabelaMetricas({ primeira, linhas, onClicar }: { primeira: string; linhas: { chave: string; rotulo: string; m: Metricas; filtro?: FiltroRelatorio }[]; onClicar: (f: FiltroRelatorio) => void }) {
  const tot = metricas([]) as Metricas
  for (const l of linhas) for (const k of Object.keys(tot) as (keyof Metricas)[]) tot[k] += l.m[k]
  const celulas = (m: Metricas) => [
    String(m.qtd),
    formatarMoeda(m.valor),
    String(m.abertas),
    String(m.ganhas),
    formatarMoeda(m.valorGanho),
    String(m.pedidos),
    String(m.perdidas),
    conversao(m),
    m.ganhas ? formatarMoeda(ticket(m)) : '—',
    String(m.semCadastro),
  ]
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-dark-400">
          <th className="px-4 py-2 font-semibold">{primeira}</th>
          {COLS_METRICAS.map((c) => (
            <th key={c.chave} className="px-3 py-2 font-semibold text-right whitespace-nowrap">
              {c.rotulo.replace(' (R$)', '')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-dark-700">
        {linhas.map((l) => (
          <tr key={l.chave} onClick={l.filtro ? () => onClicar(l.filtro!) : undefined} className={l.filtro ? 'cursor-pointer hover:bg-dark-700/40' : ''} title={l.filtro ? 'Clique para ver essas cotações na lista' : undefined}>
            <td className="px-4 py-2 font-semibold text-dark-100 whitespace-nowrap">{l.rotulo}</td>
            {celulas(l.m).map((v, i) => (
              <td key={i} className={`px-3 py-2 text-right whitespace-nowrap ${i === 7 ? 'text-gold-300 font-semibold' : i === 4 ? 'text-green-300' : 'text-dark-200'}`}>
                {v}
              </td>
            ))}
          </tr>
        ))}
        {linhas.length > 1 && (
          <tr className="bg-dark-900/40 font-bold">
            <td className="px-4 py-2 text-dark-50">Total</td>
            {celulas(tot).map((v, i) => (
              <td key={i} className="px-3 py-2 text-right whitespace-nowrap text-dark-50">
                {v}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  )
}

export function RelatoriosCotacoes({ linhas, hoje, veTudo, onFiltrar }: { linhas: LinhaRelatorio[]; hoje: string; veTudo: boolean; onFiltrar: (f: FiltroRelatorio) => void }) {
  const r = useMemo(() => {
    const geral = metricas(linhas)
    // Por vendedor
    const porVend = new Map<number, { nome: string; l: LinhaRelatorio[] }>()
    for (const c of linhas) {
      const v = porVend.get(c.vendedorId) ?? { nome: c.vendedorNome, l: [] }
      v.l.push(c)
      porVend.set(c.vendedorId, v)
    }
    const vendedores = [...porVend.entries()].map(([id, v]) => ({ chave: String(id), rotulo: v.nome, m: metricas(v.l), filtro: { vendedorId: id } })).sort((a, b) => b.m.valor - a.m.valor)
    // Com × sem cadastro
    const com = linhas.filter((c) => c.cadastro === 'com')
    const sem = linhas.filter((c) => c.cadastro !== 'com')
    const tipos = [
      { chave: 'com', rotulo: 'Com cadastro', m: metricas(com), filtro: { cadastro: 'com' } },
      { chave: 'sem', rotulo: 'Sem cadastro (provisório)', m: metricas(sem), filtro: { cadastro: 'sem' } },
    ]
    // Por mês (data de criação)
    const porMes = new Map<string, LinhaRelatorio[]>()
    for (const c of linhas) {
      const m = c.diaBr.slice(0, 7)
      porMes.set(m, [...(porMes.get(m) ?? []), c])
    }
    const meses = [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, l]) => ({ chave: m, rotulo: rotuloMes(m), m: metricas(l), filtro: { mes: m } }))
    // Clientes que nasceram sem cadastro — situação de cada um.
    const limite = (() => {
      const d = new Date(`${hoje}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 30)
      return d.toISOString().slice(0, 10)
    })()
    const porCliente = new Map<number, { nome: string; doc: string | null; vendedor: string; primeira: string; qtd: number; valor: number; cadastro: CadastroSituacao }>()
    for (const c of sem) {
      const x = porCliente.get(c.clienteId) ?? { nome: c.clienteNome, doc: c.clienteDoc, vendedor: c.vendedorNome, primeira: c.diaBr, qtd: 0, valor: 0, cadastro: c.cadastro }
      x.qtd++
      x.valor += c.total
      if (c.diaBr < x.primeira) x.primeira = c.diaBr
      porCliente.set(c.clienteId, x)
    }
    const clientesSem = [...porCliente.values()].map((x) => ({
      ...x,
      situacao: x.cadastro === 'convertido' ? 'Cadastro feito' : x.cadastro === 'aguardando' ? 'Cadastro enviado — aguardando financeiro' : x.primeira < limite ? 'Vencido (passou 30 dias)' : 'Pendente (no prazo)',
      dias: Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${x.primeira}T12:00:00Z`)) / 86_400_000),
    }))
    const contar = (s: string) => clientesSem.filter((x) => x.situacao.startsWith(s)).length
    const situacoes = {
      convertidos: contar('Cadastro feito'),
      aguardando: contar('Cadastro enviado'),
      pendentes: contar('Pendente'),
      vencidos: contar('Vencido'),
    }
    // Motivos de perda
    const perdas = new Map<string, { qtd: number; valor: number }>()
    for (const c of linhas.filter((x) => x.status === 'perdida')) {
      const k = c.motivoPerda ?? 'Sem motivo'
      const p = perdas.get(k) ?? { qtd: 0, valor: 0 }
      p.qtd++
      p.valor += c.total
      perdas.set(k, p)
    }
    const motivos = [...perdas.entries()].sort((a, b) => b[1].qtd - a[1].qtd)
    return { geral, vendedores, tipos, meses, clientesSem, situacoes, motivos }
  }, [linhas, hoje])

  if (!linhas.length) return <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-6 text-center">Nenhuma cotação com esses filtros.</p>

  const g = r.geral
  const cards = [
    { rotulo: 'Cotações', valor: String(g.qtd), sub: formatarMoeda(g.valor) + ' cotados', cor: 'text-dark-50' },
    { rotulo: 'Cliente aprovou', valor: String(g.ganhas), sub: formatarMoeda(g.valorGanho), cor: 'text-green-300' },
    { rotulo: 'Viraram pedido SAP', valor: String(g.pedidos), sub: `${pct(g.pedidos, g.qtd)} das cotações`, cor: 'text-teal-300' },
    { rotulo: 'Conversão', valor: conversao(g), sub: `${g.ganhas} aprovadas · ${g.perdidas} perdidas`, cor: 'text-gold-300' },
    { rotulo: 'Ticket médio aprovado', valor: g.ganhas ? formatarMoeda(ticket(g)) : '—', sub: `média por cotação: ${g.qtd ? formatarMoeda(g.valor / g.qtd) : '—'}`, cor: 'text-dark-50' },
  ]
  const s = r.situacoes
  const cardsSem: { rotulo: string; valor: number; filtro: string; cor: string }[] = [
    { rotulo: 'Já fizeram o cadastro real', valor: s.convertidos, filtro: 'convertido', cor: 'text-green-300' },
    { rotulo: 'Cadastro aguardando financeiro', valor: s.aguardando, filtro: 'aguardando', cor: 'text-sky-300' },
    { rotulo: 'Pendentes (no prazo de 30 dias)', valor: s.pendentes, filtro: 'pendente', cor: 'text-amber-300' },
    { rotulo: 'Vencidos (passou 30 dias sem cadastro)', valor: s.vencidos, filtro: 'vencida_sem', cor: 'text-orange-300' },
  ]

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-dark-400">
        Usa os filtros acima (vendedor, período de criação, cadastro, busca) — a situação (Em aberto, Enviadas…) não entra, para a conversão ficar certa. Conversão = cliente aprovou ÷ (aprovou + perdeu). Clique numa linha para ver as cotações na lista.
      </p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.rotulo} className="rounded-2xl border border-dark-600 bg-dark-800 px-4 py-3">
            <p className="text-xs text-dark-400">{c.rotulo}</p>
            <p className={`mt-1 text-xl font-bold ${c.cor}`}>{c.valor}</p>
            <p className="text-[11px] text-dark-500">{c.sub}</p>
          </div>
        ))}
      </div>

      {veTudo && (
        <Secao titulo="Cotações por vendedor" sub="Ordenado pelo valor cotado" onCsv={() => exportar('cotacoes-por-vendedor.csv', 'Vendedor', r.vendedores)}>
          <TabelaMetricas primeira="Vendedor" linhas={r.vendedores} onClicar={onFiltrar} />
        </Secao>
      )}

      <Secao titulo="Com cadastro × sem cadastro" sub="Sem cadastro = cliente provisório (PROV-…), mesmo que já tenha feito o cadastro depois" onCsv={() => exportar('cotacoes-com-sem-cadastro.csv', 'Tipo de cliente', r.tipos)}>
        <TabelaMetricas primeira="Tipo de cliente" linhas={r.tipos} onClicar={onFiltrar} />
      </Secao>

      <Secao
        titulo="Clientes sem cadastro: fizeram o cadastro real?"
        sub="Cada cliente conta uma vez. Vencido = primeira cotação há mais de 30 dias e ainda sem cadastro."
        onCsv={() =>
          baixarCsv(
            'clientes-sem-cadastro.csv',
            paraCsv(
              [
                { chave: 'nome', rotulo: 'Cliente' },
                { chave: 'doc', rotulo: 'CNPJ/CPF' },
                { chave: 'vendedor', rotulo: 'Vendedor' },
                { chave: 'primeira', rotulo: '1ª cotação' },
                { chave: 'dias', rotulo: 'Dias desde a 1ª' },
                { chave: 'qtd', rotulo: 'Cotações' },
                { chave: 'valor', rotulo: 'Valor cotado (R$)' },
                { chave: 'situacao', rotulo: 'Situação' },
              ],
              r.clientesSem.map((x) => ({ ...x, primeira: dataBr(x.primeira), valor: num2(x.valor) }))
            )
          )
        }
      >
        <div className="grid gap-3 grid-cols-2 xl:grid-cols-4 p-4">
          {cardsSem.map((c) => (
            <button key={c.filtro} type="button" onClick={() => onFiltrar({ cadastro: c.filtro })} className="text-left rounded-xl border border-dark-600 bg-dark-900/50 px-3 py-2 hover:bg-dark-700/40" title="Clique para ver as cotações na lista">
              <p className="text-[11px] text-dark-400">{c.rotulo}</p>
              <p className={`text-xl font-bold ${c.cor}`}>{c.valor}</p>
            </button>
          ))}
        </div>
        {r.clientesSem.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-dark-400">
                <th className="px-4 py-2 font-semibold">Cliente</th>
                {veTudo && <th className="px-3 py-2 font-semibold">Vendedor</th>}
                <th className="px-3 py-2 font-semibold">1ª cotação</th>
                <th className="px-3 py-2 font-semibold text-right">Cotações</th>
                <th className="px-3 py-2 font-semibold text-right">Valor</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {[...r.clientesSem]
                .sort((a, b) => a.primeira.localeCompare(b.primeira))
                .map((x) => (
                  <tr key={`${x.nome}-${x.doc}`}>
                    <td className="px-4 py-2 text-dark-100">
                      {x.nome}
                      {x.doc && <span className="block text-[11px] text-dark-500">{x.doc}</span>}
                    </td>
                    {veTudo && <td className="px-3 py-2 text-dark-300 whitespace-nowrap">{x.vendedor}</td>}
                    <td className="px-3 py-2 text-dark-300 whitespace-nowrap">
                      {dataBr(x.primeira)} <span className="text-dark-500">({x.dias} dias)</span>
                    </td>
                    <td className="px-3 py-2 text-right text-dark-200">{x.qtd}</td>
                    <td className="px-3 py-2 text-right text-dark-200 whitespace-nowrap">{formatarMoeda(x.valor)}</td>
                    <td
                      className={`px-3 py-2 whitespace-nowrap text-xs font-semibold ${x.situacao.startsWith('Cadastro feito') ? 'text-green-300' : x.situacao.startsWith('Vencido') ? 'text-orange-300' : x.situacao.startsWith('Cadastro enviado') ? 'text-sky-300' : 'text-amber-300'}`}
                    >
                      {x.situacao}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Secao>

      <Secao titulo="Por mês" sub="Mês em que a cotação foi criada" onCsv={() => exportar('cotacoes-por-mes.csv', 'Mês', r.meses)}>
        <TabelaMetricas primeira="Mês" linhas={r.meses} onClicar={onFiltrar} />
      </Secao>

      {r.motivos.length > 0 && (
        <Secao
          titulo="Motivos de perda"
          onCsv={() => baixarCsv('cotacoes-motivos-perda.csv', paraCsv([{ chave: 'motivo', rotulo: 'Motivo' }, { chave: 'qtd', rotulo: 'Cotações' }, { chave: 'valor', rotulo: 'Valor (R$)' }], r.motivos.map(([motivo, p]) => ({ motivo, qtd: p.qtd, valor: num2(p.valor) }))))}
        >
          <table className="w-full text-sm">
            <tbody className="divide-y divide-dark-700">
              {r.motivos.map(([motivo, p]) => (
                <tr key={motivo} className="cursor-pointer hover:bg-dark-700/40" onClick={() => onFiltrar({ status: 'perdidas' })}>
                  <td className="px-4 py-2 text-dark-100">{motivo}</td>
                  <td className="px-3 py-2 text-right text-dark-200">{p.qtd}</td>
                  <td className="px-3 py-2 text-right text-dark-200">{pct(p.qtd, g.perdidas)}</td>
                  <td className="px-3 py-2 text-right text-dark-200 whitespace-nowrap">{formatarMoeda(p.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}
    </div>
  )
}
