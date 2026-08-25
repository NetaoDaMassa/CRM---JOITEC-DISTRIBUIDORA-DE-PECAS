import { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import FunilBoard from '../../components/FunilBoard'
import { primeiroDiaMesString } from '../../lib/utils'

export default function VendorKanban() {
  const [mesReferencia, setMesReferencia] = useState(primeiroDiaMesString())
  const { data: cards } = trpc.funil.meuFunil.useQuery({ mesReferencia })
  const { empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const ehCompretecLojaFisica = empresas?.find((e) => e.id === empresaAtivaId)?.slug === 'compretec-loja-fisica'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading text-xl text-dark-50">Meu Funil</h1>
        <input
          type="month"
          value={mesReferencia.slice(0, 7)}
          onChange={(e) => setMesReferencia(e.target.value + '-01')}
          className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-1.5"
        />
      </div>
      <FunilBoard
        cards={cards ?? []}
        permitirVendaRapida={ehCompretecLojaFisica}
        mostrarFaturamento={ehCompretecLojaFisica}
        mostrarConsumidorFinalLoja={ehCompretecLojaFisica}
      />
    </div>
  )
}
