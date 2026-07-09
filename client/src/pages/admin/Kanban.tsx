import { useState } from 'react'
import { Plus, Filter } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import KanbanBoard from '../../components/KanbanBoard'
import QuickLeadCreate from '../../components/QuickLeadCreate'

export default function AdminKanban() {
  const [createOpen, setCreateOpen] = useState(false)
  const [vendorId, setVendorId] = useState('')

  const { data, isLoading } = trpc.leads.list.useQuery({ page: 1, pageSize: 500,
    vendorId: vendorId ? parseInt(vendorId) : undefined })
  const { data: vendors } = trpc.users.vendors.useQuery()

  const vendorOptions = [
    { value: '', label: 'Todos os vendedores' },
    ...(vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []),
  ]

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Kanban</h1>
          <p className="text-dark-400 text-sm">{data?.total ?? 0} leads · visão por colunas</p>
        </div>
        <div className="flex gap-3">
          <div className="w-48">
            <Select options={vendorOptions} value={vendorId} onChange={(e) => setVendorId(e.target.value)} />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />Novo Lead
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-72 shrink-0">
              <div className="h-8 bg-dark-800 rounded-lg mb-3 animate-pulse" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-24 bg-dark-800 rounded-xl animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <KanbanBoard leads={data?.data ?? []} isAdmin={true} basePath="/admin" />
      )}

      <QuickLeadCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
