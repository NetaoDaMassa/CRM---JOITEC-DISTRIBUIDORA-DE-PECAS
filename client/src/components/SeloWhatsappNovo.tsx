import { useMemo } from 'react'
import { trpc } from '../lib/trpc'

// Selo "💬 mensagem nova no WhatsApp" nos cards de cliente (Kanban da carteira e
// Prospecção). Some só quando o vendedor dono abre o card e vê a conversa
// (ConversaWhatsappLead dá baixa). João, 2026-11-26.

export type MensagemNova = { clienteId: number; qtd: number; ultima: string; texto: string }

export function useMensagensNovasWhatsapp() {
  const { data } = trpc.whatsappCaptura.naoVistas.useQuery(undefined, { refetchInterval: 30_000, staleTime: 15_000, retry: false })
  return useMemo(() => new Map((data ?? []).map((m) => [m.clienteId, m as MensagemNova])), [data])
}

export default function SeloWhatsappNovo({ m, className = '' }: { m: MensagemNova | undefined; className?: string }) {
  if (!m) return null
  return (
    <p
      className={`text-xs font-semibold text-white bg-emerald-600 border border-emerald-400 rounded-lg px-2 py-1 animate-pulse ${className}`}
      title={`"${m.texto}" — abra o card para ver a conversa`}
    >
      💬 {m.qtd} mensage{m.qtd > 1 ? 'ns novas' : 'm nova'} no WhatsApp · abra o card
    </p>
  )
}
