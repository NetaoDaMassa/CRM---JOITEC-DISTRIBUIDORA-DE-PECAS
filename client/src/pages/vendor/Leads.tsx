import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, AlertCircle, Plus } from 'lucide-react'
import WhatsAppButton from '../../components/ui/WhatsAppButton'
import EmailButton from '../../components/ui/EmailButton'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import QuickLeadCreate from '../../components/QuickLeadCreate'
import { StatusBadge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import { STATUS_LABELS, STATUS_ORDER, formatDate, SEGMENT_LABELS } from '../../lib/utils'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

export default function VendorLeads() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = trpc.leads.list.useQuery({
    search: search || undefined,
    status: (status || undefined) as any,
    page,
    pageSize: 20,
  })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Meus Leads</h1>
          <p className="text-dark-400 text-sm">{data?.total ?? 0} leads</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          Novo Lead
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar por nome, telefone..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            icon={<Search size={14} />}
          />
        </div>
        <div className="w-44">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          />
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-700/50">
                {['', 'Nome', 'Contato', 'Empresa', 'Segmento', 'Status', 'Criado', ''].map((h) => (
                  <th key={h} className="text-left text-dark-400 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-dark-700 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data?.data.map((lead) => (
                    <tr
                      key={lead.id}
                      className="hover:bg-dark-700/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/vendedor/leads/${lead.id}`)}
                    >
                      <td className="px-4 py-3">
                        {lead.requiresAttachment && (
                          <AlertCircle size={14} className="text-yellow-500" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-dark-100 font-medium">{lead.name}</td>
                      <td className="px-4 py-3 text-dark-400">({lead.ddd}) {lead.phone}</td>
                      <td className="px-4 py-3 text-dark-300">{lead.company ?? '—'}</td>
                      <td className="px-4 py-3 text-dark-400 text-xs">{SEGMENT_LABELS[lead.segment ?? ''] ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                      <td className="px-4 py-3 text-dark-500">{formatDate(lead.createdAt)}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          {lead.email && <EmailButton email={lead.email} size="sm" />}
                          <WhatsAppButton ddd={lead.ddd} phone={lead.phone} size="sm" />
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!isLoading && (data?.data.length ?? 0) === 0 && (
            <div className="py-16 text-center text-dark-500">Nenhum lead encontrado</div>
          )}
        </div>
        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-dark-600">
            <span className="text-dark-400 text-sm">Página {page} de {data?.totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm bg-dark-700 border border-dark-600 rounded-lg disabled:opacity-50 hover:bg-dark-600 transition-colors text-dark-200">
                ← Anterior
              </button>
              <button disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm bg-dark-700 border border-dark-600 rounded-lg disabled:opacity-50 hover:bg-dark-600 transition-colors text-dark-200">
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      <QuickLeadCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultVendorId={user?.id}
        vendorLocked
      />
    </div>
  )
}
