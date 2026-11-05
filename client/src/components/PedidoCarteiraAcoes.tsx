import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Select from './ui/Select'
import Button from './ui/Button'

// Aprovar/recusar um pedido de descarte ou transferência de cliente — usado
// na tela Aprovações (aba Carteira) e na coluna "Descarte / Transferência"
// do Kanban da Odin Tubos (pedido do João, 2026-11-05), pra as duas
// fazerem exatamente a mesma coisa.

const BANCO_CLIENTES_VALUE = 'banco'
const BANCO_ESPECIFICO_PREFIXO = 'banco:'

export const TIPO_PEDIDO_CARTEIRA_LABEL: Record<string, string> = {
  descartar: 'Descartar cliente',
  transferir: 'Transferir de carteira',
}

export default function PedidoCarteiraAcoes({ pedidoId, tipo, compacto }: { pedidoId: number; tipo: string; compacto?: boolean }) {
  const utils = trpc.useUtils()
  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: tipo === 'transferir', staleTime: 5 * 60_000 })
  const { data: bancosExistentes } = trpc.clientes.bancoResumo.useQuery(undefined, { enabled: tipo === 'transferir', staleTime: 5 * 60_000 })
  const [destino, setDestino] = useState('')

  function invalidar() {
    utils.aprovacoes.listarPendentes.invalidate()
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
    utils.funil.coberturaContatos.invalidate()
    utils.funil.painelDoDia.invalidate()
  }

  const aprovarMut = trpc.aprovacoes.aprovar.useMutation({
    onSuccess() {
      toast.success(tipo === 'descartar' ? 'Cliente descartado' : 'Transferência aprovada')
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })
  const recusarMut = trpc.aprovacoes.recusar.useMutation({
    onSuccess() {
      toast.success('Pedido recusado — o cliente volta pro Kanban do vendedor')
      invalidar()
    },
    onError: (err) => toast.error(err.message),
  })

  function aprovar() {
    if (tipo === 'transferir' && !destino) {
      toast.error('Escolha o destino (um vendedor ou Banco de Clientes) antes de aprovar.')
      return
    }
    if (tipo === 'descartar' && compacto && !confirm('Descartar este cliente? Ele sai da carteira (fica na lixeira de clientes).')) return
    const ehBancoEspecifico = destino.startsWith(BANCO_ESPECIFICO_PREFIXO)
    aprovarMut.mutate({
      id: pedidoId,
      paraBanco: destino === BANCO_CLIENTES_VALUE,
      rotuloBanco: ehBancoEspecifico ? destino.slice(BANCO_ESPECIFICO_PREFIXO.length) : undefined,
      vendedorDestinoId: destino && destino !== BANCO_CLIENTES_VALUE && !ehBancoEspecifico ? Number(destino) : undefined,
    })
  }

  return (
    <div className={`flex gap-2 ${compacto ? 'flex-col items-stretch' : 'items-center flex-wrap'}`}>
      {tipo === 'transferir' && (
        <div className={compacto ? '' : 'w-64'}>
          <Select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            placeholder="Escolha o destino..."
            options={[
              { value: BANCO_CLIENTES_VALUE, label: '📥 Banco de Clientes (rotulado com o vendedor anterior)' },
              ...(bancosExistentes ?? []).map((b) => ({ value: `${BANCO_ESPECIFICO_PREFIXO}${b.origemBanco}`, label: `📥 ${b.origemBanco} (${b.quantidade})` })),
              ...(vendedores ?? []).map((v) => ({ value: String(v.id), label: v.name })),
            ]}
          />
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" className={compacto ? 'flex-1' : ''} loading={aprovarMut.isPending} disabled={recusarMut.isPending} onClick={aprovar}>
          {tipo === 'descartar' ? (compacto ? 'Descartar' : 'Aprovar') : compacto ? 'Transferir' : 'Aprovar'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className={compacto ? 'flex-1' : ''}
          loading={recusarMut.isPending}
          disabled={aprovarMut.isPending}
          onClick={() => recusarMut.mutate({ id: pedidoId })}
        >
          Recusar
        </Button>
      </div>
    </div>
  )
}
