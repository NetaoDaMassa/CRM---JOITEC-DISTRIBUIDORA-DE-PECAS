import { useState } from 'react'
import { trpc } from '../../lib/trpc'
import FunilBoard from '../../components/FunilBoard'
import { primeiroDiaMesString } from '../../lib/utils'

// Visão só pra quem processa faturamento de TODOS os vendedores da
// Compretec Loja Física (ex: Daniela) — junta os cards Fechado/Faturamento
// da empresa inteira num board só, sem precisar trocar de vendedor.
export default function FaturamentoGeral() {
  const [mesReferencia, setMesReferencia] = useState(primeiroDiaMesString())
  const { data: cards, isLoading } = trpc.funil.funilFaturamentoGeral.useQuery({ mesReferencia })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading text-xl text-dark-50">Faturamento Geral</h1>
        <input
          type="month"
          value={mesReferencia.slice(0, 7)}
          onChange={(e) => setMesReferencia(e.target.value + '-01')}
          className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-1.5"
        />
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && (
        <FunilBoard cards={cards ?? []} mostrarFaturamento apenasEtapas={['fechado', 'faturamento', 'consumidor_final_loja']} />
      )}
    </div>
  )
}
