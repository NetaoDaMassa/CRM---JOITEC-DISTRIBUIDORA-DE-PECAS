import { useEffect, useState } from 'react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Select from '../../components/ui/Select'
import FunilBoard from '../../components/FunilBoard'
import { primeiroDiaMesString } from '../../lib/utils'

export default function AdminKanban() {
  const { data: vendedores } = trpc.users.vendors.useQuery()
  const [vendedorId, setVendedorId] = useState<number | null>(null)
  const [mesReferencia, setMesReferencia] = useState(primeiroDiaMesString())
  const { empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const ehCompretecLojaFisica = empresas?.find((e) => e.id === empresaAtivaId)?.slug === 'compretec-loja-fisica'

  useEffect(() => {
    if (vendedores && vendedores.length > 0 && vendedorId === null) {
      setVendedorId(vendedores[0].id)
    }
  }, [vendedores, vendedorId])

  const { data: cards, isLoading } = trpc.funil.funilPorVendedor.useQuery(
    { vendedorId: vendedorId!, mesReferencia },
    { enabled: vendedorId !== null }
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading text-xl text-dark-50">Kanban por vendedor</h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={mesReferencia.slice(0, 7)}
            onChange={(e) => setMesReferencia(e.target.value + '-01')}
            className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-1.5"
          />
          <div className="w-64">
            <Select
              value={vendedorId ?? ''}
              onChange={(e) => setVendedorId(Number(e.target.value))}
              options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        </div>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && vendedorId !== null && (
        <FunilBoard
          cards={cards ?? []}
          permitirVendaRapida={ehCompretecLojaFisica}
          vendedorIdVendaRapida={vendedorId}
          mostrarFaturamento={ehCompretecLojaFisica}
        />
      )}
    </div>
  )
}
