import { trpc } from '../../lib/trpc'
import KanbanBoard from '../../components/KanbanBoard'

export default function VendorKanban() {
  const { data, isLoading } = trpc.leads.list.useQuery({ page: 1, pageSize: 500 })

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Meu Kanban</h1>
        <p className="text-dark-400 text-sm">{data?.total ?? 0} leads · clique em um lead para ver detalhes e mudar a etapa</p>
      </div>
      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-72 shrink-0">
              <div className="h-8 bg-dark-800 rounded-lg mb-3 animate-pulse" />
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="h-24 bg-dark-800 rounded-xl mb-2 animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <KanbanBoard leads={data?.data ?? []} isAdmin={false} basePath="/vendedor" />
      )}
    </div>
  )
}
