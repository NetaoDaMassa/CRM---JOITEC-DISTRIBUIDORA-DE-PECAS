import { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import Select from '../../components/ui/Select'
import FunilBoard from '../../components/FunilBoard'
import { primeiroDiaMesString } from '../../lib/utils'

// Coluna com mais cards que isso no modo "Todos" mostra o resto sob demanda
// ("Mostrar mais") — Joitec/Tubos passam de 3 mil cards/mês somando todo mundo.
const LIMITE_POR_COLUNA_TODOS = 50

export default function AdminKanban() {
  const { data: vendedores } = trpc.users.vendors.useQuery()
  // null = "Todos os vendedores" — padrão ao abrir (pedido do João,
  // 2026-10-19: admin já de cara vendo o total, antes caía no 1º vendedor
  // da lista).
  const [vendedorId, setVendedorId] = useState<number | null>(null)
  const [mesReferencia, setMesReferencia] = useState(primeiroDiaMesString())
  const { empresaAtivaId } = useAuth()
  const { data: empresas } = trpc.empresas.list.useQuery()
  const ehCompretecLojaFisica = empresas?.find((e) => e.id === empresaAtivaId)?.slug === 'compretec-loja-fisica'
  const ehOdinTubos = empresas?.find((e) => e.id === empresaAtivaId)?.slug === 'odin-tubos'
  const todos = vendedorId === null

  const { data: cards, isLoading } = trpc.funil.funilPorVendedor.useQuery({ vendedorId: vendedorId ?? undefined, mesReferencia })

  // Quem não é vendedor (equipe "Nenhum" em Usuários — operacional, logins
  // antigos) não entra na lista.
  const vendedoresLista = (vendedores ?? []).filter((v) => (v as { canalVenda?: string }).canalVenda !== 'nenhum')
  const nomePorId = new Map((vendedores ?? []).map((v) => [v.id, v.name]))

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
              onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : null)}
              options={[{ value: '', label: 'Todos os vendedores' }, ...vendedoresLista.map((v) => ({ value: v.id, label: v.name }))]}
            />
          </div>
        </div>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && (
        <FunilBoard
          key={vendedorId ?? 'todos'}
          cards={cards ?? []}
          coberturaMes={mesReferencia}
          coberturaVendedorId={vendedorId ?? undefined}
          coberturaTodos={todos}
          limitePorColuna={todos ? LIMITE_POR_COLUNA_TODOS : undefined}
          nomeVendedor={todos ? (id) => nomePorId.get(id) : undefined}
          permitirVendaRapida={ehCompretecLojaFisica}
          vendedorIdVendaRapida={vendedorId ?? undefined}
          mostrarFaturamento={ehCompretecLojaFisica}
          mostrarConsumidorFinalLoja={ehCompretecLojaFisica}
          mostrarOutrasLinhas={ehOdinTubos}
        />
      )}
    </div>
  )
}
