import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { formatDateTime } from '../../lib/utils'

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-dark-500 mb-1">{label}</div>
      {children}
    </div>
  )
}

export default function EtapaGeral({ ordemId }: { ordemId: number }) {
  const { data: ordem } = trpc.ordens.core.obterPorId.useQuery({ id: ordemId })
  const utils = trpc.useUtils()
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')

  const salvarMut = trpc.ordens.core.atualizarEndereco.useMutation({
    onSuccess: () => { toast.success('Endereço salvo'); utils.ordens.core.obterPorId.invalidate({ id: ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  if (!ordem) return null

  // Pedidos criados a partir de 2026-09-15 já nascem com o endereço de
  // entrega igual ao cadastro do cliente (ver ordens.criar). Pra pedidos
  // mais antigos, cujo endereço de entrega ainda está vazio, cai no
  // cadastro do cliente como valor inicial — não obriga redigitar de novo
  // só porque o pedido é de antes da mudança (pedido do João, 2026-09-15).
  const cepInicial = ordem.enderecoEntregaCep ?? ordem.cliente?.cep ?? ''
  const logradouroInicial = ordem.enderecoEntregaLogradouro ?? ordem.cliente?.endereco ?? ''
  const numeroInicial = ordem.enderecoEntregaNumero ?? ordem.cliente?.numero ?? ''
  const complementoInicial = ordem.enderecoEntregaComplemento ?? ordem.cliente?.complemento ?? ''
  const bairroInicial = ordem.enderecoEntregaBairro ?? ordem.cliente?.bairro ?? ''
  const cidadeInicial = ordem.enderecoEntregaCidade ?? ordem.cliente?.cidade ?? ''
  const estadoInicial = ordem.enderecoEntregaEstado ?? ordem.cliente?.estado ?? ''

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Campo label="Criado em"><span className="text-dark-200">{formatDateTime(ordem.createdAt)}</span></Campo>
        <Campo label="Atualizado em"><span className="text-dark-200">{formatDateTime(ordem.updatedAt)}</span></Campo>
      </div>
      <h3 className="text-sm font-semibold text-dark-200 mt-4">Endereço de entrega</h3>
      <p className="text-xs text-dark-500">Já vem do cadastro do cliente — só mexe aqui se a entrega for num endereço diferente.</p>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <Input label="Logradouro" defaultValue={logradouroInicial} onChange={(e) => setLogradouro(e.target.value)} />
        <Input label="Número" defaultValue={numeroInicial} onChange={(e) => setNumero(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Complemento" defaultValue={complementoInicial} onChange={(e) => setComplemento(e.target.value)} />
        <Input label="Bairro" defaultValue={bairroInicial} onChange={(e) => setBairro(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
        <Input label="Cidade" defaultValue={cidadeInicial} onChange={(e) => setCidade(e.target.value)} />
        <Input label="Estado (UF)" defaultValue={estadoInicial} onChange={(e) => setEstado(e.target.value)} maxLength={2} />
        <Input label="CEP" defaultValue={cepInicial} onChange={(e) => setCep(e.target.value)} />
      </div>
      <Button
        size="sm"
        loading={salvarMut.isPending}
        onClick={() =>
          salvarMut.mutate({
            id: ordemId,
            cep: cep || cepInicial,
            logradouro: logradouro || logradouroInicial,
            numero: numero || numeroInicial,
            complemento: complemento || complementoInicial,
            bairro: bairro || bairroInicial,
            cidade: cidade || cidadeInicial,
            estado: estado || estadoInicial,
          })
        }
      >
        Salvar endereço
      </Button>
    </div>
  )
}
