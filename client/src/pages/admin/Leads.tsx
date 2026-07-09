import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Trash2, ArrowRightLeft, Filter } from 'lucide-react'
import WhatsAppButton from '../../components/ui/WhatsAppButton'
import EmailButton from '../../components/ui/EmailButton'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import { StatusBadge } from '../../components/ui/Badge'
import QuickLeadCreate from '../../components/QuickLeadCreate'
import { STATUS_LABELS, STATUS_ORDER, formatDate, timeAgo, SEGMENT_LABELS } from '../../lib/utils'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

export default function AdminLeads() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [transferId, setTransferId] = useState<number | null>(null)
  const [transferTo, setTransferTo] = useState('')
  const [cleanupModal, setCleanupModal] = useState(false)
  const [cleanupVendorId, setCleanupVendorId] = useState('')

  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.leads.list.useQuery({
    search: search || undefined,
    status: (status || undefined) as any,
    vendorId: vendorId ? parseInt(vendorId) : undefined,
    page,
    pageSize: 20,
  })

  const { data: vendors } = trpc.users.vendors.useQuery()

  const deleteMut = trpc.leads.delete.useMutation({
    onSuccess() {
      toast.success('Lead excluído')
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      setDeleteId(null)
    },
  })

  const deleteAllMut = trpc.leads.deleteAll.useMutation({
    onSuccess() {
      toast.success('Leads excluídos com sucesso')
      utils.leads.list.invalidate()
      utils.leads.stats.invalidate()
      setCleanupModal(false)
    },
  })

  const transferMut = trpc.leads.transfer.useMutation({
    onSuccess() {
      toast.success('Lead transferido com sucesso')
      utils.leads.list.invalidate()
      setTransferId(null)
      setTransferTo('')
    },
  })

  const vendorOptions = [
    { value: '', label: 'Todos os vendedores' },
    ...(vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []),
  ]

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Leads</h1>
          <p className="text-dark-400 text-sm">{data?.total ?? 0} leads encontrados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" onClick={() => setCleanupModal(true)}>
            <Trash2 size={14} />
            Limpeza
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Novo Lead
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
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
        <div className="w-48">
          <Select
            options={vendorOptions}
            value={vendorId}
            onChange={(e) => { setVendorId(e.target.value); setPage(1) }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-700/50">
                {['Nome', 'Contato', 'Empresa', 'Segmento', 'Status', 'Vendedor', 'Criado', 'Ações'].map((h) => (
                  <th key={h} className="text-left text-dark-400 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-dark-700 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data?.data.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="hover:bg-dark-700/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/admin/leads/${lead.id}`)}
                    >
                      <td className="px-4 py-3 text-dark-100 font-medium max-w-[160px] truncate">{lead.name}</td>
                      <td className="px-4 py-3 text-dark-400">({lead.ddd}) {lead.phone}</td>
                      <td className="px-4 py-3 text-dark-300 max-w-[130px] truncate">{lead.company ?? '—'}</td>
                      <td className="px-4 py-3 text-dark-400 text-xs">{SEGMENT_LABELS[lead.segment ?? ''] ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                      <td className="px-4 py-3 text-dark-300">{lead.vendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-dark-500">{formatDate(lead.createdAt)}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          {lead.email && <EmailButton email={lead.email} size="sm" />}
                          <WhatsAppButton ddd={lead.ddd} phone={lead.phone} size="sm" />
                          <button
                            className="p-1.5 rounded-lg hover:bg-blue-900/30 text-dark-400 hover:text-blue-400 transition-colors"
                            title="Transferir"
                            onClick={() => setTransferId(lead.id)}
                          >
                            <ArrowRightLeft size={14} />
                          </button>
                          <button
                            className="p-1.5 rounded-lg hover:bg-red-900/30 text-dark-500 hover:text-red-400 transition-colors"
                            title="Excluir"
                            onClick={() => setDeleteId(lead.id)}
                          >
                            <Trash2 size={14} />
                          </button>
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

        {/* Pagination */}
        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-dark-600">
            <span className="text-dark-400 text-sm">
              Página {page} de {data?.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← Anterior
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(p => p + 1)}>
                Próxima →
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Confirmar Exclusão" size="sm">
        <p className="text-dark-300 mb-6">Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteId(null)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={deleteMut.isPending} onClick={() => deleteId && deleteMut.mutate({ id: deleteId })}>
            Excluir
          </Button>
        </div>
      </Modal>

      {/* Transfer modal */}
      <Modal open={!!transferId} onClose={() => setTransferId(null)} title="Transferir Lead" size="sm">
        <div className="space-y-4">
          <Select
            label="Novo vendedor"
            options={vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []}
            placeholder="Selecione..."
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
          />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setTransferId(null)}>Cancelar</Button>
            <Button className="flex-1" loading={transferMut.isPending} disabled={!transferTo}
              onClick={() => transferId && transferTo && transferMut.mutate({ leadId: transferId, newVendorId: parseInt(transferTo) })}>
              Transferir
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cleanup modal */}
      <Modal open={cleanupModal} onClose={() => setCleanupModal(false)} title="Limpeza em Massa" size="sm">
        <div className="space-y-4">
          <p className="text-dark-300 text-sm">Selecione um vendedor para excluir apenas seus leads, ou deixe em branco para excluir TODOS os leads do sistema.</p>
          <Select
            label="Vendedor (opcional)"
            options={vendors?.map((v) => ({ value: v.id.toString(), label: v.name })) ?? []}
            placeholder="Todos os leads do sistema"
            value={cleanupVendorId}
            onChange={(e) => setCleanupVendorId(e.target.value)}
          />
          <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl">
            <p className="text-red-400 text-xs">⚠️ Esta ação é irreversível. Todos os leads, notas e histórico serão excluídos.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setCleanupModal(false)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={deleteAllMut.isPending}
              onClick={() => deleteAllMut.mutate({ vendorId: cleanupVendorId ? parseInt(cleanupVendorId) : undefined })}>
              Confirmar Exclusão
            </Button>
          </div>
        </div>
      </Modal>

      <QuickLeadCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
