import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

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
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')

  const salvarMut = trpc.ordens.core.atualizarEndereco.useMutation({
    onSuccess: () => { toast.success('Endereço salvo'); utils.ordens.core.obterPorId.invalidate({ id: ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  if (!ordem) return null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Campo label="Criado em"><span className="text-dark-200">{ordem.createdAt}</span></Campo>
        <Campo label="Atualizado em"><span className="text-dark-200">{ordem.updatedAt}</span></Campo>
      </div>
      <h3 className="text-sm font-semibold text-dark-200 mt-4">Endereço de entrega</h3>
      <div className="grid grid-cols-2 gap-3">
        <Input label="CEP" defaultValue={ordem.enderecoEntregaCep ?? ''} onChange={(e) => setCep(e.target.value)} />
        <Input label="Cidade" defaultValue={ordem.enderecoEntregaCidade ?? ''} onChange={(e) => setCidade(e.target.value)} />
        <Input label="Logradouro" defaultValue={ordem.enderecoEntregaLogradouro ?? ''} onChange={(e) => setLogradouro(e.target.value)} className="col-span-2" />
        <Input label="Estado (UF)" defaultValue={ordem.enderecoEntregaEstado ?? ''} onChange={(e) => setEstado(e.target.value)} maxLength={2} />
      </div>
      <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ id: ordemId, cep, logradouro, cidade, estado })}>Salvar endereço</Button>
    </div>
  )
}
