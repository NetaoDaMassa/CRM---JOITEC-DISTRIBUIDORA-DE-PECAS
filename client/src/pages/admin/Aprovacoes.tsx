import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'

const BANCO_CLIENTES_VALUE = 'banco'

const TIPO_LABELS: Record<string, string> = {
  descartar: 'Descartar cliente',
  transferir: 'Transferir de carteira',
}

// Pedidos que o vendedor faz pra descartar (excluir) ou transferir um
// cliente da própria carteira — o admin decide aqui. Se aprovar, a ação
// acontece de verdade (exclusão ou transferência); se recusar, nada muda e
// o cliente continua normal no Kanban de quem pediu.
export default function Aprovacoes() {
  const utils = trpc.useUtils()
  const { data: pedidos, isLoading } = trpc.aprovacoes.listarPendentes.useQuery()
  const { data: vendedores } = trpc.users.vendors.useQuery()
  const [destinoPorPedido, setDestinoPorPedido] = useState<Record<number, string>>({})

  function invalidar() {
    utils.aprovacoes.listarPendentes.invalidate()
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
  }

  const aprovarMut = trpc.aprovacoes.aprovar.useMutation({
    onSuccess() {
      toast.success('Pedido aprovado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const recusarMut = trpc.aprovacoes.recusar.useMutation({
    onSuccess() {
      toast.success('Pedido recusado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Aprovações</h1>
        <p className="text-sm text-dark-400">Pedidos dos vendedores pra descartar ou transferir clientes da própria carteira.</p>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !pedidos?.length && <p className="p-4 text-dark-400 text-sm">Nenhum pedido pendente.</p>}
        {pedidos?.map((p) => (
          <div key={p.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-dark-100">
                  {p.clienteRazaoSocial}{' '}
                  <span className="text-xs font-normal text-gold-400 bg-gold-600/10 border border-gold-600/30 rounded px-1.5 py-0.5 ml-1">
                    {TIPO_LABELS[p.tipo]}
                  </span>
                </p>
                <p className="text-xs text-dark-500">
                  Cód. {p.clienteCodigo} · pedido de {p.vendedorSolicitanteNome}
                </p>
                <p className="text-sm text-dark-300 mt-1">{p.motivo}</p>
                <div className="flex items-center gap-3 mt-1">
                  <Link to={`/admin/clientes/${p.clienteId}`} className="text-xs text-gold-400 hover:underline">
                    Ver cliente (dados, anotações, histórico) →
                  </Link>
                  {p.comprovantePath && (
                    <a href={p.comprovantePath} target="_blank" rel="noopener noreferrer" className="text-xs text-gold-400 hover:underline">
                      Ver comprovante
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {p.tipo === 'transferir' && (
                <div className="w-64">
                  <Select
                    value={destinoPorPedido[p.id] ?? ''}
                    onChange={(e) => setDestinoPorPedido((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder="Escolha o destino..."
                    options={[
                      { value: BANCO_CLIENTES_VALUE, label: '📥 Banco de Clientes (sem vendedor)' },
                      ...(vendedores ?? []).map((v) => ({ value: String(v.id), label: v.name })),
                    ]}
                  />
                </div>
              )}
              <Button
                size="sm"
                loading={aprovarMut.isPending}
                onClick={() => {
                  if (p.tipo === 'transferir' && !destinoPorPedido[p.id]) {
                    return toast.error('Escolha o destino (um vendedor ou Banco de Clientes) antes de aprovar.')
                  }
                  const destino = destinoPorPedido[p.id]
                  aprovarMut.mutate({
                    id: p.id,
                    paraBanco: destino === BANCO_CLIENTES_VALUE,
                    vendedorDestinoId: destino && destino !== BANCO_CLIENTES_VALUE ? Number(destino) : undefined,
                  })
                }}
              >
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={recusarMut.isPending}
                onClick={() => recusarMut.mutate({ id: p.id })}
              >
                Recusar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
