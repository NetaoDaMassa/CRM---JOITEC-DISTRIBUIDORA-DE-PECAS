import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, ArrowRightLeft, Trash2, KanbanSquare, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { timeAgo } from '../../lib/utils'
import QuickLeadCreate from '../../components/QuickLeadCreate'
import LeadNegotiationTagPicker from '../../components/LeadNegotiationTagPicker'
import { LEAD_STATUS_VALUES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, isLeadStatusAllowedForEmpresa } from '../../lib/leadsShared'

// Tela núcleo do módulo de Leads (site) — lista com filtros. Mesma página
// serve admin (`/admin/leads`) e vendedor (`/vendedor/leads`, ver rota em
// App.tsx) — o backend já restringe vendedor aos próprios leads, aqui só
// escondemos as ações de admin (filtro de vendedor, transferir, excluir).
export default function Leads() {
  const { user, empresaAtivaId } = useAuth()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const isAdmin = user?.role === 'admin'
  const basePath = isAdmin ? '/admin/leads' : '/vendedor/leads'

  const { data: empresas } = trpc.empresas.list.useQuery(undefined, { enabled: !!user })
  const empresaSlug = empresas?.find((e) => e.id === empresaAtivaId)?.slug

  const [status, setStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [transferLead, setTransferLead] = useState<{ id: number; name: string } | null>(null)
  const [deleteLead, setDeleteLead] = useState<{ id: number; name: string } | null>(null)

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })

  const { data, isLoading } = trpc.leads.list.useQuery({
    status: (status || undefined) as any,
    vendorId: isAdmin && vendorId ? Number(vendorId) : undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 30,
  })

  const deleteMut = trpc.leads.delete.useMutation({
    onSuccess() {
      toast.success('Lead excluído')
      utils.leads.list.invalidate()
      setDeleteLead(null)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Leads</h1>
          <p className="text-sm text-dark-400 mt-0.5">{data?.total ?? 0} lead(s) encontrados</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="secondary" onClick={() => navigate('/admin/leads-desqualificados')}>
              <ShieldAlert size={16} />
              Revisão
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate(`${basePath}/kanban`)}>
            <KanbanSquare size={16} />
            Kanban
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Novo lead
          </Button>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label="Etapa"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            placeholder="Todas"
            options={LEAD_STATUS_VALUES.filter((s) => isLeadStatusAllowedForEmpresa(s, empresaSlug)).map((s) => ({
              value: s,
              label: LEAD_STATUS_LABELS[s],
            }))}
          />
        </div>
        {isAdmin && (
          <div className="w-48">
            <Select
              label="Vendedor"
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value)
                setPage(1)
              }}
              placeholder="Todos"
              options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        )}
        <div className="w-56">
          <Input
            label="Buscar"
            icon={<Search size={14} />}
            placeholder="Nome, telefone, empresa..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Input label="De" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="Até" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-dark-400 text-sm">Carregando...</div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-12 text-center text-dark-400 text-sm">Nenhum lead encontrado.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-900/40">
                <th className="text-left text-dark-400 font-medium px-5 py-3">Lead</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Etapa</th>
                {isAdmin && <th className="text-left text-dark-400 font-medium px-5 py-3">Vendedor</th>}
                <th className="text-left text-dark-400 font-medium px-5 py-3">Tag</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Criado</th>
                {isAdmin && <th className="text-right text-dark-400 font-medium px-5 py-3">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {data.data.map((lead: any) => (
                <tr key={lead.id} className="hover:bg-dark-700/30 transition-colors cursor-pointer" onClick={() => navigate(`${basePath}/${lead.id}`)}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-dark-100">
                      {lead.name} {lead.fromSite && <span title="Veio do site">🌐</span>}
                    </p>
                    <p className="text-xs text-dark-500">
                      {lead.phone} {lead.company ? `· ${lead.company}` : ''}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${LEAD_STATUS_COLORS[lead.status as keyof typeof LEAD_STATUS_COLORS]}`}>
                      {LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS]}
                    </span>
                  </td>
                  {isAdmin && <td className="px-5 py-3 text-dark-300">{lead.vendor?.name ?? '—'}</td>}
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <LeadNegotiationTagPicker leadId={lead.id} tag={lead.negotiationTag} />
                  </td>
                  <td className="px-5 py-3 text-dark-400">{timeAgo(lead.createdAt)}</td>
                  {isAdmin && (
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setTransferLead({ id: lead.id, name: lead.name })}
                          className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
                          title="Transferir"
                        >
                          <ArrowRightLeft size={15} />
                        </button>
                        <button
                          onClick={() => setDeleteLead({ id: lead.id, name: lead.name })}
                          className="p-1.5 rounded-lg hover:bg-red-900/30 text-dark-500 hover:text-red-400 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-dark-400">
            {page} / {data.totalPages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}

      <QuickLeadCreate open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`${basePath}/${id}`)} />

      <TransferModal lead={transferLead} onClose={() => setTransferLead(null)} vendedores={vendedores ?? []} />

      <Modal open={!!deleteLead} onClose={() => setDeleteLead(null)} title="Excluir lead" size="sm">
        <p className="text-dark-300 text-sm mb-5">Tem certeza que quer excluir "{deleteLead?.name}"?</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteLead(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={deleteMut.isPending}
            onClick={() => deleteLead && deleteMut.mutate({ id: deleteLead.id })}
          >
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function TransferModal({
  lead,
  onClose,
  vendedores,
}: {
  lead: { id: number; name: string } | null
  onClose: () => void
  vendedores: { id: number; name: string }[]
}) {
  const utils = trpc.useUtils()
  const [newVendorId, setNewVendorId] = useState('')

  const mut = trpc.leads.transfer.useMutation({
    onSuccess() {
      toast.success('Lead transferido')
      utils.leads.list.invalidate()
      setNewVendorId('')
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <Modal open={!!lead} onClose={onClose} title={`Transferir "${lead?.name ?? ''}"`} size="sm">
      <div className="space-y-4">
        <Select
          label="Novo vendedor"
          value={newVendorId}
          onChange={(e) => setNewVendorId(e.target.value)}
          placeholder="Selecione..."
          options={vendedores.map((v) => ({ value: v.id, label: v.name }))}
        />
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            loading={mut.isPending}
            disabled={!newVendorId}
            onClick={() => lead && mut.mutate({ leadId: lead.id, newVendorId: Number(newVendorId) })}
          >
            Transferir
          </Button>
        </div>
      </div>
    </Modal>
  )
}
