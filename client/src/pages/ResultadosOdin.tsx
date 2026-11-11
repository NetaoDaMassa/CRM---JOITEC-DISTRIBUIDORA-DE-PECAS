import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BadgeDollarSign, Car, ClipboardList, Headset, MapPin, Package, PhoneCall, Receipt, Target, UserPlus, Users, Wrench } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import { Abas, Carregando, KpiCard, Secao, moeda, numero, pct } from '../components/relatorios/blocos'
import { PRESETS, datasDoPreset, formatarDataCurta, periodoAnterior, type Preset } from '../components/relatorios/filtros'
import BotaoImprimir from '../components/relatorios/BotaoImprimir'
import AvatarMeta from '../components/ui/AvatarMeta'
import { corTexto } from '../lib/corTexto'
import Modal from '../components/ui/Modal'

type Dados = inferRouterOutputs<AppRouter>['dashboardOdin']['resultados']
type Frente = 'externos' | 'leads' | 'pecas'
type Aba = 'geral' | Frente

// Resultados da Odin Compressores por frente de venda — pedido do João,
// 2026-10-23: os números estavam espalhados (Dashboard Odin, Relatórios
// Odin, Relatórios) e cada equipe acompanha uma coisa:
//   Externos:      visitas → propostas → pedidos (sem meta individual)
//   Interno leads: leads → atendidos → propostas → pedidos (meta individual)
//   Interno peças: carteira → contatados → orçamentos → vendas (meta individual)
// Vendedor vê só a aba da frente dele (e só os próprios números).
const COR = { externos: '#8b6fd1', leads: '#c2691a', pecas: '#0ea5a4', geral: '#24aff4', meta: '#22a861', ruim: '#e5534b' }
const FRENTE_DO_CANAL: Record<string, Frente> = { visitas: 'externos', leads: 'leads', pecas: 'pecas' }
const ROTULO: Record<Aba, string> = { geral: 'Geral', externos: 'Externos', leads: 'Interno leads', pecas: 'Interno peças' }

const somar = <T,>(l: T[], f: (x: T) => number) => l.reduce((a, x) => a + f(x), 0)
const taxa = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : null)
const pctOuTraco = (v: number | null | undefined) => (v == null ? '—' : pct(v))

// Números clicáveis (pedido do João, 2026-11-11: "esses 14 aguardando, não
// sei quem são") — cada card / número da tabela abre a lista do que ele
// conta. Ver dashboardOdin.resultadosDetalhe / lib/resultadosOdinDetalhe.ts.
type TipoDetalhe = 'leads' | 'aguardando' | 'contatos' | 'propostas' | 'pedidos' | 'visitas' | 'vendas' | 'ligacoes'
type PedidoDetalhe = { frente: Aba; tipo: TipoDetalhe; titulo: string; vendedorId?: number; vendedorNome?: string }
const AbrirDetalhe = createContext<(p: PedidoDetalhe) => void>(() => {})

// Número de uma célula da tabela "Por vendedor" que abre a lista só daquele vendedor.
function Num({ valor, frente, tipo, titulo, v, className = '' }: { valor: number; frente: Aba; tipo: TipoDetalhe; titulo: string; v: { id: number; nome: string }; className?: string }) {
  const abrir = useContext(AbrirDetalhe)
  if (!valor) return <span className={className}>{numero(valor)}</span>
  return (
    <button type="button" onClick={() => abrir({ frente, tipo, titulo, vendedorId: v.id, vendedorNome: v.nome })} className={`underline decoration-dotted underline-offset-2 hover:text-gold-400 ${className}`} title="Ver a lista">
      {numero(valor)}
    </button>
  )
}

function formatarDataDetalhe(d: string | null) {
  if (!d) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.split('-').reverse().join('/')
  const data = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d.replace(' ', 'T')}Z`)
  return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ModalDetalhe({ pedido, de, ate, base, onClose }: { pedido: PedidoDetalhe | null; de: string; ate: string; base: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  useEffect(() => setBusca(''), [pedido])
  const { data, isLoading, isError, error } = trpc.dashboardOdin.resultadosDetalhe.useQuery(
    { frente: pedido?.frente ?? 'geral', tipo: pedido?.tipo ?? 'pedidos', dataDe: de, dataAte: ate, vendedorId: pedido?.vendedorId },
    { enabled: !!pedido, retry: false },
  )
  const termo = busca.trim().toLowerCase()
  const linhas = (data ?? []).filter((l) => !termo || `${l.nome} ${l.detalhe ?? ''} ${l.vendedor}`.toLowerCase().includes(termo))
  const temValor = linhas.some((l) => l.valor != null)
  const total = linhas.reduce((s, l) => s + (l.valor ?? 0), 0)
  const periodo = pedido?.tipo === 'aguardando' ? 'agora (qualquer data)' : `${formatarDataCurta(de)} a ${formatarDataCurta(ate)}`
  return (
    <Modal open={!!pedido} onClose={onClose} title={pedido ? `${pedido.titulo}${pedido.vendedorNome ? ` — ${pedido.vendedorNome}` : ''}` : ''} size="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <p className="text-xs text-dark-400">
            {periodo} · <b className="text-dark-100">{numero(linhas.length)}</b> {linhas.length === 1 ? 'item' : 'itens'}
            {temValor && <> · total <b className="text-dark-100">{moeda(total)}</b></>}
          </p>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente ou vendedor..."
            className="h-8 w-56 max-w-full bg-dark-900 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5"
          />
        </div>
        {isError ? (
          <p className="text-dark-400 text-sm">{error?.message ?? 'Não foi possível carregar.'}</p>
        ) : isLoading ? (
          <Carregando />
        ) : !linhas.length ? (
          <p className="text-dark-400 text-sm py-6 text-center">Nada por aqui.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-dark-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-dark-800 text-xs text-dark-400">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Cliente</th>
                  <th className="text-left font-medium px-3 py-2">Vendedor</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">{pedido?.tipo === 'aguardando' ? 'Chegou em' : 'Data'}</th>
                  {temValor && <th className="text-right font-medium px-3 py-2">Valor</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => l.link && navigate(`${base}/${l.link}`)}
                    className={`border-t border-dark-700 ${l.link ? 'cursor-pointer hover:bg-dark-700/40' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <p className="text-dark-100 font-medium">{l.nome}</p>
                      {l.detalhe && <p className="text-xs text-dark-400">{l.detalhe}</p>}
                    </td>
                    <td className="px-3 py-2 text-dark-300 whitespace-nowrap">{l.vendedor}</td>
                    <td className="px-3 py-2 text-dark-300 whitespace-nowrap">{formatarDataDetalhe(l.data)}</td>
                    {temValor && <td className="px-3 py-2 text-right text-dark-100 whitespace-nowrap">{l.valor != null ? moeda(l.valor) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Funil horizontal: cada etapa com a barra proporcional à primeira e a
// conversão em relação à etapa anterior.
function Funil({ etapas, cor }: { etapas: { rotulo: string; valor: number; ajuda?: string }[]; cor: string }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 0)
  return (
    <div className="space-y-2.5">
      {etapas.map((e, i) => {
        const anterior = i > 0 ? etapas[i - 1].valor : null
        return (
          <div key={e.rotulo}>
            {anterior !== null && (
              <p className="text-[11px] text-dark-500 pl-1 -mt-1 mb-1">↓ {pctOuTraco(taxa(e.valor, anterior))} de conversão</p>
            )}
            <div className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-sm text-dark-200" title={e.ajuda}>
                {e.rotulo}
              </span>
              <div className="flex-1 h-8 bg-dark-900 rounded-lg overflow-hidden">
                <div
                  className="h-full rounded-lg flex items-center justify-end pr-2 text-xs font-bold text-white"
                  style={{ width: `${Math.max(4, (e.valor / topo) * 100)}%`, background: cor, opacity: 1 - i * 0.12 }}
                >
                  {numero(e.valor)}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BarraMeta({ percentual, ideal }: { percentual: number | null; ideal?: number | null }) {
  if (percentual == null) return <span className="text-xs text-dark-500">sem meta</span>
  const ok = ideal == null || percentual >= ideal
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="relative flex-1 h-2.5 bg-dark-900 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, percentual)}%`, background: percentual >= 100 ? COR.meta : ok ? COR.geral : COR.ruim }} />
        {ideal != null && <div className="absolute inset-y-0 w-0.5 bg-dark-50/70" style={{ left: `${Math.min(100, ideal)}%` }} />}
      </div>
      <span className="text-xs font-semibold text-dark-100 w-12 text-right">{pct(percentual)}</span>
    </div>
  )
}

function Tabela({ colunas, linhas }: { colunas: { titulo: string; direita?: boolean }[]; linhas: { id: number; celulas: ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-dark-400 border-b border-dark-600">
            {colunas.map((c) => (
              <th key={c.titulo} className={`py-2 px-2 font-medium whitespace-nowrap ${c.direita ? 'text-right' : 'text-left'}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-b border-dark-700/60 last:border-0">
              {l.celulas.map((c, i) => (
                <td key={i} className={`py-2 px-2 whitespace-nowrap ${colunas[i]?.direita ? 'text-right tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!linhas.length && (
            <tr>
              <td colSpan={colunas.length} className="py-6 text-center text-dark-500">
                Ninguém nesta equipe.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Pessoa({ nome, fotoUrl }: { nome: string; fotoUrl: string | null }) {
  return (
    <span className="flex items-center gap-2">
      <AvatarMeta nome={nome} fotoUrl={fotoUrl} size="sm" />
      <span className="font-medium text-dark-100">{nome}</span>
    </span>
  )
}

function LinksDetalhe({ links }: { links: { rotulo: string; to: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link key={l.to + l.rotulo} to={l.to} className="text-xs font-medium text-gold-500 hover:text-gold-400 border border-dark-600 hover:border-gold-500/60 rounded-lg px-2.5 py-1.5">
          {l.rotulo} →
        </Link>
      ))}
    </div>
  )
}

function AbaGeral({ d, irPara }: { d: Dados; irPara: (a: Aba) => void }) {
  const abrir = useContext(AbrirDetalhe)
  const g = d.geral!
  const ant = d.anterior.geral
  const frentes: { chave: Frente | 'semFrente'; rotulo: string; valor: number; cor: string }[] = [
    { chave: 'externos', rotulo: 'Externos', valor: g.porFrente.externos, cor: COR.externos },
    { chave: 'leads', rotulo: 'Interno leads', valor: g.porFrente.leads, cor: COR.leads },
    { chave: 'pecas', rotulo: 'Interno peças', valor: g.porFrente.pecas, cor: COR.pecas },
    { chave: 'semFrente', rotulo: 'Outros (sem equipe)', valor: g.porFrente.semFrente, cor: '#6b7a8c' },
  ]
  const total = Math.max(1, g.faturamento)
  const resumo = [
    { frente: 'externos' as const, icone: Car, linhas: [`${numero(somar(d.externos, (v) => v.visitas))} visitas`, `${numero(somar(d.externos, (v) => v.propostas))} propostas`, `${numero(somar(d.externos, (v) => v.pedidos))} pedidos`] },
    { frente: 'leads' as const, icone: UserPlus, linhas: [`${numero(somar(d.leads, (v) => v.leadsRecebidos))} leads`, `${numero(somar(d.leads, (v) => v.propostas))} propostas`, `${numero(somar(d.leads, (v) => v.pedidos))} pedidos`] },
    { frente: 'pecas' as const, icone: Wrench, linhas: [`${numero(somar(d.pecas, (v) => v.contatos))} contatos`, `${numero(somar(d.pecas, (v) => v.orcamentosAbertos))} orçamentos abertos`, `${numero(somar(d.pecas, (v) => v.vendas))} vendas`] },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard onClick={() => abrir({ frente: 'geral', tipo: 'pedidos', titulo: 'Pedidos do período' })} titulo="Faturamento" icone={BadgeDollarSign} cor={COR.geral} valor={moeda(g.faturamento)} atual={g.faturamento} anterior={ant?.faturamento} ajuda="Pedidos (externos, leads e peças) não cancelados criados no período" />
        <KpiCard onClick={() => abrir({ frente: 'geral', tipo: 'pedidos', titulo: 'Pedidos do período' })} titulo="Pedidos" icone={Package} cor={COR.pecas} valor={numero(g.pedidos)} atual={g.pedidos} anterior={ant?.pedidos} />
        <KpiCard onClick={() => abrir({ frente: 'geral', tipo: 'pedidos', titulo: 'Pedidos do período' })} titulo="Ticket médio" icone={Receipt} cor="#0ea5a4" valor={moeda(g.ticketMedio)} atual={g.ticketMedio} anterior={ant?.ticketMedio} />
        <KpiCard
          titulo="Meta do mês"
          icone={Target}
          cor={COR.meta}
          valor={g.percentualMeta == null ? '—' : pct(g.percentualMeta)}
          detalhe={g.meta ? `de ${moeda(g.meta)} · ideal hoje ${pctOuTraco(g.percentualIdealHoje)}` : 'Escolha "Este mês" (mês cheio) e cadastre a meta da empresa em Configurações'}
          destaque={g.percentualMeta != null && g.percentualIdealHoje != null ? (g.percentualMeta >= g.percentualIdealHoje ? 'bom' : 'ruim') : undefined}
        />
      </div>
      {g.meta && <BarraMeta percentual={g.percentualMeta} ideal={g.percentualIdealHoje} />}
      <div className="grid lg:grid-cols-5 gap-4">
        <Secao className="lg:col-span-2" titulo="De onde vem o faturamento" subtitulo="Pedidos do período por equipe do vendedor">
          <div className="space-y-3">
            {frentes
              .filter((f) => f.chave !== 'semFrente' || f.valor > 0)
              .map((f) => (
                <button key={f.chave} type="button" onClick={() => f.chave !== 'semFrente' && irPara(f.chave)} className="w-full text-left group">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-dark-200 group-hover:text-gold-400">{f.rotulo}</span>
                    <span className="font-semibold text-dark-50">
                      {moeda(f.valor)} <span className="text-dark-400 font-normal">· {pct((f.valor / total) * 100)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 bg-dark-900 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(f.valor / total) * 100}%`, background: f.cor }} />
                  </div>
                </button>
              ))}
          </div>
        </Secao>
        <div className="lg:col-span-3 grid sm:grid-cols-3 gap-3">
          {resumo.map((r) => (
            <button
              key={r.frente}
              type="button"
              onClick={() => irPara(r.frente)}
              className="text-left bg-dark-800 border border-dark-600 hover:border-gold-500/60 rounded-2xl p-4 transition-all hover:-translate-y-0.5"
              style={{ borderTop: `3px solid ${COR[r.frente]}` }}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-dark-50">
                <r.icone size={16} style={{ color: corTexto(COR[r.frente]) }} /> {ROTULO[r.frente]}
              </span>
              <p className="text-xl font-bold text-dark-50 mt-2">{moeda(g.porFrente[r.frente])}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-dark-400">
                {r.linhas.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <span className="block mt-3 text-xs text-gold-500">Ver equipe →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function AbaExternos({ d, base }: { d: Dados; base: string }) {
  const abrir = useContext(AbrirDetalhe)
  const l = d.externos
  const a = d.anterior.externos
  const t = { visitas: somar(l, (v) => v.visitas), gps: somar(l, (v) => v.visitasGps), propostas: somar(l, (v) => v.propostas), pedidos: somar(l, (v) => v.pedidos), valor: somar(l, (v) => v.valorVendido) }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard onClick={() => abrir({ frente: 'externos', tipo: 'visitas', titulo: 'Visitas' })} titulo="Visitas" icone={MapPin} cor={COR.externos} valor={numero(t.visitas)} atual={t.visitas} anterior={a.visitas} detalhe={`${numero(t.gps)} com GPS`} />
        <KpiCard onClick={() => abrir({ frente: 'externos', tipo: 'propostas', titulo: 'Propostas (externos)' })} titulo="Propostas" icone={ClipboardList} cor={COR.geral} valor={numero(t.propostas)} atual={t.propostas} anterior={a.propostas} />
        <KpiCard onClick={() => abrir({ frente: 'externos', tipo: 'pedidos', titulo: 'Pedidos (externos)' })} titulo="Pedidos" icone={Package} cor={COR.pecas} valor={numero(t.pedidos)} atual={t.pedidos} anterior={a.pedidos} />
        <KpiCard onClick={() => abrir({ frente: 'externos', tipo: 'pedidos', titulo: 'Vendido (externos)' })} titulo="Vendido" icone={BadgeDollarSign} cor={COR.meta} valor={moeda(t.valor)} atual={t.valor} anterior={a.valorVendido} detalhe="sem meta individual" />
      </div>
      <div className="grid 2xl:grid-cols-3 gap-4">
        <Secao titulo="Funil da equipe externa" subtitulo="Visita → proposta → pedido">
          <Funil cor={COR.externos} etapas={[{ rotulo: 'Visitas', valor: t.visitas }, { rotulo: 'Propostas', valor: t.propostas }, { rotulo: 'Pedidos', valor: t.pedidos }]} />
        </Secao>
        <Secao className="2xl:col-span-2" titulo="Por vendedor" subtitulo="Ordenado pelo valor vendido" acoes={<LinksDetalhe links={[...(base === '/admin' ? [{ rotulo: 'Semanal por vendedor', to: '/admin/relatorios-odin' }] : []), { rotulo: 'Visitas de Campo', to: `${base}/visitas` }, { rotulo: 'Propostas', to: `${base}/propostas` }]} />}>
          <Tabela
            colunas={[{ titulo: 'Vendedor' }, { titulo: 'Visitas', direita: true }, { titulo: 'Com GPS', direita: true }, { titulo: 'Propostas', direita: true }, { titulo: 'Pedidos', direita: true }, { titulo: 'Vendido', direita: true }, { titulo: 'Visita → proposta', direita: true }, { titulo: 'Proposta → pedido', direita: true }]}
            linhas={l.map((v) => ({
              id: v.id,
              celulas: [<Pessoa nome={v.nome} fotoUrl={v.fotoUrl} />, <Num valor={v.visitas} frente="externos" tipo="visitas" titulo="Visitas" v={v} />, numero(v.visitasGps), <Num valor={v.propostas} frente="externos" tipo="propostas" titulo="Propostas" v={v} />, <Num valor={v.pedidos} frente="externos" tipo="pedidos" titulo="Pedidos" v={v} />, moeda(v.valorVendido), pctOuTraco(v.conversaoVisitaProposta), pctOuTraco(v.conversaoPropostaPedido)],
            }))}
          />
        </Secao>
      </div>
    </div>
  )
}

function AbaLeads({ d, base }: { d: Dados; base: string }) {
  const abrir = useContext(AbrirDetalhe)
  const l = d.leads
  const a = d.anterior.leads
  const t = {
    recebidos: somar(l, (v) => v.leadsRecebidos),
    atendidos: somar(l, (v) => v.leadsAtendidos),
    aguardando: somar(l, (v) => v.aguardando),
    contatos: somar(l, (v) => v.contatos),
    propostas: somar(l, (v) => v.propostas),
    pedidos: somar(l, (v) => v.pedidos),
    valor: somar(l, (v) => v.valorVendido),
    meta: somar(l, (v) => v.meta ?? 0),
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard onClick={() => abrir({ frente: 'leads', tipo: 'leads', titulo: 'Leads recebidos' })} titulo="Leads recebidos" icone={UserPlus} cor={COR.leads} valor={numero(t.recebidos)} atual={t.recebidos} anterior={a.leadsRecebidos} />
        <KpiCard onClick={() => abrir({ frente: 'leads', tipo: 'aguardando', titulo: 'Aguardando atendimento' })} titulo="Aguardando atendimento" icone={Headset} cor={COR.ruim} valor={numero(t.aguardando)} detalhe="agora, sem nenhum contato" destaque={t.aguardando ? 'ruim' : 'bom'} />
        <KpiCard onClick={() => abrir({ frente: 'leads', tipo: 'contatos', titulo: 'Contatos com leads' })} titulo="Contatos" icone={PhoneCall} cor={COR.leads} valor={numero(t.contatos)} atual={t.contatos} anterior={a.contatos} />
        <KpiCard onClick={() => abrir({ frente: 'leads', tipo: 'pedidos', titulo: 'Pedidos (leads)' })} titulo="Pedidos" icone={Package} cor={COR.pecas} valor={numero(t.pedidos)} atual={t.pedidos} anterior={a.pedidos} detalhe={`${numero(t.propostas)} propostas`} />
        <KpiCard onClick={() => abrir({ frente: 'leads', tipo: 'pedidos', titulo: 'Vendido (leads)' })} titulo="Vendido" icone={BadgeDollarSign} cor={COR.meta} valor={moeda(t.valor)} atual={t.valor} anterior={a.valorVendido} detalhe={t.meta ? `${pct((t.valor / t.meta) * 100)} da meta da equipe (${moeda(t.meta)})` : undefined} />
      </div>
      <div className="grid 2xl:grid-cols-3 gap-4">
        <Secao titulo="Funil de leads" subtitulo="Recebido → atendido → proposta → pedido">
          <Funil
            cor={COR.leads}
            etapas={[
              { rotulo: 'Recebidos', valor: t.recebidos },
              { rotulo: 'Atendidos', valor: t.atendidos, ajuda: 'Leads do período com pelo menos 1 tentativa de contato' },
              { rotulo: 'Propostas', valor: t.propostas },
              { rotulo: 'Pedidos', valor: t.pedidos },
            ]}
          />
        </Secao>
        <Secao className="2xl:col-span-2" titulo="Por vendedor" subtitulo="Meta individual de faturamento" acoes={<LinksDetalhe links={[...(base === '/admin' ? [{ rotulo: 'Relatório de Leads', to: '/admin/leads-relatorios' }] : []), { rotulo: 'Kanban de Leads', to: `${base}/leads` }, { rotulo: 'Propostas', to: `${base}/propostas` }]} />}>
          <Tabela
            colunas={[{ titulo: 'Vendedor' }, { titulo: 'Leads', direita: true }, { titulo: 'Aguardando', direita: true }, { titulo: 'Contatos', direita: true }, { titulo: 'Propostas', direita: true }, { titulo: 'Pedidos', direita: true }, { titulo: 'Lead → pedido', direita: true }, { titulo: 'Vendido', direita: true }, { titulo: 'Meta' }]}
            linhas={l.map((v) => ({
              id: v.id,
              celulas: [
                <Pessoa nome={v.nome} fotoUrl={v.fotoUrl} />,
                <Num valor={v.leadsRecebidos} frente="leads" tipo="leads" titulo="Leads recebidos" v={v} />,
                <Num valor={v.aguardando} frente="leads" tipo="aguardando" titulo="Aguardando atendimento" v={v} className={v.aguardando ? 'text-red-400 font-semibold' : ''} />,
                <Num valor={v.contatos} frente="leads" tipo="contatos" titulo="Contatos com leads" v={v} />,
                <Num valor={v.propostas} frente="leads" tipo="propostas" titulo="Propostas" v={v} />,
                <Num valor={v.pedidos} frente="leads" tipo="pedidos" titulo="Pedidos" v={v} />,
                pctOuTraco(v.conversaoLeadPedido),
                moeda(v.valorVendido),
                <BarraMeta percentual={v.percentualMeta} ideal={d.geral?.percentualIdealHoje} />,
              ],
            }))}
          />
        </Secao>
      </div>
    </div>
  )
}

function AbaPecas({ d, base }: { d: Dados; base: string }) {
  const abrir = useContext(AbrirDetalhe)
  const l = d.pecas
  const a = d.anterior.pecas
  const t = {
    carteira: somar(l, (v) => v.carteira),
    contatados: somar(l, (v) => v.clientesContatados),
    contatos: somar(l, (v) => v.contatos),
    ligacoes: somar(l, (v) => v.ligacoes),
    orcamentos: somar(l, (v) => v.orcamentosAbertos),
    vendas: somar(l, (v) => v.vendas),
    compraram: somar(l, (v) => v.clientesCompraram),
    valor: somar(l, (v) => v.valorVendido),
    meta: somar(l, (v) => v.meta ?? 0),
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Cobertura da carteira" icone={Users} cor={COR.pecas} valor={pctOuTraco(taxa(t.contatados, t.carteira))} detalhe={`${numero(t.contatados)} de ${numero(t.carteira)} clientes no mês`} />
        <KpiCard onClick={() => abrir({ frente: 'pecas', tipo: 'contatos', titulo: 'Contatos (peças)' })} titulo="Contatos" icone={PhoneCall} cor={COR.leads} valor={numero(t.contatos)} atual={t.contatos} anterior={a.contatos} />
        <KpiCard onClick={() => abrir({ frente: 'pecas', tipo: 'ligacoes', titulo: 'Ligações (peças)' })} titulo="Ligações" icone={PhoneCall} cor={COR.leads} valor={numero(t.ligacoes)} atual={t.ligacoes} anterior={a.ligacoes} />
        <KpiCard onClick={() => abrir({ frente: 'pecas', tipo: 'vendas', titulo: 'Vendas (peças)' })} titulo="Vendas" icone={Package} cor={COR.pecas} valor={numero(t.vendas)} atual={t.vendas} anterior={a.vendas} detalhe={`${numero(t.orcamentos)} orçamentos em aberto`} />
        <KpiCard onClick={() => abrir({ frente: 'pecas', tipo: 'vendas', titulo: 'Vendido (peças)' })} titulo="Vendido" icone={BadgeDollarSign} cor={COR.meta} valor={moeda(t.valor)} atual={t.valor} anterior={a.valorVendido} detalhe={t.meta ? `${pct((t.valor / t.meta) * 100)} da meta da equipe (${moeda(t.meta)})` : undefined} />
      </div>
      <div className="grid 2xl:grid-cols-3 gap-4">
        <Secao titulo="Funil da carteira" subtitulo="Carteira → contatados → compraram">
          <Funil
            cor={COR.pecas}
            etapas={[
              { rotulo: 'Carteira', valor: t.carteira },
              { rotulo: 'Contatados', valor: t.contatados, ajuda: 'Clientes com pelo menos 1 contato no mês (mesma conta da Cobertura do Kanban)' },
              { rotulo: 'Compraram', valor: t.compraram },
            ]}
          />
          {/* Orçamento em aberto é foto de agora (quem comprou já saiu de
              Negociação) — por isso fica fora do funil, senão a conversão
              passava de 100%. */}
          <p className="text-sm text-dark-300 mt-4 pt-3 border-t border-dark-700">
            📝 <b className="text-dark-50">{numero(t.orcamentos)}</b> orçamentos em aberto agora (cards em Negociação)
          </p>
        </Secao>
        <Secao className="2xl:col-span-2" titulo="Por vendedor" subtitulo="Meta individual de faturamento" acoes={<LinksDetalhe links={[{ rotulo: 'Kanban', to: `${base}/kanban` }, { rotulo: 'Relatórios da carteira', to: `${base}/relatorios` }]} />}>
          <Tabela
            colunas={[{ titulo: 'Vendedor' }, { titulo: 'Carteira', direita: true }, { titulo: 'Cobertura', direita: true }, { titulo: 'Contatos', direita: true }, { titulo: 'Ligações', direita: true }, { titulo: 'Orçamentos', direita: true }, { titulo: 'Vendas', direita: true }, { titulo: 'Vendido', direita: true }, { titulo: 'Meta' }]}
            linhas={l.map((v) => ({
              id: v.id,
              celulas: [
                <Pessoa nome={v.nome} fotoUrl={v.fotoUrl} />,
                numero(v.carteira),
                pct(v.coberturaPercentual, 0),
                <Num valor={v.contatos} frente="pecas" tipo="contatos" titulo="Contatos" v={v} />,
                <Num valor={v.ligacoes} frente="pecas" tipo="ligacoes" titulo="Ligações" v={v} />,
                <span title={moeda(v.valorOrcamentosAbertos)}>{numero(v.orcamentosAbertos)}</span>,
                <Num valor={v.vendas} frente="pecas" tipo="vendas" titulo="Vendas" v={v} />,
                moeda(v.valorVendido),
                <BarraMeta percentual={v.percentualMeta} ideal={d.geral?.percentualIdealHoje} />,
              ],
            }))}
          />
        </Secao>
      </div>
    </div>
  )
}

export default function ResultadosOdin() {
  const { user } = useAuth()
  const ehAdmin = user?.role === 'admin' || !!user?.superAdmin
  const base = ehAdmin ? '/admin' : '/vendedor'
  const [preset, setPreset] = usePersistedState<Preset>('resultadosOdin:preset', 'mes')
  const [inicioCustom, setInicio] = usePersistedState('resultadosOdin:inicio', datasDoPreset('mes')!.inicio)
  const [fimCustom, setFim] = usePersistedState('resultadosOdin:fim', datasDoPreset('mes')!.fim)
  const datas = datasDoPreset(preset) ?? { inicio: inicioCustom, fim: fimCustom }
  const ant = periodoAnterior(datas.inicio, datas.fim)
  const [aba, setAba] = usePersistedState<Aba>('resultadosOdin:aba', 'geral')
  const [detalhe, setDetalhe] = useState<PedidoDetalhe | null>(null)

  const { data, isLoading, isError, error } = trpc.dashboardOdin.resultados.useQuery(
    { dataDe: datas.inicio, dataAte: datas.fim, anteriorDe: ant.inicio, anteriorAte: ant.fim },
    { retry: false },
  )

  const minhaFrente = data?.minhaFrente ? FRENTE_DO_CANAL[data.minhaFrente] : undefined
  const abas: Aba[] = ehAdmin ? ['geral', 'externos', 'leads', 'pecas'] : minhaFrente ? [minhaFrente] : []
  const abaAtual: Aba = abas.includes(aba) ? aba : (abas[0] ?? 'geral')
  useEffect(() => {
    if (data && abaAtual !== aba) setAba(abaAtual)
  }, [data, abaAtual, aba, setAba])

  return (
    <AbrirDetalhe.Provider value={setDetalhe}>
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-50">Resultados Odin</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            {formatarDataCurta(datas.inicio)} a {formatarDataCurta(datas.fim)} · comparado com {formatarDataCurta(ant.inicio)} a {formatarDataCurta(ant.fim)}
          </p>
        </div>
        <BotaoImprimir nomeArquivo={`resultados-odin-${abaAtual}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex items-center rounded-lg border border-dark-600 bg-dark-800 p-0.5 overflow-x-auto max-w-full">
          {PRESETS.map((p) => (
            <button
              key={p.valor}
              type="button"
              onClick={() => {
                if (p.valor === 'custom') {
                  setInicio(datas.inicio)
                  setFim(datas.fim)
                }
                setPreset(p.valor)
              }}
              className={`px-2.5 h-8 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                preset === p.valor ? 'bg-gold-500 text-white shadow-sm' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-700'
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={datas.inicio}
          onChange={(e) => {
            if (!e.target.value) return
            setPreset('custom')
            setInicio(e.target.value)
          }}
          className="h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5"
          aria-label="De"
        />
        <span className="text-dark-500 text-xs">até</span>
        <input
          type="date"
          value={datas.fim}
          onChange={(e) => {
            if (!e.target.value) return
            setPreset('custom')
            setFim(e.target.value)
          }}
          className="h-9 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-2.5"
          aria-label="Até"
        />
      </div>

      {abas.length > 1 && <Abas valor={abaAtual} opcoes={abas.map((a) => ({ valor: a, rotulo: ROTULO[a] }))} onChange={setAba} />}

      {isError ? (
        <p className="text-dark-400">{error?.message ?? 'Não foi possível carregar.'}</p>
      ) : isLoading || !data ? (
        <Carregando />
      ) : !abas.length ? (
        <p className="text-dark-400">Seu usuário não está em nenhuma equipe de venda (Usuários → Equipe).</p>
      ) : abaAtual === 'geral' && data.geral ? (
        <AbaGeral d={data} irPara={setAba} />
      ) : abaAtual === 'externos' ? (
        <AbaExternos d={data} base={base} />
      ) : abaAtual === 'leads' ? (
        <AbaLeads d={data} base={base} />
      ) : (
        <AbaPecas d={data} base={base} />
      )}
      <ModalDetalhe pedido={detalhe} de={datas.inicio} ate={datas.fim} base={base} onClose={() => setDetalhe(null)} />
    </div>
    </AbrirDetalhe.Provider>
  )
}
