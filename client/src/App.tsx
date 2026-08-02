import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import TrocarSenha from './pages/TrocarSenha'
import Clientes from './pages/Clientes'
import ClienteNovo from './pages/ClienteNovo'
import ClienteDetail from './pages/ClienteDetail'
import Prospeccao from './pages/Prospeccao'
import AdminAprovacoes from './pages/admin/Aprovacoes'

import AdminDashboard from './pages/admin/Dashboard'
import AdminUsers from './pages/admin/Users'
import AdminCarteira from './pages/admin/Carteira'
import AdminBancoClientes from './pages/admin/BancoClientes'
import AdminImportar from './pages/admin/Importar'
import AdminLixeira from './pages/admin/Lixeira'
import AdminReports from './pages/admin/Reports'
import AdminMessageTemplates from './pages/admin/MessageTemplates'
import AdminConfiguracoes from './pages/admin/Configuracoes'
import AdminBackup from './pages/admin/Backup'
import AdminMetas from './pages/admin/Metas'
import AdminKanban from './pages/admin/Kanban'
import AdminCalendario from './pages/admin/Calendario'

import VendorDashboard from './pages/vendor/Dashboard'
import VendorKanban from './pages/vendor/Kanban'
import VendorCalendario from './pages/vendor/Calendario'
import FilaHoje from './pages/vendor/FilaHoje'
import FilaPosVenda from './pages/FilaPosVenda'
import PainelTV from './pages/PainelTV'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark-950">
        <div className="text-gold-500 text-xl font-heading">Carregando...</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/vendedor" replace />
  return <>{children}</>
}

export default function App() {
  const { user } = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/trocar-senha" element={<TrocarSenha />} />
        <Route
          path="/painel-tv"
          element={
            <AuthGuard>
              <PainelTV />
            </AuthGuard>
          }
        />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          {/* Admin routes */}
          <Route path="admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
          <Route path="admin/kanban" element={<AdminGuard><AdminKanban /></AdminGuard>} />
          <Route path="admin/calendario" element={<AdminGuard><AdminCalendario /></AdminGuard>} />
          <Route path="admin/clientes" element={<AdminGuard><Clientes /></AdminGuard>} />
          <Route path="admin/prospeccao" element={<AdminGuard><Prospeccao /></AdminGuard>} />
          <Route path="admin/aprovacoes" element={<AdminGuard><AdminAprovacoes /></AdminGuard>} />
          <Route path="admin/clientes/novo" element={<AdminGuard><ClienteNovo /></AdminGuard>} />
          <Route path="admin/clientes/:id" element={<AdminGuard><ClienteDetail /></AdminGuard>} />
          <Route path="admin/carteira" element={<AdminGuard><AdminCarteira /></AdminGuard>} />
          <Route path="admin/banco-clientes" element={<AdminGuard><AdminBancoClientes /></AdminGuard>} />
          <Route path="admin/importar" element={<AdminGuard><AdminImportar /></AdminGuard>} />
          <Route path="admin/lixeira" element={<AdminGuard><AdminLixeira /></AdminGuard>} />
          <Route path="admin/relatorios" element={<AdminGuard><AdminReports /></AdminGuard>} />
          <Route path="admin/usuarios" element={<AdminGuard><AdminUsers /></AdminGuard>} />
          <Route path="admin/mensagens" element={<AdminGuard><AdminMessageTemplates /></AdminGuard>} />
          <Route path="admin/configuracoes" element={<AdminGuard><AdminConfiguracoes /></AdminGuard>} />
          <Route path="admin/backup" element={<AdminGuard><AdminBackup /></AdminGuard>} />
          <Route path="admin/metas" element={<AdminGuard><AdminMetas /></AdminGuard>} />
          <Route path="admin/pos-venda" element={<AdminGuard><FilaPosVenda /></AdminGuard>} />

          {/* Vendor routes */}
          <Route path="vendedor" element={<VendorDashboard />} />
          <Route path="vendedor/fila-hoje" element={<FilaHoje />} />
          <Route path="vendedor/pos-venda" element={<FilaPosVenda />} />
          <Route path="vendedor/kanban" element={<VendorKanban />} />
          <Route path="vendedor/clientes" element={<Clientes />} />
          <Route path="vendedor/prospeccao" element={<Prospeccao />} />
          <Route path="vendedor/clientes/novo" element={<ClienteNovo />} />
          <Route path="vendedor/clientes/:id" element={<ClienteDetail />} />
          <Route path="vendedor/relatorios" element={<AdminReports />} />
          <Route path="vendedor/calendario" element={<VendorCalendario />} />

          <Route
            index
            element={<Navigate to={user?.role === 'admin' ? '/admin' : '/vendedor'} replace />}
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
