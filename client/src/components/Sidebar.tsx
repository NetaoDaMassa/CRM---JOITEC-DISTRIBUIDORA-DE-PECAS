import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  KanbanSquare, List, LogOut, ArrowRightLeft, Trash2, Upload,
  Sun, Moon, Target, Settings, Tv, DatabaseBackup, CalendarDays, MessageSquareText, ListChecks, Megaphone, Landmark, Wrench, Search, CheckSquare, Palette, Wallet, Banknote, Ship, ShieldCheck, Receipt, RotateCcw, Cog, PackageSearch, Briefcase, Contact, MessageCircle, UserCog, Activity, UserPlus, MapPin,
  ChevronDown, ChevronRight, Folder, Layers,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { trpc } from '../lib/trpc'

// Ícones disponíveis pra montar um grupo em "Grupos da Sidebar" — nome
// salvo como texto no banco (sidebarGroups.icone), mapeado pro componente
// aqui. `Folder` é o fallback se algum dia salvar um nome que saia da lista.
export const ICONES_GRUPO: Record<string, LucideIcon> = {
  Folder, Megaphone, Ship, Wrench, Banknote, Briefcase, RotateCcw, Users, Target, Palette, UserPlus, Landmark, Activity, Layers, Wallet,
}
export const NOMES_ICONES_GRUPO = Object.keys(ICONES_GRUPO)

// CRM de marketing do Grupo Odin (sistema à parte, fora deste projeto) — o
// vendedor usa pra atender os leads que chegam por marketing. Link externo
// mesmo, sem nada embutido aqui.
const MARKETING_URL = 'https://crm-odin.duckdns.org/login'

// Joitec Automação é uma divisão da mesma marca Joitec — reaproveita a logo
// padrão, sem arte própria (confirmado com o João).
const LOGO_POR_EMPRESA: Record<string, string> = {
  joitec: '/logos/joitec-sidebar.png',
  'joitec-automacao': '/logos/joitec-sidebar.png',
  'odin-tubos': '/logos/odin-tubos-sidebar.png',
}

// Pós-venda por horas de filtro (ar/óleo) só faz sentido pro modelo de
// negócio da Odin Compressores (revenda que já comprou compressor) — as
// outras empresas não têm essa tela.
const SO_ODIN_COMPRESSORES = 'odin-compressores'
// Faturamento Geral (Fechado/Faturamento de todos os vendedores num board
// só) só existe pra Compretec Loja Física — é a única empresa com etapa
// "Faturamento" no funil.
const SO_COMPRETEC_LOJA_FISICA = 'compretec-loja-fisica'
// Devolução (módulo portado do sistema separado) só atende essas 4 empresas
// — as mesmas do sistema original (Joitec, Odin Tubos, Odin Compressores,
// Compretec Loja Física). As demais (Joitec Automação, Compretec
// E-commerce) nunca usaram esse fluxo.
const EMPRESAS_DEVOLUCAO = ['joitec', 'odin-tubos', 'odin-compressores', 'compretec-loja-fisica']
// Mesma lista de SLUGS_COM_ANALYTICS_MARKETING em server/src/router/integracoes.ts
// — só essas 3 empresas têm o tracker do CRM de marketing instalado no site.
const EMPRESAS_ANALYTICS_MARKETING = ['joitec', 'odin-tubos', 'odin-compressores']

// `feature` é a chave usada em permissoesAdmin/FEATURES_ADMIN (server) —
// controla quem vê cada item pra admins não-superAdmin.
export const ADMIN_LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, feature: 'dashboard' },
  { to: '/admin/kanban', label: 'Kanban', icon: KanbanSquare, feature: 'kanban' },
  { to: '/admin/pos-venda', label: 'Fila de Pós-venda', icon: Wrench, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pos_venda' },
  { to: '/admin/calendario', label: 'Agenda', icon: CalendarDays, feature: 'agenda' },
  { to: '/admin/clientes', label: 'Clientes', icon: List, feature: 'clientes' },
  { to: '/admin/prospeccao', label: 'Prospecção', icon: Search, ocultoEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao' },
  { to: '/admin/aprovacoes', label: 'Aprovações', icon: CheckSquare, feature: 'aprovacoes' },
  { to: '/admin/carteira', label: 'Carteira', icon: ArrowRightLeft, feature: 'carteira' },
  { to: '/admin/banco-clientes', label: 'Banco de Clientes', icon: Landmark, feature: 'banco_clientes' },
  { to: '/admin/importar', label: 'Importar', icon: Upload, feature: 'importar' },
  { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3, feature: 'relatorios' },
  { to: '/admin/usuarios', label: 'Vendedores', icon: Users, feature: 'usuarios' },
  { to: '/admin/metas', label: 'Metas', icon: Target, feature: 'metas' },
  { to: '/admin/mensagens', label: 'Mensagens', icon: MessageSquareText, feature: 'mensagens' },
  { to: '/admin/caixa', label: 'Caixa', icon: Banknote, feature: 'caixa' },
  { to: '/admin/compras', label: 'Compras', icon: Ship, feature: 'compras' },
  { to: '/admin/lixeira', label: 'Lixeira', icon: Trash2, feature: 'lixeira' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings, feature: 'configuracoes' },
  { to: '/admin/backup', label: 'Backup', icon: DatabaseBackup, feature: 'backup' },
  { to: '/admin/devolucoes', label: 'Devolução', icon: RotateCcw, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes' },
  { to: '/admin/devolucoes-mecanica', label: 'Mecânica (Devolução)', icon: Cog, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes_mecanica' },
  { to: '/admin/devolucoes-demonstracao', label: 'Demonstração', icon: PackageSearch, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes_demonstracao' },
  { to: '/admin/devolucoes-relatorios', label: 'Relatórios (Devolução)', icon: BarChart3, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes' },
  // RH — vagas/candidatos/mensagens, portado do CRM-GRUPO-ODIN.
  { to: '/admin/vagas', label: 'Vagas', icon: Briefcase, feature: 'vagas' },
  { to: '/admin/candidatos', label: 'Candidatos', icon: Contact, feature: 'candidatos' },
  { to: '/admin/mensagens-rh', label: 'Mensagens (RH)', icon: MessageCircle, feature: 'mensagens_rh' },
  { to: '/admin/analytics', label: 'Analytics', icon: Activity, somenteEmpresas: EMPRESAS_ANALYTICS_MARKETING, feature: 'marketing_analytics' },
  // Módulo de Leads (site) — portado do CRM-GRUPO-ODIN, fase 1 do plano em
  // .claude/plans/stateful-soaring-moore.md.
  { to: '/admin/leads', label: 'Leads', icon: UserPlus, feature: 'leads' },
  { to: '/admin/leads/kanban', label: 'Kanban de Leads', icon: KanbanSquare, feature: 'leads' },
  { to: '/admin/leads-desqualificados', label: 'Revisão de Leads', icon: ShieldCheck, feature: 'leads' },
  { to: '/admin/leads-relatorios', label: 'Relatórios de Leads', icon: BarChart3, feature: 'leads' },
]

// Mesma ideia do ADMIN_LINKS acima — `feature` é a chave em permissoesAdmin,
// controla quem vê cada item. Reaproveita as MESMAS chaves do admin quando
// faz sentido (ex: 'banco_clientes') — a tabela não distingue role, só
// (userId, feature), então liberar 'banco_clientes' pra um vendedor dá
// acesso à mesma tela que o admin usa (rota própria, ver App.tsx).
export const VENDOR_LINKS = [
  { to: '/vendedor', label: 'Meu Painel', icon: LayoutDashboard, end: true, feature: 'meu_painel' },
  { to: '/vendedor/fila-hoje', label: 'Fila de Hoje', icon: ListChecks, feature: 'fila_hoje' },
  { to: '/vendedor/pos-venda', label: 'Fila de Pós-venda', icon: Wrench, somenteEmpresa: SO_ODIN_COMPRESSORES, feature: 'pos_venda' },
  { to: '/vendedor/kanban', label: 'Kanban', icon: KanbanSquare, feature: 'kanban' },
  { to: '/vendedor/calendario', label: 'Minha Agenda', icon: CalendarDays, feature: 'agenda' },
  { to: '/vendedor/clientes', label: 'Meus Clientes', icon: List, feature: 'clientes' },
  { to: '/vendedor/prospeccao', label: 'Prospecção', icon: Search, ocultoEmpresa: SO_ODIN_COMPRESSORES, feature: 'prospeccao' },
  { to: '/vendedor/banco-clientes', label: 'Banco de Clientes', icon: Landmark, feature: 'banco_clientes' },
  {
    to: '/vendedor/faturamento-geral',
    label: 'Faturamento Geral',
    icon: Receipt,
    somenteEmpresa: SO_COMPRETEC_LOJA_FISICA,
    feature: 'faturamento_geral',
  },
  // Mesma chave 'relatorios' do admin (controla o link aparecer ou não) —
  // dentro da página, os relatorio_* controlam aba por aba, igual antes.
  { to: '/vendedor/relatorios', label: 'Relatórios', icon: BarChart3, feature: 'relatorios' },
  { to: '/vendedor/solicitar-design', label: 'Solicitar Arte', icon: Palette, feature: 'solicitar_design' },
  { to: '/vendedor/devolucoes', label: 'Devolução', icon: RotateCcw, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes' },
  { to: '/vendedor/devolucoes-mecanica', label: 'Mecânica (Devolução)', icon: Cog, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes_mecanica' },
  { to: '/vendedor/devolucoes-demonstracao', label: 'Demonstração', icon: PackageSearch, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes_demonstracao' },
  { to: '/vendedor/devolucoes-relatorios', label: 'Relatórios (Devolução)', icon: BarChart3, somenteEmpresas: EMPRESAS_DEVOLUCAO, feature: 'devolucoes' },
  { to: '/vendedor/leads', label: 'Leads', icon: UserPlus, feature: 'leads' },
  { to: '/vendedor/leads/kanban', label: 'Kanban de Leads', icon: KanbanSquare, feature: 'leads' },
]

// Uma linha da sidebar (link normal ou externo em nova aba) — usado tanto
// solto quanto dentro de um grupo aberto, mesmo visual dos dois jeitos.
function SidebarItemLink({ to, label, icon: Icon, end, external }: { to: string; label: string; icon: LucideIcon; end?: boolean; external?: boolean }) {
  const className = "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-dark-300 hover:text-dark-100 hover:bg-dark-800"
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={className}>
        <Icon size={17} />
        <span className="flex-1">{label}</span>
      </a>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
          isActive ? 'bg-gold-600/20 text-gold-400 border border-gold-600/30' : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800'
        }`
      }
    >
      <Icon size={17} />
      <span className="flex-1">{label}</span>
    </NavLink>
  )
}

export default function Sidebar() {
  const { user, logout, empresaAtivaId, trocarEmpresa, login } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  // Contas vinculadas (mesma pessoa, outra empresa — ex: Sergio em Joitec e
  // em Odin Tubos) — vem vazio pra quem não tem nenhuma, sem custo extra.
  const { data: contasVinculadas } = trpc.auth.minhasContasVinculadas.useQuery(undefined, { enabled: !!user && !user.superAdmin })
  const trocarContaMut = trpc.auth.trocarConta.useMutation({
    onSuccess(data) {
      login(data.token, data.user as any)
      window.location.reload()
    },
  })

  // Pra superAdmin devolve todas as empresas (seletor de troca); pra
  // qualquer outro usuário devolve só a própria (só pra mostrar o nome dela
  // aqui em cima, sem seletor).
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaAtiva = empresas?.find((e) => e.id === empresaAtivaId)
  const logoEmpresa = empresaAtiva ? LOGO_POR_EMPRESA[empresaAtiva.slug] : undefined

  // superAdmin sempre vê tudo, sem depender da query — evita a Sidebar
  // "piscar" vazia pro João enquanto minhasPermissoes ainda carrega.
  // Vendedor também usa essa query agora, só pra saber se ainda tem alguma
  // aba de relatório liberada (ver filtro de VENDOR_LINKS abaixo).
  const { data: minhasFeatures } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && (user.role === 'vendor' || (user.role === 'admin' && !user.superAdmin)),
  })

  // Mesma regra pros dois papéis agora: superAdmin sempre vê tudo; qualquer
  // outro (admin ou vendedor) precisa ter a `feature` do item liberada em
  // Permissões.
  const links = (user?.role === 'admin' ? ADMIN_LINKS : VENDOR_LINKS).filter(
    (l) =>
      (!l.somenteEmpresa || l.somenteEmpresa === empresaAtiva?.slug) &&
      (!('somenteEmpresas' in l) || !l.somenteEmpresas || l.somenteEmpresas.includes(empresaAtiva?.slug ?? '')) &&
      (!l.ocultoEmpresa || l.ocultoEmpresa !== empresaAtiva?.slug) &&
      (user?.superAdmin || !!minhasFeatures?.includes(l.feature))
  )

  // Os 5 itens que sempre ficaram soltos, fora de ADMIN_LINKS/VENDOR_LINKS
  // (regra de visibilidade própria de cada um, não é `feature` normal) —
  // reunidos aqui numa forma comum (to/label/icon/external) pra poderem
  // entrar em "Grupos da Sidebar" igual qualquer outro item. "Marketing"
  // fica de fora de propósito (não tem `to` próprio, é sempre visível,
  // continua solto no fim como sempre foi).
  const extras: { to: string; label: string; icon: LucideIcon; external?: boolean; visivel: boolean }[] = [
    { to: '/painel-tv', label: 'Painel de TV', icon: Tv, external: true, visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_tv')) },
    { to: '/admin/permissoes', label: 'Permissões', icon: ShieldCheck, visivel: !!user?.superAdmin },
    { to: '/admin/funcoes', label: 'Funções', icon: UserCog, visivel: !!user?.superAdmin },
    { to: '/admin/leads-regioes', label: 'Regiões de Leads', icon: MapPin, visivel: !!user?.superAdmin },
    { to: '/admin/sidebar-grupos', label: 'Grupos da Sidebar', icon: Layers, visivel: !!user?.superAdmin },
    { to: '/painel-financeiro', label: 'Painel Financeiro', icon: Wallet, external: true, visivel: user?.role === 'admin' && !!(user.superAdmin || minhasFeatures?.includes('painel_financeiro')) },
  ]

  // Lista combinada (links normais + extras visíveis) na forma comum que os
  // grupos usam pra saber o que agrupar. Ordem original preservada — quem
  // não entrar em nenhum grupo continua aparecendo solto nessa mesma ordem.
  const todosItensVisiveis: { to: string; label: string; icon: LucideIcon; end?: boolean; external?: boolean }[] = [
    ...links.map((l) => ({ to: l.to, label: l.label, icon: l.icon, end: 'end' in l ? l.end : undefined })),
    ...extras.filter((e) => e.visivel).map((e) => ({ to: e.to, label: e.label, icon: e.icon, external: e.external })),
  ]
  const itemPorTo = new Map(todosItensVisiveis.map((item) => [item.to, item]))

  // Grupos configurados em "Grupos da Sidebar" — globais, valem pra todo
  // mundo (não só quem configurou). Um grupo só aparece se sobrar pelo
  // menos 1 item visível pro usuário/empresa atual dentro dele.
  const { data: grupos } = trpc.sidebarGrupos.listar.useQuery(undefined, { enabled: !!user })
  const idsAgrupados = new Set(grupos?.flatMap((g) => g.itens) ?? [])
  const itensSoltos = todosItensVisiveis.filter((item) => !idsAgrupados.has(item.to))

  const [gruposAbertos, setGruposAbertos] = useState<Record<number, boolean>>({})
  function grupoEstaAberto(groupId: number) {
    if (groupId in gruposAbertos) return gruposAbertos[groupId]
    try {
      return localStorage.getItem(`sidebar_grupo_aberto_${groupId}`) === '1'
    } catch {
      return false
    }
  }
  function alternarGrupo(groupId: number) {
    const novoEstado = !grupoEstaAberto(groupId)
    setGruposAbertos((prev) => ({ ...prev, [groupId]: novoEstado }))
    try {
      localStorage.setItem(`sidebar_grupo_aberto_${groupId}`, novoEstado ? '1' : '0')
    } catch {
      // localStorage indisponível (modo privado etc.) — só não persiste entre sessões.
    }
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-64 shrink-0 bg-dark-900 border-r border-dark-700 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-dark-700">
        {logoEmpresa ? (
          <div className="bg-white rounded-xl px-3 py-2.5 flex items-center justify-center">
            <img src={logoEmpresa} alt={empresaAtiva?.nome ?? 'Logo da empresa'} className="h-9 w-auto object-contain" />
          </div>
        ) : (
          <p className="font-heading text-gold-400 font-bold text-lg">CRM</p>
        )}
        <p className="text-xs text-dark-400 truncate mt-2 text-center">{empresaAtiva?.nome ?? '...'}</p>
      </div>

      {/* superAdmin sempre vê o seletor (acessa qualquer empresa); admin
          comum só vê se tiver empresas extras concedidas (ver Permissões >
          Empresas extras) — nesse caso `empresas` já vem com mais de 1 linha
          da própria query, sem precisar de nenhum flag adicional aqui. */}
      {(user?.superAdmin || user?.role === 'admin') && empresas && empresas.length > 1 && (
        <div className="px-4 pt-3">
          <label className="text-xs text-dark-500 block mb-1">Empresa</label>
          <select
            value={empresaAtivaId ?? ''}
            onChange={(e) => trocarEmpresa(Number(e.target.value))}
            className="w-full bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 px-2 py-1.5"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {!user?.superAdmin && !!contasVinculadas?.length && (
        <div className="px-4 pt-3">
          <label className="text-xs text-dark-500 block mb-1">Trocar empresa</label>
          <select
            value=""
            disabled={trocarContaMut.isPending}
            onChange={(e) => {
              const contaId = Number(e.target.value)
              if (contaId) trocarContaMut.mutate({ contaId })
            }}
            className="w-full bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 px-2 py-1.5"
          >
            <option value="">{empresaAtiva?.nome ?? '...'} (atual)</option>
            {contasVinculadas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.empresaNome}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1">
          {grupos?.map((grupo) => {
            const itensDoGrupo = grupo.itens.map((to) => itemPorTo.get(to)).filter((i): i is NonNullable<typeof i> => !!i)
            if (itensDoGrupo.length === 0) return null
            const GrupoIcon = ICONES_GRUPO[grupo.icone] ?? Folder
            const aberto = grupoEstaAberto(grupo.id)
            return (
              <div key={grupo.id}>
                <button
                  onClick={() => alternarGrupo(grupo.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-dark-300 hover:text-dark-100 hover:bg-dark-800"
                >
                  <GrupoIcon size={17} />
                  <span className="flex-1 text-left">{grupo.nome}</span>
                  {aberto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {aberto && (
                  <div className="pl-4 space-y-1 mt-1">
                    {itensDoGrupo.map((item) => (
                      <SidebarItemLink key={item.to} {...item} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {itensSoltos.map((item) => (
            <SidebarItemLink key={item.to} {...item} />
          ))}

          <a
            href={MARKETING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-dark-300 hover:text-dark-100 hover:bg-dark-800"
          >
            <Megaphone size={17} />
            <span className="flex-1">Marketing</span>
          </a>
        </div>
      </nav>

      <div className="px-4 py-4 border-t border-dark-700">
        <div className="flex items-center gap-3 px-2 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gold-700/30 border border-gold-600/30 flex items-center justify-center text-gold-400 text-xs font-semibold">
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-dark-100 font-medium truncate">{user?.name}</div>
            <div className="text-xs text-dark-400 capitalize">
              {user?.role === 'admin' ? 'Administrador' : 'Vendedor'}
            </div>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-dark-400 hover:text-gold-400 hover:bg-dark-800 transition-all mb-1"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-dark-400 hover:text-red-400 hover:bg-red-900/20 transition-all"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </aside>
  )
}
