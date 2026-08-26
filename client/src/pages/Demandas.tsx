import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import DemandasBoard from '../components/DemandasBoard'
import DemandaModal from '../components/DemandaModal'

// Board de Demandas (estilo Trello) — mesma tela em /admin/demandas e
// /vendedor/demandas (padrão já usado em OrdensKanban/Devolucoes/Leads):
// todo mundo da empresa ativa vê o mesmo board, só admin cria/edita o
// conteúdo, qualquer um arrasta card entre fases.
export default function Demandas() {
  const { user, empresaAtivaId } = useAuth()
  const isAdmin = user?.role === 'admin'
  const utils = trpc.useUtils()

  const { data: estagios } = trpc.demandas.estagiosListar.useQuery()
  const { data: demandas } = trpc.demandas.listar.useQuery()

  const [modalAberto, setModalAberto] = useState(false)
  const [demandaSelecionada, setDemandaSelecionada] = useState<number | null>(null)

  const moverMut = trpc.demandas.mover.useMutation({
    onMutate: async (input) => {
      await utils.demandas.listar.cancel()
      const anterior = utils.demandas.listar.getData()
      utils.demandas.listar.setData(undefined, (old) =>
        old?.map((d) => (d.id === input.id ? { ...d, estagioId: input.estagioId, ordem: input.ordem } : d))
      )
      return { anterior }
    },
    onError: (e, _input, ctx) => {
      if (ctx?.anterior) utils.demandas.listar.setData(undefined, ctx.anterior)
      toast.error(e.message)
    },
    onSettled: () => utils.demandas.listar.invalidate(),
  })

  const estagioCriarMut = trpc.demandas.estagioCriar.useMutation({
    onSuccess: () => utils.demandas.estagiosListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const estagioRenomearMut = trpc.demandas.estagioRenomear.useMutation({
    onSuccess: () => utils.demandas.estagiosListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })
  const estagioExcluirMut = trpc.demandas.estagioExcluir.useMutation({
    onSuccess: () => utils.demandas.estagiosListar.invalidate(),
    onError: (e) => toast.error(e.message),
  })

  function abrirNova() {
    setDemandaSelecionada(null)
    setModalAberto(true)
  }
  function abrirDemanda(id: number) {
    setDemandaSelecionada(id)
    setModalAberto(true)
  }

  if (!estagios || !demandas) return <div className="p-6 text-dark-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl text-dark-50 font-bold">Demandas</h1>
          <p className="text-sm text-dark-400 mt-0.5">Tarefas da empresa, organizadas por fase — como um Trello.</p>
        </div>
        {isAdmin && (
          <Button onClick={abrirNova}>
            <Plus size={16} /> Nova demanda
          </Button>
        )}
      </div>

      <DemandasBoard
        estagios={estagios}
        demandas={demandas}
        podeGerenciarFases={isAdmin}
        onAbrirDemanda={abrirDemanda}
        onMover={(demandaId, estagioId, ordem) => moverMut.mutate({ id: demandaId, estagioId, ordem })}
        onNovaFaseEm={(nome) => estagioCriarMut.mutate({ nome })}
        onRenomearFase={(id, nome) => estagioRenomearMut.mutate({ id, nome })}
        onExcluirFase={(id) => estagioExcluirMut.mutate({ id })}
      />

      <DemandaModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        demandaId={demandaSelecionada}
        empresaIdInicial={empresaAtivaId ?? user?.empresaId ?? 0}
      />
    </div>
  )
}
