import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, ArrowRightLeft, Trash2, KanbanSquare, ShieldAlert, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { WhatsappButton } from '../../components/ui/ContatoButtons'
import EmailButton from '../../components/ui/EmailButton'
import { timeAgo, formatElapsed } from '../../lib/utils'
import QuickLeadCreate from '../../components/QuickLeadCreate'
import LeadNegotiationTagPicker from '../../components/LeadNegotiationTagPicker'
import {
  LEAD_STATUS_VALUES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  isLeadStatusAllowedForEmpresa,
  getLeadContactUrgency,
  leadTelefoneCompleto,
  leadTelefoneFormatado,
} from '../../lib/leadsShared'

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
  const [soDoSite, setSoDoSite] = useState(false)
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [transferLead, setTransferLead] = useState<{ id: number; name: string } | null>(null)
  const [deleteLead, setDeleteLead] = useState<{ id: number; name: string } | null>(null)
  const [limpezaOpen, setLimpezaOpen] = useState(false)

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })

  const { data, isLoading } = trpc.leads.list.useQuery({
    status: (status || undefined) as any,
    vendorId: isAdmin && vendorId ? Number(vendorId) : undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    fromSite: soDoSite || undefined,
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
        <label className="flex items-center gap-2 bg-dark-900/40 border border-dark-600 rounded-xl px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={soDoSite}
            onChange={(e) => {
              setSoDoSite(e.target.checked)
              setPage(1)
            }}
            className="accent-cyan-500"
          />
          <span className="text-xs text-dark-300 whitespace-nowrap">Só leads do site</span>
        </label>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-dark-900/60 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-16 text-center text-dark-400 text-sm">Nenhum lead encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-600 bg-dark-900/40">
                  <th className="text-left text-dark-400 font-medium px-5 py-3">Lead</th>
                  <th className="text-left text-dark-400 font-medium px-5 py-3">Etapa</th>
                  {isAdmin && <th className="text-left text-dark-400 font-medium px-5 py-3">Vendedor</th>}
                  <th className="text-left text-dark-400 font-medium px-5 py-3">Tag</th>
                  <th className="text-left text-dark-400 font-medium px-5 py-3">Recebido há</th>
                  <th className="text-right text-dark-400 font-medium px-5 py-3">Contato</th>
                  {isAdmin && <th className="text-right text-dark-400 font-medium px-5 py-3">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {data.data.map((lead: any) => {
                  const urgency = lead.nextContactAt ? getLeadContactUrgency(lead.nextContactAt, lead.status) : null
                  return (
                    <tr key={lead.id} className="hover:bg-dark-700/30 transition-colors cursor-pointer" onClick={() => navigate(`${basePath}/${lead.id}`)}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-dark-100">{lead.name}</p>
                        <p className="text-xs text-dark-500">
                          {leadTelefoneFormatado(lead.ddd, lead.phone)} {lead.company ? `· ${lead.company}` : ''}
                        </p>
                        {lead.fromSite && (
                          <div className="mt-1">
                            <Badge className="text-cyan-400 bg-cyan-900/20 border-cyan-700/40">🌐 Veio do site</Badge>
                          </div>
                        )}
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
                      <td className="px-5 py-3 text-dark-400">
                        {formatElapsed(lead.createdAt)}
                        {urgency?.atrasado && <p className="text-red-400 font-bold text-[11px] mt-0.5">atrasado {formatElapsed(lead.nextContactAt)}</p>}
                      </td>
                      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {lead.email && <EmailButton email={lead.email} size="sm" />}
                          <WhatsappButton telefone={leadTelefoneCompleto(lead.ddd, lead.phone)} size="sm" />
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setTransferLead({ id: lead.id, name: lead.name })}
                              className="p-1.5 rounded-lg hover:bg-blue-900/30 text-dark-400 hover:text-blue-400 transition-colors"
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
                  )
                })}
              </tbody>
            </table>
          </div>
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

      {isAdmin && (
        <div className="bg-red-900/10 border border-red-900/40 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-red-300">Zona de perigo</p>
            <p className="text-xs text-dark-500 mt-0.5">Apaga em massa os leads de um vendedor (ou de todos) — não dá pra desfazer.</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setLimpezaOpen(true)}>
            <Trash2 size={14} /> Limpeza em massa
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

      <LimpezaModal open={limpezaOpen} onClose={() => setLimpezaOpen(false)} vendedores={vendedores ?? []} />
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

function LimpezaModal({
  open,
  onClose,
  vendedores,
}: {
  open: boolean
  onClose: () => void
  vendedores: { id: number; name: string }[]
}) {
  const utils = trpc.useUtils()
  const [vendorId, setVendorId] = useState('')

  const mut = trpc.leads.deleteAll.useMutation({
    onSuccess() {
      toast.success('Leads excluídos')
      utils.leads.list.invalidate()
      setVendorId('')
      onClose()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Limpeza em massa" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/50 rounded-xl p-3 text-red-300 text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          Essa ação apaga os leads de vez — sem confirmação extra depois desta. Use com cuidado.
        </div>
        <Select
          label="Escopo"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          placeholder="Todos os leads da empresa"
          options={vendedores.map((v) => ({ value: v.id, label: `Só de ${v.name}` }))}
        />
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={mut.isPending}
            onClick={() => {
              if (confirm('Confirma a exclusão em massa? Essa ação não pode ser desfeita.')) {
                mut.mutate({ vendorId: vendorId ? Number(vendorId) : undefined })
              }
            }}
          >
            Apagar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
