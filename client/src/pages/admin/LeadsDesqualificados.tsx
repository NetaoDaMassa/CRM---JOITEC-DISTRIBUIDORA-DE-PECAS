import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { timeAgo } from '../../lib/utils'
import LeadReopenDisqualifiedModal from '../../components/LeadReopenDisqualifiedModal'
import { useAuth } from '../../contexts/AuthContext'

// Fila de revisão — leads que algum vendedor marcou como "Desqualificado"
// e ainda não foram confirmados/reabertos pelo admin (server/src/router/leads.ts,
// pendingDisqualificationReviews).
export default function LeadsDesqualificados() {
  const navigate = useNavigate()
  const { empresaAtivaId } = useAuth()
  const utils = trpc.useUtils()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const empresaSlug = empresas?.find((e) => e.id === empresaAtivaId)?.slug

  const { data, isLoading } = trpc.leads.pendingDisqualificationReviews.useQuery()
  const [reopenId, setReopenId] = useState<number | null>(null)

  const approveMut = trpc.leads.approveDisqualification.useMutation({
    onSuccess() {
      toast.success('Desqualificação confirmada')
      utils.leads.pendingDisqualificationReviews.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="font-heading text-2xl text-dark-50 font-bold">Revisão de Desqualificados</h1>
        <p className="text-sm text-dark-400 mt-0.5">{data?.length ?? 0} lead(s) aguardando revisão</p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-dark-400 text-sm">Carregando...</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center text-dark-400 text-sm">Nenhum lead pendente de revisão. 🎉</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-900/40">
                <th className="text-left text-dark-400 font-medium px-5 py-3">Lead</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Motivo</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Desqualificado por</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Quando</th>
                <th className="text-right text-dark-400 font-medium px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {data.map((lead) => (
                <tr key={lead.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="px-5 py-3 cursor-pointer" onClick={() => navigate(`/admin/leads/${lead.id}`)}>
                    <p className="font-medium text-dark-100">{lead.name}</p>
                    <p className="text-xs text-dark-500">{lead.phone}</p>
                  </td>
                  <td className="px-5 py-3 text-dark-300 max-w-xs truncate">{lead.disqualifyReason ?? '—'}</td>
                  <td className="px-5 py-3 text-dark-400">{lead.disqualifiedBy}</td>
                  <td className="px-5 py-3 text-dark-400">{timeAgo(lead.statusChangedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setReopenId(lead.id)}>
                        Reabrir
                      </Button>
                      <Button size="sm" loading={approveMut.isPending} onClick={() => approveMut.mutate({ id: lead.id })}>
                        Aprovar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LeadReopenDisqualifiedModal
        leadId={reopenId ?? 0}
        empresaSlug={empresaSlug}
        open={reopenId !== null}
        onClose={() => setReopenId(null)}
      />
    </div>
  )
}
