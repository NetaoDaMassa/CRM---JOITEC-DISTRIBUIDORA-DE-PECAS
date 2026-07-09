import { AlertTriangle } from 'lucide-react'
import { trpc } from '../../lib/trpc'

export default function SlaDashboard() {
  const { data, isLoading } = trpc.reports.slaOverview.useQuery(undefined, { refetchInterval: 30000 })

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-dark-800 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  const { overdueByVendor, avgTimeStuckByStage, criticalAlertVendors, reassignmentHistory } = data

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">SLA Abordagem</h1>
        <p className="text-dark-400 text-sm">Visão em tempo real do gargalo na etapa Abordagem · atualiza a cada 30s</p>
      </div>

      {criticalAlertVendors.length > 0 && (
        <div className="space-y-2">
          {criticalAlertVendors.map((v) => (
            <div key={v.vendorId} className="flex items-center gap-3 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl p-4">
              <AlertTriangle size={18} className="shrink-0" />
              <p className="text-sm font-medium">
                {v.name} tem {v.critico} leads críticos simultâneos
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide mb-4">
            Leads Atrasados por Vendedor
          </h2>
          {overdueByVendor.length === 0 ? (
            <p className="text-dark-500 text-sm">Nenhum lead em risco ou crítico no momento</p>
          ) : (
            <div className="space-y-3">
              {overdueByVendor.map((v) => (
                <div key={v.vendorId ?? 'sem-vendedor'} className="flex items-center justify-between">
                  <span className="text-sm text-dark-200">{v.name}</span>
                  <div className="flex items-center gap-2">
                    {v.emRisco > 0 && (
                      <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded-full px-2 py-0.5">
                        {v.emRisco} em risco
                      </span>
                    )}
                    {v.critico > 0 && (
                      <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">
                        {v.critico} crítico
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide mb-1">
            Tempo Médio Parado em Abordagem
          </h2>
          <p className="text-3xl font-bold text-dark-100 mb-4">
            {avgTimeStuckByStage.overallHours.toFixed(1)}h <span className="text-sm text-dark-400 font-normal">úteis (geral)</span>
          </p>
          <div className="space-y-2">
            {avgTimeStuckByStage.byVendor.map((v) => (
              <div key={v.vendorId ?? 'sem-vendedor'} className="flex items-center justify-between text-sm">
                <span className="text-dark-300">{v.name}</span>
                <span className={v.avgHours > avgTimeStuckByStage.overallHours ? 'text-red-400' : 'text-dark-400'}>
                  {v.avgHours.toFixed(1)}h
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <h2 className="font-heading text-gold-400 font-semibold text-sm uppercase tracking-wide mb-4">
          Histórico de Reatribuição por Vendedor
        </h2>
        {reassignmentHistory.length === 0 ? (
          <p className="text-dark-500 text-sm">Nenhuma reatribuição registrada ainda</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 text-xs text-dark-400 mb-2 uppercase tracking-wide">
            <span>Vendedor</span>
            <span>Recebeu</span>
            <span>Perdeu</span>
          </div>
        )}
        <div className="space-y-2">
          {reassignmentHistory.map((v) => (
            <div key={v.vendorId} className="grid grid-cols-3 gap-4 text-sm">
              <span className="text-dark-200">{v.name}</span>
              <span className="text-green-400">{v.received}</span>
              <span className="text-red-400">{v.lost}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
