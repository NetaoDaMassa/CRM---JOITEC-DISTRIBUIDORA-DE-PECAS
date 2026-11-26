import { useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'

// Ficha do lead → conversa do WhatsApp da empresa capturada pelo CRM
// (WhatsApp → captura de leads, João 2026-11-25). Recebidas à esquerda,
// enviadas (pelo celular da empresa) à direita. Não aparece se não há conversa.

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })

// Também serve para a ficha do cliente da carteira (clienteId): número que já é
// cliente não vira lead, a conversa fica no cliente.
export default function ConversaWhatsappLead({ leadId, clienteId }: { leadId?: number; clienteId?: number }) {
  const doLead = trpc.leads.whatsappConversa.useQuery({ id: leadId ?? 0 }, { enabled: !!leadId, refetchInterval: 20000 })
  const doCliente = trpc.whatsappCaptura.conversaCliente.useQuery({ id: clienteId ?? 0 }, { enabled: !!clienteId, refetchInterval: 20000, retry: false })
  const data = leadId ? doLead.data : doCliente.data
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [data?.length])
  // Card aberto com mensagem nova do cliente: dá baixa (só conta se quem abriu
  // é o vendedor dono — o servidor decide). Guarda quais eram novas para
  // continuar destacadas enquanto o card está aberto.
  const utils = trpc.useUtils()
  const [novasIds, setNovasIds] = useState<Set<number>>(new Set())
  const marcar = trpc.whatsappCaptura.marcarVistas.useMutation({ onSuccess: () => { utils.whatsappCaptura.naoVistas.invalidate() } })
  const lista = (clienteId ? doCliente.data : undefined) as { id: number; direcao: string; vistaEm?: string | null }[] | undefined
  const pendentes = (lista ?? []).filter((m) => m.direcao === 'recebida' && !m.vistaEm).map((m) => m.id)
  const chavePend = pendentes.join(',')
  useEffect(() => {
    if (!clienteId || !pendentes.length) return
    setNovasIds((s) => new Set([...s, ...pendentes]))
    marcar.mutate({ clienteId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, chavePend])
  if (!data?.length) return null
  let diaAnterior = ''
  return (
    <div className="bg-dark-800 border border-emerald-500/30 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-dark-100 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-emerald-400" /> Conversa WhatsApp{novasIds.size > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">{novasIds.size} nova{novasIds.size > 1 ? 's' : ''}</span>}</p>
        <span className="text-xs text-dark-500">{data.length} mensage{data.length === 1 ? 'm' : 'ns'} · atualiza sozinha</span>
      </div>
      <div className="max-h-[28rem] overflow-y-auto space-y-1.5 rounded-xl bg-dark-900/60 p-3">
        {data.map((m) => {
          const d = dia(m.enviadaEm)
          const cabecalho = d !== diaAnterior ? d : ''
          diaAnterior = d
          const recebida = m.direcao === 'recebida'
          return (
            <div key={m.id}>
              {cabecalho && <p className="text-center text-[10px] uppercase tracking-wide text-dark-500 my-2">{cabecalho}</p>}
              <div className={`flex ${recebida ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${recebida ? 'bg-dark-700 text-dark-100' : 'bg-emerald-600/25 text-emerald-50'} ${novasIds.has(m.id) ? 'ring-2 ring-emerald-400' : ''}`}>
                  {m.texto}
                  <p className={`text-[10px] mt-0.5 ${recebida ? 'text-dark-400' : 'text-emerald-200/70'}`}>{recebida ? (m.pushName || 'Cliente') : 'Empresa'} · {quando(m.enviadaEm)}</p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={fim} />
      </div>
    </div>
  )
}
