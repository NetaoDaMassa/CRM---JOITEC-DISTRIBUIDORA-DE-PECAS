import { useEffect, useRef } from 'react'
import { MessageCircle } from 'lucide-react'
import { trpc } from '../lib/trpc'

// Ficha do lead → conversa do WhatsApp da empresa capturada pelo CRM
// (WhatsApp → captura de leads, João 2026-11-25). Recebidas à esquerda,
// enviadas (pelo celular da empresa) à direita. Não aparece se não há conversa.

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })

export default function ConversaWhatsappLead({ leadId }: { leadId: number }) {
  const { data } = trpc.leads.whatsappConversa.useQuery({ id: leadId }, { refetchInterval: 20000 })
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [data?.length])
  if (!data?.length) return null
  let diaAnterior = ''
  return (
    <div className="bg-dark-800 border border-emerald-500/30 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-dark-100 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-emerald-400" /> Conversa WhatsApp</p>
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
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${recebida ? 'bg-dark-700 text-dark-100' : 'bg-emerald-600/25 text-emerald-50'}`}>
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
