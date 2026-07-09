import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, MapPin, BarChart3,
  KanbanSquare, List, LogOut, CalendarDays, Megaphone, AlarmClock, AlertTriangle, MessageSquareText,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { trpc } from '../lib/trpc'

const ADMIN_LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/leads', label: 'Leads', icon: List },
  { to: '/admin/kanban', label: 'Kanban', icon: KanbanSquare },
  { to: '/admin/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/admin/sla', label: 'SLA Abordagem', icon: AlertTriangle },
  { to: '/admin/campanhas', label: 'Campanhas', icon: Megaphone },
  { to: '/admin/mensagens', label: 'Mensagens', icon: MessageSquareText },
  { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/admin/usuarios', label: 'Vendedores', icon: Users },
  { to: '/admin/regioes', label: 'Regiões & Rodízio', icon: MapPin },
]

const VENDOR_LINKS = [
  { to: '/vendedor/fila-hoje', label: 'Fila de Hoje', icon: AlarmClock, end: true },
  { to: '/vendedor', label: 'Meu Painel', icon: LayoutDashboard, end: true },
  { to: '/vendedor/leads', label: 'Meus Leads', icon: List },
  { to: '/vendedor/kanban', label: 'Kanban', icon: KanbanSquare },
  { to: '/vendedor/calendario', label: 'Calendário', icon: CalendarDays },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const links = user?.role === 'admin' ? ADMIN_LINKS : VENDOR_LINKS

  const { data: slaCritical } = trpc.leads.slaCriticalCount.useQuery(undefined, {
    enabled: user?.role === 'vendor',
    refetchInterval: 60000,
  })

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-64 shrink-0 bg-dark-900 border-r border-dark-700 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-dark-700">
        <div
          className="rounded-xl px-3 py-2 flex items-center justify-center"
          style={{ background: '#fef8eb' }}
        >
          <img
            src="/odin-logo.png"
            alt="Odin CRM"
            className="h-10 w-auto object-contain"
          />
        </div>
      </div>

      {/* Navigation */}
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
              {to === '/vendedor/fila-hoje' && !!slaCritical?.count && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                  {slaCritical.count}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* User info + Logout */}
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
            <div className="text-[11px] text-gold-500/80 truncate">{user?.companyName}</div>
          </div>
        </div>
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
