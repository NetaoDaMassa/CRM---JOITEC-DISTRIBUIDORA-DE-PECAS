import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { trpc } from './lib/trpc'
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
import AdminCaixa from './pages/admin/Caixa'
import AdminCompras from './pages/admin/Compras'
import AdminBackup from './pages/admin/Backup'
import AdminMetas from './pages/admin/Metas'
import AdminKanban from './pages/admin/Kanban'
import AdminCalendario from './pages/admin/Calendario'
import AdminPermissoes from './pages/admin/Permissoes'

import VendorDashboard from './pages/vendor/Dashboard'
import VendorKanban from './pages/vendor/Kanban'
import VendorCalendario from './pages/vendor/Calendario'
import FilaHoje from './pages/vendor/FilaHoje'
import SolicitarDesign from './pages/vendor/SolicitarDesign'
import FilaPosVenda from './pages/FilaPosVenda'
import PainelTV from './pages/PainelTV'
import PainelFinanceiro from './pages/PainelFinanceiro'

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

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user?.superAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

// Bloqueia acesso direto por URL a uma página que o admin não tem
// permissão pra ver (o Sidebar já filtra o link, isso cobre quem digita a
// URL na mão). superAdmin sempre passa, sem depender de linha na tabela.
function FeatureGuard({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { user } = useAuth()
  const { data: minhasFeatures, isLoading } = trpc.permissoes.minhasPermissoes.useQuery(undefined, {
    enabled: !!user && user.role === 'admin' && !user.superAdmin,
  })
  if (!user || user.role !== 'admin' || user.superAdmin) return <>{children}</>
  if (isLoading) return null
  if (!minhasFeatures?.includes(feature)) {
    return (
      <div className="p-6 text-center text-dark-400">
        <p>Você não tem permissão pra acessar essa área. Fale com o administrador.</p>
      </div>
    )
  }
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
              <AdminGuard>
                <FeatureGuard feature="painel_tv">
                  <PainelTV />
                </FeatureGuard>
              </AdminGuard>
            </AuthGuard>
          }
        />
        <Route
          path="/painel-financeiro"
          element={
            <AuthGuard>
              <AdminGuard>
                <FeatureGuard feature="painel_financeiro">
                  <PainelFinanceiro />
                </FeatureGuard>
              </AdminGuard>
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
          <Route path="admin" element={<AdminGuard><FeatureGuard feature="dashboard"><AdminDashboard /></FeatureGuard></AdminGuard>} />
          <Route path="admin/kanban" element={<AdminGuard><FeatureGuard feature="kanban"><AdminKanban /></FeatureGuard></AdminGuard>} />
          <Route path="admin/calendario" element={<AdminGuard><FeatureGuard feature="agenda"><AdminCalendario /></FeatureGuard></AdminGuard>} />
          <Route path="admin/clientes" element={<AdminGuard><FeatureGuard feature="clientes"><Clientes /></FeatureGuard></AdminGuard>} />
          <Route path="admin/prospeccao" element={<AdminGuard><FeatureGuard feature="prospeccao"><Prospeccao /></FeatureGuard></AdminGuard>} />
          <Route path="admin/aprovacoes" element={<AdminGuard><FeatureGuard feature="aprovacoes"><AdminAprovacoes /></FeatureGuard></AdminGuard>} />
          <Route path="admin/clientes/novo" element={<AdminGuard><FeatureGuard feature="clientes"><ClienteNovo /></FeatureGuard></AdminGuard>} />
          <Route path="admin/clientes/:id" element={<AdminGuard><FeatureGuard feature="clientes"><ClienteDetail /></FeatureGuard></AdminGuard>} />
          <Route path="admin/carteira" element={<AdminGuard><FeatureGuard feature="carteira"><AdminCarteira /></FeatureGuard></AdminGuard>} />
          <Route path="admin/banco-clientes" element={<AdminGuard><FeatureGuard feature="banco_clientes"><AdminBancoClientes /></FeatureGuard></AdminGuard>} />
          <Route path="admin/importar" element={<AdminGuard><FeatureGuard feature="importar"><AdminImportar /></FeatureGuard></AdminGuard>} />
          <Route path="admin/lixeira" element={<AdminGuard><FeatureGuard feature="lixeira"><AdminLixeira /></FeatureGuard></AdminGuard>} />
          <Route path="admin/relatorios" element={<AdminGuard><FeatureGuard feature="relatorios"><AdminReports /></FeatureGuard></AdminGuard>} />
          <Route path="admin/usuarios" element={<AdminGuard><FeatureGuard feature="usuarios"><AdminUsers /></FeatureGuard></AdminGuard>} />
          <Route path="admin/mensagens" element={<AdminGuard><FeatureGuard feature="mensagens"><AdminMessageTemplates /></FeatureGuard></AdminGuard>} />
          <Route path="admin/configuracoes" element={<AdminGuard><FeatureGuard feature="configuracoes"><AdminConfiguracoes /></FeatureGuard></AdminGuard>} />
          <Route path="admin/caixa" element={<AdminGuard><FeatureGuard feature="caixa"><AdminCaixa /></FeatureGuard></AdminGuard>} />
          <Route path="admin/compras" element={<AdminGuard><FeatureGuard feature="compras"><AdminCompras /></FeatureGuard></AdminGuard>} />
          <Route path="admin/backup" element={<AdminGuard><FeatureGuard feature="backup"><AdminBackup /></FeatureGuard></AdminGuard>} />
          <Route path="admin/metas" element={<AdminGuard><FeatureGuard feature="metas"><AdminMetas /></FeatureGuard></AdminGuard>} />
          <Route path="admin/pos-venda" element={<AdminGuard><FeatureGuard feature="pos_venda"><FilaPosVenda /></FeatureGuard></AdminGuard>} />
          <Route path="admin/permissoes" element={<AdminGuard><SuperAdminGuard><AdminPermissoes /></SuperAdminGuard></AdminGuard>} />

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
          <Route path="vendedor/solicitar-design" element={<SolicitarDesign />} />

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
