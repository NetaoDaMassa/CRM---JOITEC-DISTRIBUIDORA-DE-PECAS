import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Columns3, Crosshair, Globe, Inbox, List, Search, Siren, Smartphone, Snowflake, Trophy, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { usePersistedState } from '../../lib/usePersistedState'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import LeadKanbanBoard from '../../components/LeadKanbanBoard'
import { DIAS_ESFRIANDO, diasEsquecido, LegendaLeads, NovidadesLeads, RankingSemana, TabelaLeads } from '../../components/leads/KanbanLeadsExtras'
import { Esqueleto } from '../../components/ui/Visual'
import { getLeadContactUrgency, isLeadTerminalStatus } from '../../lib/leadsShared'

// Painel no topo do Kanban de Leads (pedido do João, 2026-10-22): números
// do que precisa de atenção, cada um clicável — filtra o quadro logo abaixo.
type FiltroRapido = 'foco' | 'atrasados' | 'hoje' | 'novos' | 'esfriando' | 'meta' | 'site'

function Indicador({
  icone: Icone,
  valor,
  rotulo,
  cor,
  ativo,
  onClick,
  dica,
}: {
  icone: LucideIcon
  valor: number
  rotulo: string
  cor: string
  ativo?: boolean
  onClick?: () => void
  dica?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={dica}
      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all min-w-0 ${
        ativo ? 'bg-dark-700 shadow-lg' : 'bg-dark-800 border-dark-600 enabled:hover:border-dark-400 enabled:hover:-translate-y-0.5'
      }`}
      style={ativo ? { borderColor: cor, boxShadow: `0 0 0 1px ${cor}` } : undefined}
    >
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cor}1f`, color: cor }}>
        <Icone size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold text-dark-50 leading-tight tabular-nums">{valor.toLocaleString('pt-BR')}</span>
        <span className="block text-[11px] text-dark-400 truncate">{rotulo}</span>
      </span>
    </button>
  )
}

export default function LeadsKanban() {
  const { user, empresaAtivaId } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isGestor = user?.role === 'gestor'
  const basePath = isAdmin ? '/admin/leads' : '/vendedor/leads'
  // Gestor (papel novo, 2026-09-30) vê o Kanban igual admin (todos os
  // vendedores); um vendedor com transferir/excluir liberado (ex: Emily,
  // vendedora E gestora numa conta só) também — pedido do João, 2026-09-30.
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: isGestor || user?.role === 'vendor',
  })
  const verTudo = isAdmin || isGestor || !!minhasFeatures?.includes('leads_transferir') || !!minhasFeatures?.includes('leads_excluir') || !!minhasFeatures?.includes('leads_gerenciar_todos')

  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaAtiva = empresas?.find((e) => e.id === empresaAtivaId)
  const empresaSlug = empresaAtiva?.slug
  const navigate = useNavigate()

  const [vendorId, setVendorId] = usePersistedState('leadsKanban:vendorId', '')
  const [search, setSearch] = usePersistedState('leadsKanban:search', '')
  const [filtro, setFiltro] = usePersistedState<FiltroRapido | ''>('leadsKanban:filtroRapido', '')
  const [recolhidas, setRecolhidas] = usePersistedState<string[]>('leadsKanban:recolhidas', ['perdido', 'desqualificado', 'consumidor_final'])
  const [modo, setModo] = usePersistedState<'quadro' | 'lista'>('leadsKanban:modo', 'quadro')
  const [novidadesVistas, setNovidadesVistas] = usePersistedState('leadsKanban:novidadesVistas:v1', false)
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: verTudo })

  const { data, isLoading } = trpc.leads.list.useQuery({
    vendorId: verTudo && vendorId ? Number(vendorId) : undefined,
    search: search || undefined,
    page: 1,
    pageSize: 500,
  })

  const todos = data?.data ?? []
  type Lead = (typeof todos)[number]
  const abertos = todos.filter((l) => !isLeadTerminalStatus(l.status))
  const urgencia = (l: Lead) => (l.nextContactAt ? getLeadContactUrgency(l.nextContactAt, l.status) : null)
  const testes: Record<FiltroRapido, (l: Lead) => boolean> = {
    // "Meu dia": tudo que precisa de ação hoje.
    foco: (l) => !!urgencia(l)?.atrasado || urgencia(l)?.label === 'HOJE' || l.status === 'novo' || l.status === 'novo_consumidor_final' || diasEsquecido(l) >= DIAS_ESFRIANDO,
    atrasados: (l) => !!urgencia(l)?.atrasado,
    hoje: (l) => urgencia(l)?.label === 'HOJE',
    novos: (l) => l.status === 'novo' || l.status === 'novo_consumidor_final',
    esfriando: (l) => diasEsquecido(l) >= DIAS_ESFRIANDO,
    meta: (l) => l.source === 'meta_ads_lead',
    site: (l) => !!l.fromSite,
  }
  const contar = (f: FiltroRapido) => todos.filter(testes[f]).length
  const mesAtual = new Date().toISOString().slice(0, 7)
  const doMes = (l: Lead) => (l.statusChangedAt ?? '').slice(0, 7) === mesAtual
  const ganhosMes = todos.filter((l) => l.status === 'ganho' && doMes(l)).length
  const fechadosMes = todos.filter((l) => (l.status === 'ganho' || l.status === 'perdido') && doMes(l)).length
  const visiveis = filtro ? todos.filter(testes[filtro]) : todos

  const alternar = (f: FiltroRapido) => setFiltro(filtro === f ? '' : f)
  const ROTULO_FILTRO: Record<FiltroRapido, string> = {
    foco: 'que precisam de você hoje (atrasados, para hoje, novos e esquecidos)',
    atrasados: 'com contato atrasado',
    hoje: 'com contato para hoje',
    novos: 'novos esperando',
    esfriando: `sem próximo contato e parados há ${DIAS_ESFRIANDO}+ dias`,
    meta: 'vindos do Meta Ads',
    site: 'vindos do site',
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Kanban de Leads</h1>
          <p className="text-sm text-dark-400">{abertos.length.toLocaleString('pt-BR')} leads em andamento</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => alternar('foco')}
            title="Mostra só o que precisa de você hoje"
            className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold transition-colors ${
              filtro === 'foco' ? 'bg-gold-500 text-white shadow' : 'border border-gold-500/50 text-gold-400 hover:bg-gold-500/10'
            }`}
          >
            <Crosshair size={15} /> Meu dia
          </button>
          <div className="flex items-center rounded-lg border border-dark-600 bg-dark-800 p-0.5">
            {(
              [
                ['quadro', 'Quadro', Columns3],
                ['lista', 'Lista', List],
              ] as const
            ).map(([valor, rotulo, Icone]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setModo(valor)}
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${modo === valor ? 'bg-gold-500 text-white' : 'text-dark-300 hover:text-dark-100'}`}
              >
                <Icone size={14} /> {rotulo}
              </button>
            ))}
          </div>
          <LegendaLeads aoRever={() => setNovidadesVistas(false)} />
          {verTudo && (
            <div className="w-48">
              <Select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                placeholder="Todos os vendedores"
                options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
              />
            </div>
          )}
          <div className="w-56">
            <Input icon={<Search size={14} />} placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
            {Array.from({ length: 7 }, (_, i) => (
              <Esqueleto key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="flex gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Esqueleto key={i} className="h-96 w-72 rounded-xl shrink-0" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {!novidadesVistas && <NovidadesLeads comRanking={verTudo} aoFechar={() => setNovidadesVistas(true)} />}
          {verTudo && !vendorId && <RankingSemana leads={todos} />}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5 mb-3">
            <Indicador icone={Siren} valor={contar('atrasados')} rotulo="Atrasados" dica="Contato marcado para um dia que já passou" cor="#e5534b" ativo={filtro === 'atrasados'} onClick={() => alternar('atrasados')} />
            <Indicador icone={CalendarClock} valor={contar('hoje')} rotulo="Para hoje" dica="Contato marcado para hoje" cor="#f97316" ativo={filtro === 'hoje'} onClick={() => alternar('hoje')} />
            <Indicador icone={Inbox} valor={contar('novos')} rotulo="Novos" dica="Leads na etapa Novo, esperando o primeiro contato" cor="#3987e5" ativo={filtro === 'novos'} onClick={() => alternar('novos')} />
            <Indicador icone={Snowflake} valor={contar('esfriando')} rotulo="Esquecidos" dica={`Em andamento, sem próximo contato marcado e parados há ${DIAS_ESFRIANDO}+ dias`} cor="#38bdf8" ativo={filtro === 'esfriando'} onClick={() => alternar('esfriando')} />
            <Indicador icone={Smartphone} valor={contar('meta')} rotulo="Meta Ads" dica="Vieram dos anúncios do Facebook/Instagram" cor="#a855f7" ativo={filtro === 'meta'} onClick={() => alternar('meta')} />
            <Indicador icone={Globe} valor={contar('site')} rotulo="Site" dica="Vieram do formulário do site" cor="#06b6d4" ativo={filtro === 'site'} onClick={() => alternar('site')} />
            <Indicador
              icone={Trophy}
              valor={ganhosMes}
              rotulo={fechadosMes ? `Ganhos · ${Math.round((ganhosMes / fechadosMes) * 100)}%` : 'Ganhos no mês'}
              dica="Leads ganhos este mês e a conversão (ganhos ÷ ganhos + perdidos no mês)"
              cor="#22a861"
            />
          </div>

          {filtro && (
            <div className="flex items-center gap-2 mb-3 text-sm">
              <span className="text-dark-300">
                Mostrando só <span className="font-semibold text-dark-50">{visiveis.length}</span> {visiveis.length === 1 ? 'lead' : 'leads'} {ROTULO_FILTRO[filtro]}
              </span>
              <button type="button" onClick={() => setFiltro('')} className="inline-flex items-center gap-1 text-xs text-gold-400 hover:underline">
                <X size={12} /> limpar
              </button>
            </div>
          )}

          {modo === 'lista' ? (
            <TabelaLeads leads={visiveis} mostrarVendedor={verTudo} aoAbrir={(id) => navigate(`${basePath}/${id}`)} />
          ) : (
          <LeadKanbanBoard
            empresaNome={empresaAtiva?.nome ?? ''}
            leads={visiveis}
            basePath={basePath}
            empresaSlug={empresaSlug}
            mostrarVendedor={verTudo}
            recolhidas={recolhidas}
            aoAlternarColuna={(s) => setRecolhidas(recolhidas.includes(s) ? recolhidas.filter((x) => x !== s) : [...recolhidas, s])}
          />
          )}
        </>
      )}
    </div>
  )
}
