import { useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { ImagePlus, X } from 'lucide-react'
import { trpc } from '../lib/trpc'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Textarea } from './ui/Input'

// "Ligação pelo WhatsApp" (João, 2026-11-17): o vendedor ligou pelo
// WhatsApp, tira print da tela da ligação (aparece a duração) e registra
// aqui. Conta na meta de ligações igual ao ramal — efetiva a partir do
// tempo mínimo (30s). Usado no card da carteira, no lead e na prospecção.
export function LigacaoWhatsappButton({
  clienteId,
  leadId,
  onRegistrada,
  className = '',
}: {
  clienteId?: number
  leadId?: number
  onRegistrada?: () => void
  className?: string
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={className} onClick={() => setAberto(true)}>
        📱 Ligação pelo WhatsApp
      </Button>
      {aberto && <LigacaoWhatsappModal clienteId={clienteId} leadId={leadId} onClose={() => setAberto(false)} onRegistrada={onRegistrada} />}
    </>
  )
}

// "Foi pelo WhatsApp" (João, 2026-11-18): na tela Ligações, a ligação da
// central que não completou vira ligação de WhatsApp (mesma linha, com print).
export function FoiPeloWhatsappButton({ ligacaoId }: { ligacaoId: number }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="A ligação pela central não completou e a conversa foi pelo WhatsApp"
        className="text-[11px] text-green-300 hover:text-green-200 underline"
      >
        📱 Foi pelo WhatsApp
      </button>
      {aberto && <LigacaoWhatsappModal ligacaoId={ligacaoId} onClose={() => setAberto(false)} />}
    </>
  )
}

function LigacaoWhatsappModal({
  clienteId,
  leadId,
  ligacaoId,
  onClose,
  onRegistrada,
}: {
  clienteId?: number
  leadId?: number
  ligacaoId?: number
  onClose: () => void
  onRegistrada?: () => void
}) {
  const utils = trpc.useUtils()
  const [minutos, setMinutos] = useState('')
  const [segundos, setSegundos] = useState('')
  const [observacao, setObservacao] = useState('')
  const [print, setPrint] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  function escolherPrint(f: File | undefined | null) {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast.error('O print precisa ser uma imagem')
    if (previa) URL.revokeObjectURL(previa)
    setPrint(f)
    setPrevia(URL.createObjectURL(f))
  }

  const mut = trpc.pabx.registrarWhatsapp.useMutation()
  const converter = trpc.pabx.converterWhatsapp.useMutation()

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const total = (Number(minutos) || 0) * 60 + (Number(segundos) || 0)
    if (total <= 0) return toast.error('Coloque quanto tempo durou a ligação (está no print)')
    if (!print) return toast.error('Anexe o print da tela da ligação')
    setEnviando(true)
    try {
      const form = new FormData()
      form.append('file', print, print.name || 'print-ligacao-whatsapp.jpg')
      const res = await fetch('/upload/lead-attachment', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
      if (!res.ok) throw new Error('Não consegui enviar o print')
      const up = await res.json()
      const printInfo = { filename: up.path, originalName: up.originalName, mimeType: up.mimeType, size: up.size }
      const r = ligacaoId
        ? await converter.mutateAsync({ id: ligacaoId, duracaoSegundos: total, print: printInfo, observacao: observacao.trim() || undefined })
        : await mut.mutateAsync({ clienteId, leadId, duracaoSegundos: total, print: printInfo, observacao: observacao.trim() || undefined })
      toast.success(r.efetiva ? 'Ligação registrada — contou como efetiva' : `Ligação registrada — abaixo de ${r.minimo}s, não conta como efetiva`)
      utils.invalidate()
      onRegistrada?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar')
    } finally {
      setEnviando(false)
    }
  }

  // Portal: o botão fica dentro de outra janela (card, lead, prospect).
  return createPortal(
    <Modal open onClose={onClose} title="📱 Ligação pelo WhatsApp" size="sm">
      <form
        onSubmit={salvar}
        className="space-y-3"
        onPaste={(e) => {
          const f = Array.from(e.clipboardData.files ?? []).find((x) => x.type.startsWith('image/'))
          if (f) {
            e.preventDefault()
            escolherPrint(f)
          }
        }}
      >
        <p className="text-xs text-dark-400">
          Tire um print da tela da ligação no WhatsApp (onde aparece o tempo) e anexe aqui. Conta na meta como efetiva a partir de 30 segundos.
        </p>

        <div
          className="rounded-xl border-2 border-dashed border-dark-600 bg-dark-800/60 p-3 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            escolherPrint(e.dataTransfer.files?.[0])
          }}
        >
          {previa ? (
            <div className="relative inline-block">
              <img src={previa} alt="print da ligação" className="max-h-48 rounded-lg border border-dark-600" />
              <button
                type="button"
                onClick={() => {
                  if (previa) URL.revokeObjectURL(previa)
                  setPrint(null)
                  setPrevia(null)
                }}
                className="absolute -top-2 -right-2 bg-dark-900 border border-dark-600 rounded-full p-0.5 text-dark-300 hover:text-red-400"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <label className="cursor-pointer text-xs text-dark-300 flex flex-col items-center gap-1">
              <ImagePlus size={20} className="text-gold-400" />
              <span>
                <b>Ctrl+V</b> pra colar o print, arraste aqui ou <span className="text-gold-400 underline">escolha o arquivo</span> *
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => escolherPrint(e.target.files?.[0])} />
            </label>
          )}
        </div>

        <div>
          <label className="text-sm text-dark-200 font-medium block mb-1">Quanto tempo durou? *</label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="min" inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            <Input placeholder="seg" inputMode="numeric" value={segundos} onChange={(e) => setSegundos(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        </div>

        <Textarea label="O que foi conversado (opcional)" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" loading={enviando}>
            Registrar ligação
          </Button>
        </div>
      </form>
    </Modal>,
    document.body
  )
}

// Botão "Não foi conversa" — tira a ligação das efetivas (caixa postal,
// atendeu e desligou). "Desfazer" devolve, se foi tirada por engano.
export function NaoFoiConversaButton({ ligacaoId, efetiva, tiradaPeloBotao }: { ligacaoId: number; efetiva: boolean; tiradaPeloBotao: boolean }) {
  const utils = trpc.useUtils()
  const mut = trpc.pabx.marcarNaoEfetiva.useMutation({
    onSuccess(_d, v) {
      toast.success(v.desfazer ? 'Voltou a contar como efetiva' : 'Tirada das efetivas')
      utils.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })
  if (efetiva)
    return (
      <button
        type="button"
        disabled={mut.isPending}
        onClick={() => mut.mutate({ id: ligacaoId, desfazer: false })}
        title="Foi caixa postal ou desligaram na hora — tira essa ligação das efetivas"
        className="text-[11px] text-amber-300 hover:text-amber-200 underline disabled:opacity-50"
      >
        Não foi conversa (caixa postal)
      </button>
    )
  if (tiradaPeloBotao)
    return (
      <span className="text-[11px] text-dark-400">
        Tirada das efetivas ·{' '}
        <button type="button" disabled={mut.isPending} onClick={() => mut.mutate({ id: ligacaoId, desfazer: true })} className="underline hover:text-dark-200 disabled:opacity-50">
          desfazer
        </button>
      </span>
    )
  return null
}
