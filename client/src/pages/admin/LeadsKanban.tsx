import { useState } from 'react'
import { Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import LeadKanbanBoard from '../../components/LeadKanbanBoard'

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
  const verTudo = isAdmin || isGestor || !!minhasFeatures?.includes('leads_transferir') || !!minhasFeatures?.includes('leads_excluir')

  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaSlug = empresas?.find((e) => e.id === empresaAtivaId)?.slug

  const [vendorId, setVendorId] = useState('')
  const [search, setSearch] = useState('')
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: verTudo })

  const { data, isLoading } = trpc.leads.list.useQuery({
    vendorId: verTudo && vendorId ? Number(vendorId) : undefined,
    search: search || undefined,
    page: 1,
    pageSize: 500,
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Kanban de Leads</h1>
        <div className="flex items-end gap-3">
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
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <LeadKanbanBoard leads={data?.data ?? []} basePath={basePath} empresaSlug={empresaSlug} mostrarVendedor={verTudo} />
      )}
    </div>
  )
}
