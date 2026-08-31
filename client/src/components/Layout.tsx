import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import LembretesCompromisso from './LembretesCompromisso'

export default function Layout() {
  const [menuAberto, setMenuAberto] = useState(false)
  const location = useLocation()

  // Fecha a gaveta sozinha ao trocar de rota (cinto de segurança — o
  // onNavigate do link já fecha, isso cobre navegação por outros meios,
  // ex: voltar do navegador).
  useEffect(() => setMenuAberto(false), [location.pathname])

  return (
    <div className="flex min-h-screen bg-dark-950">
      <Sidebar open={menuAberto} onClose={() => setMenuAberto(false)} />
      <main className="flex-1 overflow-auto">
        <header className="h-14 border-b border-dark-700 flex items-center justify-between md:justify-end px-4 md:px-6 shrink-0">
          <button
            onClick={() => setMenuAberto(true)}
            className="p-2 -ml-2 rounded-lg text-dark-300 hover:text-dark-100 hover:bg-dark-800 md:hidden"
          >
            <Menu size={20} />
          </button>
          <NotificationBell />
        </header>
        <Outlet />
      </main>
      <LembretesCompromisso />
    </div>
  )
}
