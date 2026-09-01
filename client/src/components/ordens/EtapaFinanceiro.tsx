import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { formatarDataHora } from '../../lib/ordensShared'

export default function EtapaFinanceiro({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const { data, isLoading } = trpc.ordens.financeiro.obterLiberacao.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <EtapaFinanceiroForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} data={data ?? null} />
}

function EtapaFinanceiroForm({
  ordemId,
  isAdmin,
  readonly,
  data,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  data: { aprovado: boolean; formaPagamento: string | null; condicaoPagamento: string | null; dataPagamentoPrevista: string | null; observacoes: string | null; obsTravadaEm?: string | null } | null
}) {
  const utils = trpc.useUtils()
  const [forma, setForma] = useState(data?.formaPagamento ?? '')
  const [condicao, setCondicao] = useState(data?.condicaoPagamento ?? '')
  const [dataPrevista, setDataPrevista] = useState(data?.dataPagamentoPrevista ?? '')
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const travada = !!data?.obsTravadaEm
  const podeEditar = isAdmin && !readonly

  function invalidar() {
    utils.ordens.financeiro.obterLiberacao.invalidate({ ordemId })
    utils.ordens.core.obterPorId.invalidate({ id: ordemId })
  }
  const salvarMut = trpc.ordens.financeiro.atualizarLiberacao.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const aprovarMut = trpc.ordens.financeiro.aprovarLiberacao.useMutation({ onSuccess: () => { toast.success('Aprovado'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-4">
      {data?.aprovado && <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Aprovado</Badge>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Forma de pagamento" defaultValue={forma} onChange={(e) => setForma(e.target.value)} disabled={!podeEditar} />
        <Input label="Condição de pagamento" defaultValue={condicao} onChange={(e) => setCondicao(e.target.value)} disabled={!podeEditar} />
        <Input label="Data prevista" defaultValue={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} disabled={!podeEditar} />
      </div>
      <div>
        <Input label={`Observações${travada ? ` 🔒 travada em ${formatarDataHora(data?.obsTravadaEm)}` : ''}`} value={obs} onChange={(e) => setObs(e.target.value)} disabled={!podeEditar || travada} />
        {podeEditar && (
          travada ? (
            <button onClick={() => salvarMut.mutate({ ordemId, travar: false })} className="mt-1.5 text-xs font-semibold text-gold-400 hover:text-gold-300">Editar observação</button>
          ) : (
            <Button size="sm" variant="secondary" className="mt-1.5" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, observacoes: obs, travar: true })}>Salvar observação</Button>
          )
        )}
      </div>
      {podeEditar && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, formaPagamento: forma, condicaoPagamento: condicao, dataPagamentoPrevista: dataPrevista })}>
            Salvar dados
          </Button>
          {!data?.aprovado && (
            <Button size="sm" loading={aprovarMut.isPending} onClick={() => aprovarMut.mutate({ ordemId })}>Aprovar liberação financeira</Button>
          )}
        </div>
      )}
    </div>
  )
}
