import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'

export default function EtapaFreteFinalizado({ ordemId, isAdmin, readonly }: { ordemId: number; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data: aprovacao } = trpc.ordens.frete.obterAprovacao.useQuery({ ordemId })
  const { data: finalizado } = trpc.ordens.frete.obterFreteFinalizado.useQuery({ ordemId })
  const [obs, setObs] = useState('')
  const podeEditar = isAdmin && !readonly

  const confirmarMut = trpc.ordens.frete.confirmarFreteFinalizado.useMutation({
    onSuccess: () => { toast.success('Frete finalizado confirmado'); utils.ordens.frete.obterFreteFinalizado.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  const metodoDefinido = !!(aprovacao?.cotacaoSelecionadaId || aprovacao?.retiradaLocal || aprovacao?.semFrete)

  return (
    <div className="space-y-4 border-t border-dark-700 pt-4">
      <p className="text-xs font-semibold text-dark-500 uppercase tracking-wide">Frete Finalizado</p>
      {finalizado?.confirmado ? (
        <>
          <Badge className="text-green-400 bg-green-900/20 border-green-700/40">Confirmado</Badge>
          {finalizado.observacoes && <p className="text-sm text-dark-300">{finalizado.observacoes}</p>}
        </>
      ) : (
        <>
          {!metodoDefinido && <p className="text-xs text-yellow-500">⚠️ Escolha uma cotação, retirada local ou "sem frete" antes de confirmar</p>}
          {podeEditar && (
            <>
              <Input label="Observações" value={obs} onChange={(e) => setObs(e.target.value)} />
              <Button size="sm" disabled={!metodoDefinido} loading={confirmarMut.isPending} onClick={() => confirmarMut.mutate({ ordemId, observacoes: obs })}>
                FRETE FINALIZADO — OK
              </Button>
            </>
          )}
        </>
      )}
    </div>
  )
}
