import { ArrowRightLeft, Repeat2, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { formatDateTime } from '../../lib/utils'

const ACTION_LABELS: Record<string, string> = {
  transferido: 'Transferência manual',
  reatribuicao_automatica: 'Reatribuição automática',
  excluido: 'Exclusão',
}

const ACTION_ICONS: Record<string, typeof ArrowRightLeft> = {
  transferido: ArrowRightLeft,
  reatribuicao_automatica: Repeat2,
  excluido: Trash2,
}

const ACTION_COLORS: Record<string, string> = {
  transferido: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  reatribuicao_automatica: 'text-gold-400 bg-gold-600/15 border-gold-600/30',
  excluido: 'text-red-400 bg-red-500/15 border-red-500/30',
}

export default function TransferHistory() {
  const { data, isLoading } = trpc.reports.transferHistory.useQuery()

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-dark-800 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Histórico de Transferências</h1>
        <p className="text-dark-400 text-sm">
          Todas as transferências manuais, reatribuições automáticas e exclusões de leads da empresa
        </p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {data.length === 0 ? (
          <p className="text-dark-500 text-sm text-center py-12">Nenhum registro ainda</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-600 bg-dark-700/50">
                  {['Quando', 'Ação', 'Lead', 'De', 'Para', 'Responsável', 'Detalhes'].map((h) => (
                    <th key={h} className="text-left text-dark-400 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {data.map((h: any) => {
                  const Icon = ACTION_ICONS[h.action] ?? ArrowRightLeft
                  return (
                    <tr key={h.id} className="hover:bg-dark-700/40 transition-colors">
                      <td className="px-4 py-3 text-dark-500 whitespace-nowrap">{formatDateTime(h.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 border ${ACTION_COLORS[h.action] ?? 'text-dark-300 bg-dark-700 border-dark-600'}`}>
                          <Icon size={12} />
                          {ACTION_LABELS[h.action] ?? h.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-dark-100 font-medium">
                        {h.lead ? `${h.lead.name} — (${h.lead.ddd}) ${h.lead.phone}` : `Lead #${h.leadId}`}
                      </td>
                      <td className="px-4 py-3 text-dark-300">{h.fromVendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-dark-300">{h.toVendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-dark-300">{h.user?.name ?? 'Sistema (automático)'}</td>
                      <td className="px-4 py-3 text-dark-500 text-xs max-w-xs truncate" title={h.details ?? ''}>
                        {h.details ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
