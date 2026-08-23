import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, BarChart3,
  KanbanSquare, List, LogOut, ArrowRightLeft, Trash2, Upload,
  Sun, Moon, Target, Settings, Tv, DatabaseBackup, CalendarDays, MessageSquareText, ListChecks, Megaphone, Landmark, Wrench, Search, CheckSquare, Palette, Wallet, Banknote, Ship, ShieldCheck, Receipt, RotateCcw, Cog, PackageSearch,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { trpc } from '../lib/trpc'

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
]

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

      {user?.superAdmin && empresas && empresas.length > 1 && (
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
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-gold-600/20 text-gold-400 border border-gold-600/30'
                    : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800'
                }`
              }
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
          {user?.role === 'admin' && (user.superAdmin || minhasFeatures?.includes('painel_tv')) && (
            <a
              href="/painel-tv"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-dark-300 hover:text-dark-100 hover:bg-dark-800"
            >
              <Tv size={17} />
              <span className="flex-1">Painel de TV</span>
            </a>
          )}
          {user?.superAdmin && (
            <NavLink
              to="/admin/permissoes"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-gold-600/20 text-gold-400 border border-gold-600/30'
                    : 'text-dark-300 hover:text-dark-100 hover:bg-dark-800'
                }`
              }
            >
              <ShieldCheck size={17} />
              <span className="flex-1">Permissões</span>
            </NavLink>
          )}
          {user?.role === 'admin' && (user.superAdmin || minhasFeatures?.includes('painel_financeiro')) && (
            <a
              href="/painel-financeiro"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-dark-300 hover:text-dark-100 hover:bg-dark-800"
            >
              <Wallet size={17} />
              <span className="flex-1">Painel Financeiro</span>
            </a>
          )}
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
