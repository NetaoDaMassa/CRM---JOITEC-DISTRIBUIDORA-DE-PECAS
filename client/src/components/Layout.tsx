import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import LembretesCompromisso from './LembretesCompromisso'

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-dark-950">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <header className="h-14 border-b border-dark-700 flex items-center justify-end px-6 shrink-0">
          <NotificationBell />
        </header>
        <Outlet />
      </main>
      <LembretesCompromisso />
    </div>
  )
}
