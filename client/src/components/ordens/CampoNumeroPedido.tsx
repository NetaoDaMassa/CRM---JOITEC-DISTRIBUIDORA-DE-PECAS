import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Hash } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

// Número do pedido na etapa Frete Finalizado (peças) — pedido do João,
// 2026-10-19. É o MESMO campo da etapa Pedido (ordemDetalhes.numeroPedido),
// só que editável aqui também, porque em peças o número costuma sair só
// depois do frete fechado. Aparece no cartão do Kanban de Pedidos.
export default function CampoNumeroPedido({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.ordens.financeiro.obterDetalhes.useQuery({ ordemId })
  const [numero, setNumero] = useState('')
  useEffect(() => {
    setNumero(data?.numeroPedido ?? '')
  }, [data?.numeroPedido])
  const podeEditar = isAdmin && !readonly

  const salvarMut = trpc.ordens.financeiro.atualizarDetalhes.useMutation({
    onSuccess: () => {
      toast.success('Número do pedido salvo')
      utils.ordens.financeiro.obterDetalhes.invalidate({ ordemId })
      utils.ordens.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading) return null
  const alterado = numero.trim() !== (data?.numeroPedido ?? '')

  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800/60 p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Número do pedido"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={!podeEditar}
            placeholder="Ex.: 123456"
          />
        </div>
        {podeEditar && (
          <Button size="sm" variant="secondary" disabled={!alterado} loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, numeroPedido: numero.trim() })}>
            <Hash size={14} className="mr-1" /> Salvar
          </Button>
        )}
      </div>
    </div>
  )
}
