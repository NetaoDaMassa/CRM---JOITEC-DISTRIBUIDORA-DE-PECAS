import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'

export default function EtapaRastreio({
  ordemId,
  isAdmin,
  readonly,
  clienteNome,
  clienteWhatsapp,
  clienteEmail,
  vendedorWhatsapp,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  clienteNome?: string | null
  clienteWhatsapp?: string | null
  clienteEmail?: string | null
  vendedorWhatsapp?: string | null
}) {
  const { data, isLoading } = trpc.ordens.pos.obterRastreio.useQuery({ ordemId })
  const { data: coleta } = trpc.ordens.pos.obterColeta.useQuery({ ordemId })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return (
    <EtapaRastreioForm
      ordemId={ordemId}
      isAdmin={isAdmin}
      readonly={readonly}
      data={data ?? null}
      transportadoraSugerida={coleta?.transportadora ?? null}
      clienteNome={clienteNome}
      clienteWhatsapp={clienteWhatsapp}
      clienteEmail={clienteEmail}
      vendedorWhatsapp={vendedorWhatsapp}
    />
  )
}

function EtapaRastreioForm({
  ordemId,
  isAdmin,
  readonly,
  data,
  transportadoraSugerida,
  clienteNome,
  clienteWhatsapp,
  clienteEmail,
  vendedorWhatsapp,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  data: { codigoRastreio: string | null; linkRastreio: string | null; transportadora: string | null; observacoes: string | null } | null
  transportadoraSugerida: string | null
  clienteNome?: string | null
  clienteWhatsapp?: string | null
  clienteEmail?: string | null
  vendedorWhatsapp?: string | null
}) {
  const utils = trpc.useUtils()
  const [codigo, setCodigo] = useState(data?.codigoRastreio ?? '')
  const [link, setLink] = useState(data?.linkRastreio ?? '')
  const [transportadora, setTransportadora] = useState(data?.transportadora ?? transportadoraSugerida ?? '')
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const podeEditar = isAdmin && !readonly

  const salvarMut = trpc.ordens.pos.atualizarRastreio.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.pos.obterRastreio.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  function textoResumo() {
    return `Rastreio do Pedido #${ordemId}\nCliente: ${clienteNome || '—'}\nTransportadora: ${transportadora || '—'}\nCódigo: ${codigo || '—'}\nLink: ${link || '—'}${obs ? `\nObs: ${obs}` : ''}`
  }
  function copiarTudo() {
    navigator.clipboard.writeText(textoResumo())
    toast.success('Copiado')
  }
  function enviarCliente(via: 'whatsapp' | 'email') {
    if (via === 'whatsapp') {
      if (!clienteWhatsapp) { toast.error('Cliente sem WhatsApp cadastrado'); return }
      window.open(`https://wa.me/${clienteWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(textoResumo())}`, '_blank')
    } else {
      if (!clienteEmail) { toast.error('Cliente sem e-mail cadastrado'); return }
      window.open(`mailto:${clienteEmail}?subject=${encodeURIComponent(`Rastreio - Pedido #${ordemId}`)}&body=${encodeURIComponent(textoResumo())}`)
    }
  }
  function enviarVendedor() {
    if (!vendedorWhatsapp) { toast.error('Vendedor sem WhatsApp cadastrado'); return }
    window.open(`https://wa.me/${vendedorWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(textoResumo())}`, '_blank')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Transportadora" defaultValue={transportadora} onChange={(e) => setTransportadora(e.target.value)} disabled={!podeEditar} />
        <Input label="Código de rastreio" defaultValue={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={!podeEditar} />
        <Input label="Link de rastreio" defaultValue={link} onChange={(e) => setLink(e.target.value)} disabled={!podeEditar} className="col-span-2" />
      </div>
      <Textarea label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!podeEditar} />
      {podeEditar && (
        <Button size="sm" loading={salvarMut.isPending} onClick={() => salvarMut.mutate({ ordemId, codigoRastreio: codigo, linkRastreio: link, transportadora, observacoes: obs })}>Salvar</Button>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-dark-700">
        <button onClick={copiarTudo} className="text-xs text-dark-400 hover:text-gold-400">Copiar todos os dados</button>
        <button onClick={() => enviarCliente('whatsapp')} className="text-xs text-dark-400 hover:text-green-400">Enviar pro cliente{clienteNome ? ` (${clienteNome})` : ''} — WhatsApp</button>
        <button onClick={() => enviarCliente('email')} className="text-xs text-dark-400 hover:text-blue-400">Enviar pro cliente — E-mail</button>
        <button onClick={enviarVendedor} className="text-xs text-dark-400 hover:text-green-400">Enviar pro vendedor — WhatsApp</button>
      </div>
    </div>
  )
}
