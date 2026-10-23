// Controle de Pedidos (Odin Compressores) — refeito a pedido do João,
// 2026-10-23 (era o "Dashboard Odin"). Tela operacional: onde está cada
// pedido AGORA (de qualquer data), o que está parado, o que andou e o que
// entrou/saiu no período. Resultado de vendas por equipe foi pra
// "Resultados Odin". Dados: dashboardOdin.controlePedidos
// (server/src/lib/controlePedidosOdin.ts).
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Ban, CheckCircle2, Clock, KanbanSquare, PackageCheck, PauseCircle, Receipt, RefreshCw, Search, Timer, Truck, Wallet, X } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../lib/trpc'
import { usePersistedState } from '../lib/usePersistedState'
import Select from '../components/ui/Select'
import { Carregando, KpiCard, Secao, moeda, numero } from '../components/relatorios/blocos'
import { PRESETS, datasDoPreset, formatarDataCurta, type Preset } from '../components/relatorios/filtros'
import { PRIORIDADE_CONFIG, STAGE_COLORS, STAGE_DOT_COLORS, STAGE_LABELS, STAGE_SEQUENCE_MAQUINA, STAGE_SEQUENCE_PECA, type Stage } from '../lib/ordensShared'

type Dados = inferRouterOutputs<AppRouter>['dashboardOdin']['controlePedidos']
type Pedido = Dados['agora']['lista'][number]
type Filtro = { chave: string; rotulo: string; teste: (p: Pedido) => boolean } | null

const PRESETS_PERIODO: Preset[] = ['7d', 'mes', 'mes_passado', '90d', 'ano']
const LIMITE_LINHAS = 40

function tempo(horas: number): string {
  if (horas < 1) return 'menos de 1h'
  const d = Math.floor(horas / 24)
  const h = Math.floor(horas % 24)
  return d ? `${d}d ${h}h` : `${h}h`
}

function quando(utc: string): string {
  const d = new Date(utc.replace(' ', 'T') + 'Z')
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function EtapaBadge({ stage }: { stage: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md border whitespace-nowrap ${STAGE_COLORS[stage as Stage] ?? 'text-dark-300 border-dark-600'}`}>
      {STAGE_LABELS[stage as Stage] ?? stage}
    </span>
  )
}

// Esteira de uma linha (máquinas ou peças): as etapas em ordem, cada uma
// com quantos pedidos estão ali — clicar filtra a tabela embaixo.
function Esteira({
  titulo,
  etapas,
  pedidos,
  filtroAtivo,
  aoFiltrar,
}: {
  titulo: string
  etapas: readonly Stage[]
  pedidos: Pedido[]
  filtroAtivo: string | null
  aoFiltrar: (f: Filtro) => void
}) {
  const tipo = titulo === 'Máquinas' ? 'maquina' : 'peca'
  return (
    <div>
      <p className="text-xs font-semibold text-dark-300 uppercase tracking-wide mb-2">
        {titulo} <span className="text-dark-500 font-normal normal-case">· {numero(pedidos.length)} em andamento</span>
      </p>
      <div className="flex flex-wrap gap-y-2 gap-x-2">
        {etapas
          .filter((e) => e !== 'pos_venda')
          .map((e, i) => {
            const naEtapa = pedidos.filter((p) => p.stage === e)
            const parados = naEtapa.filter((p) => p.alerta === 'vermelho').length
            const demorando = naEtapa.filter((p) => p.alerta === 'laranja').length
            const chave = `${tipo}:${e}`
            const ativo = filtroAtivo === chave
            return (
              <div key={e} className="flex items-center gap-2 shrink-0">
                {i > 0 && <span className="text-dark-600">›</span>}
                <button
                  type="button"
                  disabled={!naEtapa.length}
                  onClick={() => aoFiltrar(ativo ? null : { chave, rotulo: `${titulo} em ${STAGE_LABELS[e]}`, teste: (p) => p.tipo === tipo && p.stage === e })}
                  className={`min-w-[104px] rounded-xl border px-3 py-2 text-left transition-all ${
                    ativo ? 'border-gold-500 bg-gold-500/10' : naEtapa.length ? 'border-dark-600 bg-dark-900 hover:border-gold-500/60' : 'border-dark-700 bg-dark-900/40 opacity-50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-dark-400 whitespace-nowrap">
                    <span className={`w-2 h-2 rounded-full ${STAGE_DOT_COLORS[e]}`} />
                    {STAGE_LABELS[e]}
                  </span>
                  <span className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-xl font-bold text-dark-50 tabular-nums">{naEtapa.length}</span>
                    {parados > 0 && <span className="text-[11px] font-semibold text-red-400">{parados} parado{parados > 1 ? 's' : ''}</span>}
                    {!parados && demorando > 0 && <span className="text-[11px] font-semibold text-amber-400">{demorando} demorando</span>}
                  </span>
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}

function Clicavel({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-2xl transition-all ${ativo ? 'ring-2 ring-gold-500' : 'hover:-translate-y-0.5'}`}>
      {children}
    </button>
  )
}

function Mini({ rotulo, valor, sub, icone: Icone, cor }: { rotulo: string; valor: ReactNode; sub?: ReactNode; icone: typeof Clock; cor: string }) {
  return (
    <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3">
      <p className="flex items-center gap-1.5 text-xs text-dark-400">
        <Icone size={14} style={{ color: cor }} /> {rotulo}
      </p>
      <p className="text-xl font-bold text-dark-50 mt-1 tabular-nums">{valor}</p>
      {sub && <p className="text-xs text-dark-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function DashboardOdin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin' || !!user?.superAdmin
  const base = isAdmin ? '/admin' : '/vendedor'
  const [preset, setPreset] = usePersistedState<Preset>('controlePedidos:preset', 'mes')
  const [vendedorId, setVendedorId] = usePersistedState<string>('controlePedidos:vendedor', '')
  const [filtro, setFiltro] = useState<Filtro>(null)
  const [busca, setBusca] = useState('')
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const datas = datasDoPreset(preset) ?? datasDoPreset('mes')!

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })
  const { data, isLoading, isError, error, refetch, isFetching } = trpc.dashboardOdin.controlePedidos.useQuery(
    { dataDe: datas.inicio, dataAte: datas.fim, vendedorId: vendedorId ? Number(vendedorId) : undefined },
    { refetchInterval: 60_000, retry: false },
  )

  const filtrar = (f: Filtro) => {
    setFiltro(f)
    setMostrarTodos(false)
  }

  const lista = useMemo(() => {
    if (!data) return []
    const termo = busca.trim().toLowerCase()
    return data.agora.lista.filter(
      (p) =>
        (!filtro || filtro.teste(p)) &&
        (!termo || p.clienteNome.toLowerCase().includes(termo) || p.vendedorNome.toLowerCase().includes(termo) || String(p.numeroPedido ?? p.id).includes(termo)),
    )
  }, [data, filtro, busca])

  if (isError) return <p className="p-6 text-dark-400">{error?.message ?? 'Não foi possível carregar.'}</p>
  if (isLoading || !data) return <Carregando />

  const a = data.agora
  const per = data.periodo
  const atalho = (chave: string, rotulo: string, teste: (p: Pedido) => boolean) => ({
    ativo: filtro?.chave === chave,
    onClick: () => filtrar(filtro?.chave === chave ? null : { chave, rotulo, teste }),
  })
  const visiveis = mostrarTodos ? lista : lista.slice(0, LIMITE_LINHAS)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-50">Controle de Pedidos</h1>
          <p className="text-sm text-dark-400 mt-0.5">Onde está cada pedido agora — atualiza sozinho a cada minuto</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Select
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos os vendedores"
              className="w-48"
              options={(vendedores ?? []).filter((v) => (v as { canalVenda?: string }).canalVenda !== 'nenhum').map((v) => ({ value: v.id, label: v.name }))}
            />
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="h-9 flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 text-xs font-medium text-dark-300 hover:text-gold-400 hover:border-gold-500/60"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Atualizar
          </button>
          <Link to={`${base}/ordens`} className="h-9 flex items-center gap-1.5 rounded-lg bg-gold-500 px-3 text-xs font-semibold text-white hover:bg-gold-600">
            <KanbanSquare size={14} /> Abrir Kanban de pedidos
          </Link>
        </div>
      </div>

      {/* Agora */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Clicavel {...atalho('todos', 'Todos em andamento', () => true)}>
          <KpiCard titulo="Em andamento" icone={Clock} cor="#24aff4" valor={numero(a.total)} detalhe={`${numero(a.maquinas)} máquinas · ${numero(a.pecas)} peças`} />
        </Clicavel>
        <KpiCard titulo="Valor em andamento" icone={Wallet} cor="#22a861" valor={moeda(a.valor)} detalhe="pedidos ainda não finalizados" />
        <Clicavel {...atalho('parados', 'Parados demais na etapa', (p) => p.alerta === 'vermelho')}>
          <KpiCard
            titulo="Parados"
            icone={AlertTriangle}
            cor="#e5534b"
            valor={numero(a.parados)}
            detalhe={`coleta > 24h ou preparação > 72h · +${numero(a.demorando)} há mais de 48h`}
            destaque={a.parados ? 'ruim' : 'bom'}
            ajuda="Mesmos limites do alerta do Kanban de pedidos"
          />
        </Clicavel>
        <Clicavel {...atalho('faturamento', 'Em Faturamento', (p) => p.stage === 'faturamento')}>
          <KpiCard titulo="Em faturamento" icone={Receipt} cor="#8b5cf6" valor={numero(a.emFaturamento)} detalhe="aguardando nota" />
        </Clicavel>
        <Clicavel {...atalho('expedicao', 'Em expedição (coleta/rastreio)', (p) => p.stage === 'coleta' || p.stage === 'rastreio')}>
          <KpiCard titulo="Em expedição" icone={Truck} cor="#ec4899" valor={numero(a.emExpedicao)} detalhe="coleta + rastreio" />
        </Clicavel>
        <Clicavel {...atalho('pausados', 'Pausados', (p) => p.pausado)}>
          <KpiCard titulo="Pausados" icone={PauseCircle} cor="#94a3b8" valor={numero(a.pausados)} detalhe="parados de propósito" />
        </Clicavel>
      </div>

      <Secao titulo="Esteira dos pedidos" subtitulo="Quantos pedidos estão em cada etapa agora — clique numa etapa pra ver quais são">
        <div className="space-y-4">
          <Esteira titulo="Máquinas" etapas={STAGE_SEQUENCE_MAQUINA} pedidos={a.lista.filter((p) => p.tipo === 'maquina')} filtroAtivo={filtro?.chave ?? null} aoFiltrar={filtrar} />
          <Esteira titulo="Peças" etapas={STAGE_SEQUENCE_PECA} pedidos={a.lista.filter((p) => p.tipo === 'peca')} filtroAtivo={filtro?.chave ?? null} aoFiltrar={filtrar} />
        </div>
      </Secao>

      <Secao
        titulo="Pedidos em andamento"
        subtitulo="Do que está há mais tempo na etapa pro mais recente"
        acoes={
          <div className="flex items-center gap-2 flex-wrap">
            {filtro && (
              <button type="button" onClick={() => filtrar(null)} className="flex items-center gap-1 text-xs rounded-lg bg-gold-500/15 text-gold-400 px-2.5 py-1.5">
                {filtro.rotulo} <X size={12} />
              </button>
            )}
            <label className="flex items-center gap-1.5 h-9 bg-dark-900 border border-dark-600 rounded-lg px-2.5">
              <Search size={14} className="text-dark-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, vendedor ou nº" className="bg-transparent text-sm text-dark-100 outline-none w-44" />
            </label>
          </div>
        }
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dark-400 border-b border-dark-600">
                <th className="py-2 px-2 text-left font-medium">Pedido</th>
                <th className="py-2 px-2 text-left font-medium">Cliente</th>
                <th className="py-2 px-2 text-left font-medium">Vendedor</th>
                <th className="py-2 px-2 text-left font-medium">Etapa</th>
                <th className="py-2 px-2 text-right font-medium">Na etapa há</th>
                <th className="py-2 px-2 text-left font-medium">Prioridade</th>
                <th className="py-2 px-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => {
                const prio = p.prioridade ? PRIORIDADE_CONFIG[p.prioridade] : null
                return (
                  <tr key={p.id} onClick={() => navigate(`${base}/ordens/${p.id}`)} className="border-b border-dark-700/60 last:border-0 cursor-pointer hover:bg-dark-700/40">
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="font-semibold text-dark-50">#{p.numeroPedido ?? p.id}</span>
                      <span className="ml-1.5 text-[11px] text-dark-500">{p.tipo === 'maquina' ? 'máquina' : 'peça'}</span>
                    </td>
                    <td className="py-2 px-2 max-w-[260px] truncate text-dark-100">{p.clienteNome}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-dark-300">{p.vendedorNome}</td>
                    <td className="py-2 px-2">
                      <EtapaBadge stage={p.stage} />
                      {p.pausado && <span className="ml-1.5 text-[11px] text-dark-400" title={p.pausadoMotivo ?? undefined}>⏸ pausado</span>}
                    </td>
                    <td
                      className={`py-2 px-2 text-right whitespace-nowrap tabular-nums font-medium ${
                        p.alerta === 'vermelho' ? 'text-red-400' : p.alerta === 'laranja' ? 'text-amber-400' : 'text-dark-200'
                      }`}
                    >
                      {p.alerta === 'vermelho' ? '⚠ ' : ''}
                      {tempo(p.horasNaEtapa)}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {prio ? <span className={`text-[11px] px-2 py-0.5 rounded-md border ${prio.badge}`}>{(p.tipo === 'peca' && prio.labelPeca) || prio.label}</span> : <span className="text-dark-600">—</span>}
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums text-dark-100">{p.valor != null ? moeda(p.valor) : '—'}</td>
                  </tr>
                )
              })}
              {!lista.length && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-dark-500">
                    Nenhum pedido em andamento {filtro || busca ? 'com esse filtro' : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {lista.length > LIMITE_LINHAS && (
          <button type="button" onClick={() => setMostrarTodos((v) => !v)} className="mt-3 text-sm font-medium text-gold-500 hover:text-gold-400">
            {mostrarTodos ? 'Mostrar menos' : `Mostrar todos os ${numero(lista.length)}`}
          </button>
        )}
      </Secao>

      <div className="grid xl:grid-cols-5 gap-4 items-start">
        <Secao
          className="xl:col-span-3"
          titulo="No período"
          subtitulo={`${formatarDataCurta(per.de)} a ${formatarDataCurta(per.ate)}`}
          acoes={
            <div className="flex items-center rounded-lg border border-dark-600 bg-dark-900 p-0.5">
              {PRESETS.filter((p) => PRESETS_PERIODO.includes(p.valor)).map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  onClick={() => setPreset(p.valor)}
                  className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${preset === p.valor ? 'bg-gold-500 text-white' : 'text-dark-300 hover:text-dark-100'}`}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Mini rotulo="Entraram" icone={Clock} cor="#24aff4" valor={numero(per.novos.qtd)} sub={moeda(per.novos.valor)} />
            <Mini rotulo="Faturados" icone={Receipt} cor="#8b5cf6" valor={numero(per.faturados.qtd)} sub={moeda(per.faturados.valor)} />
            <Mini rotulo="Concluídos" icone={PackageCheck} cor="#22a861" valor={numero(per.concluidos)} sub="entregues" />
            <Mini rotulo="Cancelados" icone={Ban} cor="#e5534b" valor={numero(per.cancelados)} />
            <Mini rotulo="Ciclo médio" icone={Timer} cor="#c2691a" valor={per.cicloMedioDias == null ? '—' : `${per.cicloMedioDias.toLocaleString('pt-BR')} dias`} sub="do pedido à entrega" />
          </div>
        </Secao>

        <Secao className="xl:col-span-2" titulo="Últimas movimentações" subtitulo="Pedidos que mudaram de etapa">
          <ul className="space-y-2.5">
            {data.movimentacoes.map((m, i) => (
              <li key={`${m.ordemId}-${m.em}-${i}`}>
                <Link to={`${base}/ordens/${m.ordemId}`} className="flex items-start gap-2.5 group">
                  <CheckCircle2 size={15} className="text-dark-500 mt-0.5 shrink-0 group-hover:text-gold-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-dark-100 truncate group-hover:text-gold-400">
                      #{m.numeroPedido ?? m.ordemId} · {m.clienteNome}
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {m.de && <EtapaBadge stage={m.de} />}
                      <span className="text-dark-500 text-xs">→</span>
                      {m.para && <EtapaBadge stage={m.para} />}
                    </span>
                  </span>
                  <span className="text-[11px] text-dark-500 text-right shrink-0">
                    {quando(m.em)}
                    {m.quem && <span className="block">{m.quem}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {!data.movimentacoes.length && <li className="text-sm text-dark-500">Nenhuma movimentação ainda.</li>}
          </ul>
        </Secao>
      </div>
    </div>
  )
}
