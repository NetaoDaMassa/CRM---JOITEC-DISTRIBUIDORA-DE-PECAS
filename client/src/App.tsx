import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'

// Admin pages
import AdminDashboard from './pages/admin/Dashboard'
import AdminLeads from './pages/admin/Leads'
import AdminLeadDetail from './pages/admin/LeadDetail'
import AdminKanban from './pages/admin/Kanban'
import AdminCalendar from './pages/admin/Calendar'
import AdminCampaigns from './pages/admin/Campaigns'
import AdminReports from './pages/admin/Reports'
import AdminUsers from './pages/admin/Users'
import AdminRegions from './pages/admin/Regions'
import AdminSlaDashboard from './pages/admin/SlaDashboard'
import AdminMessageTemplates from './pages/admin/MessageTemplates'

// Vendor pages
import VendorDashboard from './pages/vendor/Dashboard'
import VendorLeads from './pages/vendor/Leads'
import VendorLeadDetail from './pages/vendor/LeadDetail'
import VendorKanban from './pages/vendor/Kanban'
import VendorCalendar from './pages/vendor/Calendar'
import VendorTodayQueue from './pages/vendor/TodayQueue'

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
  if (user?.role !== 'admin') return <Navigate to="/vendedor/fila-hoje" replace />
  return <>{children}</>
}

export default function App() {
  const { user } = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          {/* Admin routes */}
          <Route
            path="admin"
            element={<AdminGuard><AdminDashboard /></AdminGuard>}
          />
          <Route
            path="admin/leads"
            element={<AdminGuard><AdminLeads /></AdminGuard>}
          />
          <Route
            path="admin/leads/:id"
            element={<AdminGuard><AdminLeadDetail /></AdminGuard>}
          />
          <Route
            path="admin/kanban"
            element={<AdminGuard><AdminKanban /></AdminGuard>}
          />
          <Route
            path="admin/calendario"
            element={<AdminGuard><AdminCalendar /></AdminGuard>}
          />
          <Route
            path="admin/campanhas"
            element={<AdminGuard><AdminCampaigns /></AdminGuard>}
          />
          <Route
            path="admin/relatorios"
            element={<AdminGuard><AdminReports /></AdminGuard>}
          />
          <Route
            path="admin/usuarios"
            element={<AdminGuard><AdminUsers /></AdminGuard>}
          />
          <Route
            path="admin/regioes"
            element={<AdminGuard><AdminRegions /></AdminGuard>}
          />
          <Route
            path="admin/sla"
            element={<AdminGuard><AdminSlaDashboard /></AdminGuard>}
          />
          <Route
            path="admin/mensagens"
            element={<AdminGuard><AdminMessageTemplates /></AdminGuard>}
          />

          {/* Vendor routes */}
          <Route path="vendedor" element={<VendorDashboard />} />
          <Route path="vendedor/fila-hoje" element={<VendorTodayQueue />} />
          <Route path="vendedor/leads" element={<VendorLeads />} />
          <Route path="vendedor/leads/:id" element={<VendorLeadDetail />} />
          <Route path="vendedor/kanban" element={<VendorKanban />} />
          <Route path="vendedor/calendario" element={<VendorCalendar />} />

          {/* Default redirect */}
          <Route
            index
            element={
              <Navigate
                to={user?.role === 'admin' ? '/admin' : '/vendedor/fila-hoje'}
                replace
              />
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
