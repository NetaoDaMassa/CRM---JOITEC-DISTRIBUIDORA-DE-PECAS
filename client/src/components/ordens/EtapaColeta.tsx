import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { Badge } from '../ui/Badge'

export default function EtapaColeta({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const { data, isLoading } = trpc.ordens.pos.obterColeta.useQuery({ ordemId })
  const { data: aprovacao } = trpc.ordens.frete.obterAprovacao.useQuery({ ordemId })
  const { data: cotacoes } = trpc.ordens.frete.listarCotacoes.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  const cotacaoSelecionada = cotacoes?.find((c) => c.id === aprovacao?.cotacaoSelecionadaId)
  const escondeTransportadora = !!(aprovacao?.retiradaLocal || aprovacao?.semFrete)
  return <EtapaColetaForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} data={data ?? null} transportadoraSugerida={cotacaoSelecionada?.transportadora ?? null} escondeTransportadora={escondeTransportadora} />
}

function EtapaColetaForm({
  ordemId,
  isAdmin,
  readonly,
  data,
  transportadoraSugerida,
  escondeTransportadora,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  data: { confirmado: boolean; dataColeta: string | null; horaColetaInicio: string | null; horaColetaFim: string | null; transportadora: string | null; observacoes: string | null; confirmadoEm?: string | null } | null
  transportadoraSugerida: string | null
  escondeTransportadora: boolean
}) {
  const utils = trpc.useUtils()
  const [dataColeta, setDataColeta] = useState(data?.dataColeta ?? '')
  const [horaInicio, setHoraInicio] = useState(data?.horaColetaInicio ?? '')
  const [horaFim, setHoraFim] = useState(data?.horaColetaFim ?? '')
  const [transportadora, setTransportadora] = useState(data?.transportadora ?? transportadoraSugerida ?? '')
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const podeEditar = !readonly

  function invalidar() { utils.ordens.pos.obterColeta.invalidate({ ordemId }) }
  const salvarMut = trpc.ordens.pos.atualizarColeta.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const confirmarMut = trpc.ordens.pos.confirmarColeta.useMutation({ onSuccess: () => { toast.success('Coleta confirmada'); invalidar() }, onError: (e) => toast.error(e.message) })

  return (
    <div className="space-y-4">
      {data?.confirmado ? (
        <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Coleta Confirmada</Badge>
      ) : (
        <p className="text-xs text-yellow-500">Aguardando confirmação</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Input label="Data da coleta" type="date" defaultValue={dataColeta} onChange={(e) => setDataColeta(e.target.value)} disabled={!podeEditar} />
        <Input label="Hora — De" type="time" defaultValue={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} disabled={!podeEditar} />
        <Input label="Hora — Até" type="time" defaultValue={horaFim} onChange={(e) => setHoraFim(e.target.value)} disabled={!podeEditar} />
      </div>
      {!escondeTransportadora && (
        <Input label="Transportadora" defaultValue={transportadora} onChange={(e) => setTransportadora(e.target.value)} disabled={!podeEditar} />
      )}
      <Textarea label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!podeEditar} />
      <div className="flex gap-2">
        {podeEditar && (
          <Button size="sm" variant="secondary" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, dataColeta, horaColetaInicio: horaInicio, horaColetaFim: horaFim, transportadora, observacoes: obs })}>
            Salvar Programação
          </Button>
        )}
        {isAdmin && podeEditar && !data?.confirmado && <Button size="sm" loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId })}>CONFIRMAR COLETA — OK</Button>}
      </div>
    </div>
  )
}
