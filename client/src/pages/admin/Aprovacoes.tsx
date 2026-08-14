import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

const BANCO_CLIENTES_VALUE = 'banco'

const TIPO_LABELS: Record<string, string> = {
  descartar: 'Descartar cliente',
  transferir: 'Transferir de carteira',
}

const TIPO_LABELS_DESIGN: Record<string, string> = {
  comunicado: 'Comunicado',
  oferta: 'Oferta',
  banner: 'Banner',
}

function CarteiraTab() {
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
  )
}

function DesignTab() {
  const utils = trpc.useUtils()
  const { data: pedidos, isLoading } = trpc.design.listarPendentes.useQuery()

  function invalidar() {
    utils.design.listarPendentes.invalidate()
  }

  const aprovarMut = trpc.design.aprovar.useMutation({
    onSuccess() {
      toast.success('Pedido de arte aprovado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const recusarMut = trpc.design.recusar.useMutation({
    onSuccess() {
      toast.success('Pedido de arte recusado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
      {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
      {!isLoading && !pedidos?.length && <p className="p-4 text-dark-400 text-sm">Nenhum pedido de arte pendente.</p>}
      {pedidos?.map((p) => (
        <div key={p.id} className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-dark-100">
                <span className="text-xs font-normal text-gold-400 bg-gold-600/10 border border-gold-600/30 rounded px-1.5 py-0.5 mr-1">
                  {TIPO_LABELS_DESIGN[p.tipo]}
                </span>
              </p>
              <p className="text-xs text-dark-500">pedido de {p.vendedorSolicitanteNome}</p>
            </div>
          </div>

          <p className="text-sm text-dark-300">{p.descricao}</p>

          <div className="flex flex-wrap gap-2 text-xs text-dark-400">
            {p.produto && <Badge className="bg-dark-700 border-dark-600 text-dark-200">Produto: {p.produto}</Badge>}
            {p.preco && <Badge className="bg-dark-700 border-dark-600 text-dark-200">Preço: {p.preco}</Badge>}
            {p.quantidade && <Badge className="bg-dark-700 border-dark-600 text-dark-200">Qtd/página: {p.quantidade}</Badge>}
            {p.dataLimiteEntrega && (
              <Badge className="bg-dark-700 border-dark-600 text-dark-200">
                Entrega até {new Date(p.dataLimiteEntrega + 'T00:00:00').toLocaleDateString('pt-BR')}
              </Badge>
            )}
            {p.dataLimiteValidade && (
              <Badge className="bg-dark-700 border-dark-600 text-dark-200">
                Válido até {new Date(p.dataLimiteValidade + 'T00:00:00').toLocaleDateString('pt-BR')}
              </Badge>
            )}
          </div>

          {p.observacoes && <p className="text-xs text-dark-400 italic">Obs: {p.observacoes}</p>}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button size="sm" loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ id: p.id })}>
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
  )
}

// Pedidos que o vendedor faz (transferir/descartar cliente, ou solicitar
// arte pra marketing) — o admin decide aqui. Duas abas porque são fluxos
// bem diferentes: carteira aplica uma ação de sistema ao aprovar, design só
// libera o pedido pra marketing.
export default function Aprovacoes() {
  const [aba, setAba] = useState<'carteira' | 'design'>('carteira')

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Aprovações</h1>
        <p className="text-sm text-dark-400">Pedidos dos vendedores que precisam da sua decisão.</p>
      </div>

      <div className="flex gap-2 border-b border-dark-700">
        <button
          onClick={() => setAba('carteira')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === 'carteira' ? 'border-gold-500 text-gold-400' : 'border-transparent text-dark-400 hover:text-dark-200'
          }`}
        >
          Carteira
        </button>
        <button
          onClick={() => setAba('design')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === 'design' ? 'border-gold-500 text-gold-400' : 'border-transparent text-dark-400 hover:text-dark-200'
          }`}
        >
          Arte / Design
        </button>
      </div>

      {aba === 'carteira' ? <CarteiraTab /> : <DesignTab />}
    </div>
  )
}
