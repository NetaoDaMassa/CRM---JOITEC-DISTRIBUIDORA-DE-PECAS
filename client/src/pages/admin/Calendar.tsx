import { trpc } from '../../lib/trpc'
import CalendarView from '../../components/CalendarView'

export default function AdminCalendar() {
  const { data, isLoading } = trpc.leads.list.useQuery({ page: 1, pageSize: 1000 })
  const leads = data?.data ?? []

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-heading text-2xl text-gold-400 font-bold">Calendário</h1>
        <p className="text-dark-400 text-sm">Próximos contatos agendados — todos os vendedores</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 h-96 bg-dark-800 rounded-2xl animate-pulse" />
          <div className="h-96 bg-dark-800 rounded-2xl animate-pulse" />
        </div>
      ) : (
        <CalendarView leads={leads} basePath="/admin" isAdmin={true} />
      )}
    </div>
  )
}
