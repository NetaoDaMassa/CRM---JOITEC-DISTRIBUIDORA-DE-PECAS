import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  MousePointerClick,
  KeyRound,
  Copy,
  Users,
  UserCheck,
  ShoppingBag,
  ShoppingCart,
  Eye,
  Clock,
  Layers,
  Timer,
  Search,
  Activity,
  Globe,
  Package,
  ChevronDown,
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { formatarMoeda } from '../../lib/moeda'

// Loja virtual nova (Compretec) — o que os visitantes fazem e quem está
// pronto pra comprar. Pedido do João, 2026-11-03; visual refeito e abas
// Vendas/Produtos/Origem/Ao vivo em 2026-11-10. Dados: eventos que a loja
// manda em lote (routes/lojaEventos.ts), agregados em router/lojaRastreamento.ts.

function hojeBr() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
}
function diasAtras(n: number) {
  return new Date(Date.now() - 3 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)
}
function tempo(msx: number | null | undefined) {
  if (!msx) return '—'
  const s = Math.round(msx / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
const n = (v: number) => v.toLocaleString('pt-BR')
const dataHora = (utc: string | null) =>
  utc ? new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const hora = (utc: string) => new Date(`${utc.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

type Aba = 'vendas' | 'comportamento' | 'produtos' | 'origem' | 'aovivo'
const ABAS: { id: Aba; rotulo: string; icone: typeof Users }[] = [
  { id: 'vendas', rotulo: 'Carrinhos e pedidos', icone: ShoppingCart },
  { id: 'comportamento', rotulo: 'Comportamento', icone: Activity },
  { id: 'produtos', rotulo: 'Produtos e buscas', icone: Package },
  { id: 'origem', rotulo: 'De onde vêm', icone: Globe },
  { id: 'aovivo', rotulo: 'Ao vivo', icone: Eye },
]

const PERIODOS: [string, number][] = [
  ['Hoje', 0],
  ['7 dias', 6],
  ['30 dias', 29],
  ['90 dias', 89],
]

const COR_SITUACAO: Record<string, string> = {
  Pago: 'bg-green-500/15 text-green-300 border-green-500/30',
  'Aguardando pagamento': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Pagamento não concluído': 'bg-red-500/15 text-red-300 border-red-500/30',
}
const COR_EVENTO: Record<string, string> = {
  purchase: 'bg-green-400',
  begin_checkout: 'bg-amber-400',
  payment_failed: 'bg-red-400',
  cart_abandoned: 'bg-red-400',
  add_to_cart: 'bg-orange-400',
  lead: 'bg-cyan-400',
  signup: 'bg-cyan-400',
  whatsapp_click: 'bg-emerald-400',
  product_view: 'bg-blue-400',
  search: 'bg-purple-400',
}

function Bloco({ titulo, icone: Icone, extra, children }: { titulo: string; icone?: typeof Users; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dark-100 flex items-center gap-2">
          {Icone && <Icone size={15} className="text-orange-300" />}
          {titulo}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  )
}

function Tabela({ cab, linhas, vazio }: { cab: string[]; linhas: React.ReactNode[][]; vazio: string }) {
  if (!linhas.length) return <Vazio texto={vazio} />
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-dark-500 text-left">
            {cab.map((c, i) => (
              <th key={c} className={`py-2 px-1 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-dark-700/70 hover:bg-dark-700/30">
              {l.map((c, j) => (
                <td key={j} className={`py-2 px-1 ${j > 0 ? 'text-right font-mono whitespace-nowrap text-dark-300' : 'text-dark-200'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-sm text-dark-500 text-center py-6">{texto}</p>
}

// Barra horizontal (usada em produtos, origem e buscas)
function Barra({ valor, max, cor = 'bg-orange-500/50' }: { valor: number; max: number; cor?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-dark-700 overflow-hidden mt-1">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${max ? Math.max(2, (valor / max) * 100) : 0}%` }} />
    </div>
  )
}

function Kpi({ rotulo, valor, sub, icone: Icone, destaque }: { rotulo: string; valor: string; sub?: string; icone: typeof Users; destaque: string }) {
  return (
    <div className="relative overflow-hidden bg-dark-800 border border-dark-600 rounded-2xl p-4">
      <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full blur-2xl opacity-30 ${destaque}`} />
      <div className="flex items-center gap-2 text-xs text-dark-400">
        <Icone size={14} /> {rotulo}
      </div>
      <p className="mt-1.5 text-2xl font-bold font-mono text-dark-50">{valor}</p>
      {sub && <p className="text-xs text-dark-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function LeadLink({ lead, base }: { lead: { leadId: number; nome: string | null; telefone: string | null } | null | undefined; base: string }) {
  if (!lead) return <span className="text-dark-500">Visitante sem contato</span>
  return (
    <span className="min-w-0">
      <Link to={`${base}/${lead.leadId}`} className="text-gold-400 hover:underline font-medium">
        {lead.nome ?? `Lead ${lead.leadId}`}
      </Link>
      {lead.telefone && <span className="text-xs text-dark-400"> · {lead.telefone}</span>}
    </span>
  )
}

function Configuracao() {
  const { data } = trpc.lojaRastreamento.chave.useQuery()
  const [chave, setChave] = useState<string | null>(null)
  const [aberta, setAberta] = useState(false)
  const gerar = trpc.lojaRastreamento.gerarChave.useMutation({ onSuccess: (r) => setChave(r.chave), onError: (e) => toast.error(e.message) })
  const url = `${window.location.origin}/api/loja/eventos`
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copiado'))
  if (!data) return null
  const mostrar = aberta || !data.configurada || !!chave
  return (
    <section className="bg-dark-800/60 border border-dark-700 rounded-2xl">
      <button type="button" onClick={() => setAberta(!aberta)} className="w-full flex items-center justify-between gap-2 px-5 py-3 text-sm text-dark-300">
        <span className="flex items-center gap-2">
          <KeyRound size={14} /> Ligação com a loja
          {data.configurada ? <span className="text-xs text-green-300">● ligada</span> : <span className="text-xs text-amber-300">● falta gerar a chave</span>}
        </span>
        <ChevronDown size={15} className={`transition-transform ${mostrar ? 'rotate-180' : ''}`} />
      </button>
      {mostrar && (
        <div className="px-5 pb-4 space-y-3">
          <div className="text-sm text-dark-300 space-y-1">
            <p>
              Endereço que a loja chama: <code className="text-gold-300">{url}</code>
              <button type="button" className="ml-2 text-dark-400 hover:text-dark-100" onClick={() => copiar(url)}>
                <Copy size={13} className="inline" />
              </button>
            </p>
            <p>
              company_id: <code className="text-gold-300">{data.slug}</code> · chave {data.configurada ? <b className="text-green-300">configurada</b> : <b className="text-amber-300">ainda não gerada</b>}
            </p>
          </div>
          {chave ? (
            <div className="rounded-lg border border-amber-600/50 bg-amber-900/20 p-3 space-y-2">
              <p className="text-xs text-amber-200">Copie agora e cole na configuração da loja. Ela não aparece de novo — se perder, gere outra.</p>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all text-dark-100 flex-1">{chave}</code>
                <Button size="sm" variant="secondary" onClick={() => copiar(chave)}>
                  Copiar
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" loading={gerar.isPending} onClick={() => gerar.mutate()}>
              <KeyRound size={14} className="mr-1 inline" /> {data.configurada ? 'Gerar chave nova (a antiga para de valer)' : 'Gerar chave'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

export default function LojaRastreamento() {
  const { user } = useAuth()
  const [de, setDe] = useState(diasAtras(6))
  const [ate, setAte] = useState(hojeBr())
  const [aba, setAba] = useState<Aba>('vendas')
  const { data, isLoading } = trpc.lojaRastreamento.resumo.useQuery({ de, ate }, { refetchInterval: 60_000 })
  const base = user?.role === 'admin' ? '/admin/leads' : '/vendedor/leads'
  const t = data?.totais
  const copiar = (link: string) => navigator.clipboard?.writeText(link).then(() => toast.success('Link copiado — cole no WhatsApp do cliente'))
  const periodoAtivo = PERIODOS.find(([, d]) => de === diasAtras(d) && ate === hojeBr())?.[0]

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500/30 to-amber-500/10 border border-orange-500/30 flex items-center justify-center">
            <MousePointerClick size={21} className="text-orange-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100 flex flex-wrap items-center gap-3">
              Loja virtual — visitantes
              {t && t.naLojaAgora > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> {t.naLojaAgora} na loja agora
                </span>
              )}
            </h1>
            <p className="text-sm text-dark-400">Quem visitou, o que olhou, quem deixou contato, carrinhos e pedidos</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-xl bg-dark-800 border border-dark-600 p-0.5">
            {PERIODOS.map(([rot, d]) => (
              <button
                key={rot}
                type="button"
                onClick={() => (setDe(diasAtras(d)), setAte(hojeBr()))}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${periodoAtivo === rot ? 'bg-orange-500/20 text-orange-200 font-semibold' : 'text-dark-400 hover:text-dark-100'}`}
              >
                {rot}
              </button>
            ))}
          </div>
          <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      {isLoading || !data || !t ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-dark-800 animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-2xl bg-dark-800 animate-pulse" />
        </div>
      ) : t.visitantes === 0 ? (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-10 text-center space-y-2">
          <MousePointerClick size={28} className="mx-auto text-dark-500" />
          <p className="text-dark-200 font-medium">Nenhum visitante neste período</p>
          <p className="text-sm text-dark-400">Os dados aparecem aqui assim que a loja mandar o rastreamento (a cada 15 minutos).</p>
        </div>
      ) : (
        <>
          {/* Números principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icone={Users} destaque="bg-blue-500" rotulo="Visitantes" valor={n(t.visitantes)} sub={`${n(t.sessoes)} visitas · ${n(t.paginasVistas)} páginas`} />
            <Kpi icone={UserCheck} destaque="bg-cyan-500" rotulo="Viraram lead" valor={n(t.leads)} sub={t.visitantes ? `${((t.leads / t.visitantes) * 100).toFixed(1)}% dos visitantes` : undefined} />
            <Kpi
              icone={ShoppingBag}
              destaque="bg-green-500"
              rotulo="Compras pagas"
              valor={n(t.compras)}
              sub={`${t.valorCompras ? formatarMoeda(t.valorCompras, { casas: 0 }) : 'R$ 0'} · ${n(t.pedidosFeitos)} pedido(s) feito(s)`}
            />
            <Kpi
              icone={ShoppingCart}
              destaque="bg-red-500"
              rotulo="Carrinhos abandonados"
              valor={n(t.carrinhosAbandonados)}
              sub={t.valorCarrinhosAbandonados ? `${formatarMoeda(t.valorCarrinhosAbandonados, { casas: 0 })} pra recuperar` : undefined}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(
              [
                [Layers, 'Páginas por visita', t.paginasPorSessao ? t.paginasPorSessao.toFixed(1) : '—'],
                [Clock, 'Tempo médio na página', tempo(t.tempoMedioPaginaMs)],
                [Timer, 'Tempo médio da visita', tempo(t.tempoMedioSessaoMs)],
                [Eye, 'Viram algum produto', n(data.funil[1]?.visitantes ?? 0)],
              ] as [typeof Users, string, string][]
            ).map(([I, rot, v]) => (
              <div key={rot} className="flex items-center gap-3 bg-dark-800/60 border border-dark-700 rounded-xl px-3 py-2.5">
                <I size={16} className="text-dark-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] text-dark-500">{rot}</p>
                  <p className="text-sm font-semibold font-mono text-dark-100">{v}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Abas */}
          <div className="flex gap-1 overflow-x-auto border-b border-dark-700 -mx-1 px-1">
            {ABAS.map(({ id, rotulo, icone: I }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAba(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${aba === id ? 'border-orange-400 text-orange-200 font-semibold' : 'border-transparent text-dark-400 hover:text-dark-100'}`}
              >
                <I size={14} /> {rotulo}
                {id === 'vendas' && t.carrinhosAbandonados + data.pedidos.length > 0 && (
                  <span className="text-[10px] px-1.5 rounded-full bg-red-500/20 text-red-200">{t.carrinhosAbandonados + data.pedidos.length}</span>
                )}
              </button>
            ))}
          </div>

          {aba === 'vendas' && (
            <div className="grid xl:grid-cols-2 gap-4">
              <Bloco titulo="Carrinhos abandonados" icone={ShoppingCart} extra={<span className="text-xs text-dark-500">ligue primeiro pros mais recentes</span>}>
                {!data.carrinhos.length ? (
                  <Vazio texto="Nenhum carrinho abandonado no período." />
                ) : (
                  <div className="space-y-2">
                    {data.carrinhos.map((c, i) => (
                      <div key={i} className={`rounded-xl border p-3 space-y-1.5 ${c.comprouDepois ? 'border-dark-700 opacity-60' : 'border-red-500/25 bg-red-500/5'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <LeadLink lead={c.lead} base={base} />
                          <span className="text-xs text-dark-400">
                            {dataHora(c.quando)}
                            {c.valor ? <b className="ml-2 font-mono text-dark-100">{formatarMoeda(c.valor)}</b> : null}
                          </span>
                        </div>
                        {!c.lead && c.email && <p className="text-xs text-dark-400">E-mail: {c.email}</p>}
                        <p className="text-xs text-dark-300">{c.itens.map((it) => `${it.quantidade}x ${it.nome}`).join(' · ') || '—'}</p>
                        <div className="flex items-center gap-2">
                          {c.comprouDepois ? (
                            <span className="text-xs text-green-300">✓ comprou depois</span>
                          ) : (
                            c.link && (
                              <button type="button" onClick={() => copiar(c.link!)} className="inline-flex items-center gap-1 text-xs text-red-200 hover:text-red-100">
                                <Copy size={12} /> Copiar link do carrinho
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Bloco>
              <Bloco titulo="Pedidos" icone={Package}>
                {!data.pedidos.length ? (
                  <Vazio texto="Nenhum pedido no período." />
                ) : (
                  <div className="space-y-2">
                    {data.pedidos.map((p) => (
                      <div key={p.numero} className="rounded-xl border border-dark-600 bg-dark-700/30 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-dark-100">
                            Pedido {p.numero} <span className="text-xs font-normal text-dark-400">· {dataHora(p.quando)}</span>
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${COR_SITUACAO[p.situacao] ?? ''}`}>{p.situacao}</span>
                        </div>
                        <LeadLink lead={p.lead} base={base} />
                        <p className="text-xs text-dark-300">{p.itens.map((it) => `${it.quantidade}x ${it.nome}`).join(' · ')}</p>
                        <p className="text-xs text-dark-400 flex flex-wrap gap-x-3">
                          {p.total != null && <b className="font-mono text-dark-100">{formatarMoeda(p.total)}</b>}
                          {p.pagamento && <span>{p.pagamento}</span>}
                          {p.cidade && <span>{p.cidade}</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Bloco>
              <div className="xl:col-span-2">
                <Bloco titulo="Quem se identificou (virou lead)" icone={UserCheck}>
                  <Tabela
                    cab={['Lead', 'Última visita', 'Ações na loja']}
                    vazio="Ninguém se identificou no período."
                    linhas={data.identificados.map((v) => [<LeadLink key="l" lead={{ leadId: v.leadId, nome: v.nome, telefone: v.telefone }} base={base} />, dataHora(v.ultimaVisita), n(v.eventos)])}
                  />
                </Bloco>
              </div>
            </div>
          )}

          {aba === 'comportamento' && (
            <div className="space-y-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <Bloco titulo="Funil (visitantes únicos)" icone={Activity}>
                  <div className="space-y-2.5">
                    {data.funil.map((f, i) => {
                      const topo = data.funil[0]?.visitantes || 1
                      const anterior = i > 0 ? data.funil[i - 1].visitantes : null
                      return (
                        <div key={f.etapa}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-dark-300">{f.etapa}</span>
                            <span className="font-mono text-dark-100">
                              {n(f.visitantes)}
                              {anterior ? <span className="ml-2 text-xs text-dark-500">{Math.round((f.visitantes / anterior) * 100)}% da etapa anterior</span> : null}
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-dark-700 overflow-hidden mt-1">
                            <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${Math.max(1, (f.visitantes / topo) * 100)}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Bloco>
                <Bloco titulo="Visitantes por dia" icone={Users}>
                  <div className="flex items-end gap-1 h-44">
                    {data.porDia.map((d) => {
                      const maior = Math.max(1, ...data.porDia.map((x) => x.visitantes))
                      return (
                        <div
                          key={d.dia}
                          className="group flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-0"
                          title={`${d.dia.split('-').reverse().join('/')}: ${d.visitantes} visitantes, ${d.views} páginas, ${d.compras} compras`}
                        >
                          <span className="text-[10px] text-dark-400">{d.visitantes}</span>
                          <div className="w-full rounded-t-md bg-gradient-to-t from-orange-600/70 to-amber-400/70 group-hover:from-orange-500 group-hover:to-amber-300" style={{ height: `${(d.visitantes / maior) * 100}%` }} />
                          <span className="text-[10px] text-dark-500 truncate">
                            {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </Bloco>
              </div>
              <Bloco titulo="Páginas: tempo e saída" icone={Layers}>
                <Tabela
                  cab={['Página', 'Visualizações', 'Tempo engajado', 'Tempo aberta', 'Saíram por aqui']}
                  vazio="Sem páginas no período."
                  linhas={data.paginas.map((p) => [
                    <div key="p" className="min-w-0">
                      <p className="truncate max-w-md">{p.titulo ?? p.path}</p>
                      <p className="text-xs text-dark-500 truncate max-w-md">{p.path}</p>
                    </div>,
                    n(p.views),
                    tempo(p.engajadoMedioMs),
                    tempo(p.duracaoMediaMs),
                    n(p.saidas),
                  ])}
                />
              </Bloco>
              <Bloco titulo="Cliques em botões" icone={MousePointerClick}>
                <Tabela
                  cab={['Botão / produto', 'Cliques', 'Visitantes']}
                  vazio="Nenhum clique registrado."
                  linhas={data.cliques.map((c) => [
                    <span key="b">
                      {c.elemento}
                      {c.produto && <span className="text-xs text-dark-400"> · {c.produto}</span>}
                    </span>,
                    n(c.cliques),
                    n(c.visitantes),
                  ])}
                />
              </Bloco>
            </div>
          )}

          {aba === 'produtos' && (
            <div className="grid xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2">
                <Bloco titulo="Produtos mais vistos" icone={Package}>
                  <Tabela
                    cab={['Produto', 'Vistas', 'Pessoas', 'Carrinho', 'Compras', 'Tempo na página']}
                    vazio="Nenhum produto visto no período."
                    linhas={data.produtos.map((p) => [
                      <div key="n" className="min-w-0">
                        <p className="truncate max-w-sm" title={p.nome}>
                          {p.nome} <span className="text-xs text-dark-500">{p.sku}</span>
                        </p>
                        <Barra valor={p.vistas} max={Math.max(1, ...data.produtos.map((x) => x.vistas))} />
                      </div>,
                      n(p.vistas),
                      n(p.visitantes),
                      p.carrinho ? <span className="text-orange-300">{n(p.carrinho)}</span> : '0',
                      p.compras ? <span className="text-green-300">{n(p.compras)}</span> : '0',
                      tempo(p.engajadoMedioMs),
                    ])}
                  />
                </Bloco>
              </div>
              <Bloco titulo="O que mais buscaram" icone={Search}>
                {!data.buscas.length ? (
                  <Vazio texto="Nenhuma busca no período." />
                ) : (
                  <ul className="space-y-2">
                    {data.buscas.map((b) => (
                      <li key={b.termo}>
                        <div className="flex justify-between text-sm gap-2">
                          <span className="text-dark-200 truncate">{b.termo}</span>
                          <span className="font-mono text-dark-400">{n(b.vezes)}</span>
                        </div>
                        <Barra valor={b.vezes} max={data.buscas[0].vezes} cor="bg-purple-500/50" />
                      </li>
                    ))}
                  </ul>
                )}
              </Bloco>
            </div>
          )}

          {aba === 'origem' && (
            <Bloco titulo="De onde vêm os visitantes" icone={Globe}>
              <Tabela
                cab={['Origem', 'Visitas', 'Visitantes', 'Carrinho', 'Leads', 'Compras']}
                vazio="Sem dados."
                linhas={data.origens.map((o) => [
                  <div key="o" className="min-w-0">
                    <p>{o.origem}</p>
                    <Barra valor={o.sessoes} max={Math.max(1, ...data.origens.map((x) => x.sessoes))} cor="bg-blue-500/50" />
                  </div>,
                  n(o.sessoes),
                  n(o.visitantes),
                  n(o.carrinho),
                  n(o.leads),
                  `${n(o.compras)}${o.valor ? ` · ${formatarMoeda(o.valor, { casas: 0 })}` : ''}`,
                ])}
              />
            </Bloco>
          )}

          {aba === 'aovivo' && (
            <Bloco titulo="Últimas ações na loja" icone={Eye} extra={<span className="text-xs text-dark-500">atualiza sozinho a cada minuto</span>}>
              {!data.recentes.length ? (
                <Vazio texto="Nada ainda." />
              ) : (
                <ol className="space-y-2">
                  {data.recentes.map((e, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="text-xs font-mono text-dark-500 w-11 shrink-0 pt-0.5">{hora(e.quando)}</span>
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${COR_EVENTO[e.tipo] ?? 'bg-dark-500'}`} />
                      <div className="min-w-0">
                        <p className="text-dark-200">
                          {e.rotulo}
                          {e.produto ? <b className="font-medium"> · {e.produto}</b> : e.tipo === 'page_view' && e.pagina ? ` · ${e.pagina}` : ''}
                          {e.valor ? <span className="font-mono text-dark-400"> · {formatarMoeda(e.valor)}</span> : null}
                        </p>
                        <p className="text-xs">{e.lead ? <LeadLink lead={e.lead} base={base} /> : <span className="text-dark-500">Visitante …{e.visitante}</span>}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Bloco>
          )}
        </>
      )}

      {user?.superAdmin && <Configuracao />}
    </div>
  )
}
