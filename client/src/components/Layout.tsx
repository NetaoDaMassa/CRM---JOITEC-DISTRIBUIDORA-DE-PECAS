import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, Home, KanbanSquare, Users, CalendarDays, BarChart3 } from 'lucide-react'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import ChatPopup from './ChatPopup'
import ChatFloatingButton from './ChatFloatingButton'
import LembretesCompromisso from './LembretesCompromisso'
import BuscaRapida, { BotaoBuscaRapida } from './BuscaRapida'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../lib/trpc'

// Cor de destaque de cada empresa (design novo, teste) — ver
// html[data-empresa] no index.css. Fica no <html> pra valer no app todo.
function useCorDaEmpresa() {
  const { user, empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresa = empresas?.find((e) => e.id === empresaAtivaId)
  useEffect(() => {
    if (empresa?.slug) document.documentElement.dataset.empresa = empresa.slug
    return () => {
      delete document.documentElement.dataset.empresa
    }
  }, [empresa?.slug])
  return empresa
}

function MenuCelular({ abrirMenu }: { abrirMenu: () => void }) {
  const { user } = useAuth()
  const base = user?.role === 'admin' ? '/admin' : '/vendedor'
  const itens =
    user?.role === 'admin'
      ? [
          { to: '/admin', label: 'Início', icon: Home, end: true },
          { to: '/admin/kanban', label: 'Kanban', icon: KanbanSquare },
          { to: '/admin/clientes', label: 'Clientes', icon: Users },
          { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3 },
        ]
      : [
          { to: base, label: 'Início', icon: Home, end: true },
          { to: `${base}/kanban`, label: 'Kanban', icon: KanbanSquare },
          { to: `${base}/clientes`, label: 'Clientes', icon: Users },
          { to: `${base}/calendario`, label: 'Agenda', icon: CalendarDays },
        ]
  return (
    <nav className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-40 border-t border-dark-700 bg-dark-900/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-5">
        {itens.map(({ to, label, icon: Icone, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${isActive ? 'text-gold-400' : 'text-dark-400'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`px-4 py-1 rounded-full transition-colors ${isActive ? 'bg-gold-500/15' : ''}`}>
                  <Icone size={20} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={abrirMenu} className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-dark-400">
          <span className="px-4 py-1">
            <Menu size={20} />
          </span>
          Menu
        </button>
      </div>
    </nav>
  )
}

export default function Layout() {
  const [menuAberto, setMenuAberto] = useState(false)
  const location = useLocation()
  const empresa = useCorDaEmpresa()

  // Fecha a gaveta sozinha ao trocar de rota (cinto de segurança — o
  // onNavigate do link já fecha, isso cobre navegação por outros meios,
  // ex: voltar do navegador).
  useEffect(() => setMenuAberto(false), [location.pathname])

  return (
    <div className="flex min-h-screen bg-dark-950 print:block print:min-h-0">
      {/* print:hidden — exportar relatório em PDF imprime só o conteúdo. */}
      <div className="contents print:hidden">
        <Sidebar open={menuAberto} onClose={() => setMenuAberto(false)} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto print:overflow-visible pb-20 md:pb-0">
        <header className="print:hidden sticky top-0 z-30 h-14 border-b border-dark-700 bg-dark-950/85 backdrop-blur-md flex items-center justify-between gap-3 px-4 md:px-6 shrink-0">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-gold-400 via-gold-500/60 to-transparent" />
          <button
            onClick={() => setMenuAberto(true)}
            className="p-2 -ml-2 rounded-lg text-dark-300 hover:text-dark-100 hover:bg-dark-800 md:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            {empresa && (
              <span className="hidden lg:flex items-center gap-2 text-xs font-semibold text-dark-300 truncate">
                <span className="w-2 h-2 rounded-full bg-gold-400 ring-4 ring-gold-400/15" />
                {empresa.nome}
              </span>
            )}
            <BotaoBuscaRapida />
          </div>
          <div className="flex items-center gap-1">
            <ChatPopup />
            <NotificationBell />
          </div>
        </header>
        <Outlet />
      </main>
      <div className="contents print:hidden">
        <ChatFloatingButton />
        <LembretesCompromisso />
        <MenuCelular abrirMenu={() => setMenuAberto(true)} />
        <BuscaRapida />
      </div>
    </div>
  )
}
