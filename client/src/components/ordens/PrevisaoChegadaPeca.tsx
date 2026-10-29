// Previsão de chegada das peças ao cliente (parte 1 do Pós-venda do pedido de
// PEÇA, Odin Compressores) — aparece no Calendário Odin. Pedido do João,
// 2026-10-29.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarClock, ExternalLink } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

export default function PrevisaoChegadaPeca({ ordemId, readonly }: { ordemId: number; readonly: boolean }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.posVendaOdin.previsaoChegadaObter.useQuery({ ordemId })
  const [data_, setData] = useState('')
  useEffect(() => setData(data?.previsaoChegada ?? ''), [data?.previsaoChegada])
  const salvarMut = trpc.posVendaOdin.previsaoChegadaSalvar.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.previsaoChegada ? 'Previsão salva — já aparece no Calendário' : 'Previsão removida')
      utils.posVendaOdin.previsaoChegadaObter.invalidate({ ordemId })
    },
    onError: (e) => toast.error(e.message),
  })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  const mudou = data_ !== (data?.previsaoChegada ?? '')

  return (
    <section className="p-4 rounded-xl border border-dark-700 bg-dark-900/40">
        <h3 className="text-sm font-semibold text-dark-100 mb-1 flex items-center gap-2"><CalendarClock size={15} className="text-gold-400" /> 1. Previsão de chegada</h3>
        <p className="text-xs text-dark-400 mb-3">
          Quando as peças devem chegar ao cliente. A data aparece no <b>Calendário Odin</b> (fica vermelha se passar e o pedido ainda não estiver concluído).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Data prevista" type="date" value={data_} onChange={(e) => setData(e.target.value)} disabled={readonly} />
          {!readonly && (
            <Button size="sm" disabled={!mudou} loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, previsaoChegada: data_ || null })}>
              Salvar
            </Button>
          )}
        </div>
        {(data?.transportadora || data?.codigoRastreio) && (
          <p className="text-xs text-dark-500 mt-3">
            Envio: {[data.transportadora, data.codigoRastreio && `rastreio ${data.codigoRastreio}`].filter(Boolean).join(' · ')}
            {data.linkRastreio && (
              <a href={data.linkRastreio} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline ml-2">
                <ExternalLink size={12} /> acompanhar
              </a>
            )}
          </p>
        )}
    </section>
  )
}
