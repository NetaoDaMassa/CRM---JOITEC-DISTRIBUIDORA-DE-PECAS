import { useEffect, useState } from 'react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import CalendarBoard from '../../components/CalendarBoard'

export default function AdminCalendario() {
  const { data: vendedores } = trpc.users.vendors.useQuery()
  const [vendedorId, setVendedorId] = useState<number | null>(null)

  useEffect(() => {
    if (vendedores && vendedores.length > 0 && vendedorId === null) {
      setVendedorId(vendedores[0].id)
    }
  }, [vendedores, vendedorId])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading text-xl text-dark-50">Agenda da equipe</h1>
        <div className="w-64">
          <Select
            value={vendedorId ?? ''}
            onChange={(e) => setVendedorId(Number(e.target.value))}
            options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
        </div>
      </div>

      {vendedorId !== null && <CalendarBoard vendedorId={vendedorId} />}
    </div>
  )
}
