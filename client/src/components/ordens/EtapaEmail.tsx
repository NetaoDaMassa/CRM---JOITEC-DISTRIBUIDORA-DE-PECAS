import { trpc } from '../../lib/trpc'
import { STAGE_LABELS, type Stage } from '../../lib/ordensShared'

export default function EtapaEmail({ ordemId, stage, clienteEmail }: { ordemId: number; stage: Stage; clienteEmail?: string | null }) {
  const { data: modelos, isLoading } = trpc.configuracoesOdin.listarModelosEmail.useQuery(undefined, { retry: false })

  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  const filtrados = (modelos ?? []).filter((m) => !m.etapa || m.etapa === stage)

  function abrir(m: { assunto: string; mensagem: string }) {
    if (!clienteEmail) { return }
    window.open(`mailto:${clienteEmail}?subject=${encodeURIComponent(m.assunto)}&body=${encodeURIComponent(m.mensagem)}`)
  }

  if (filtrados.length === 0) {
    return <p className="text-sm text-dark-400 text-center py-4">Nenhum modelo para esta etapa ({STAGE_LABELS[stage]})</p>
  }

  return (
    <div className="space-y-3">
      {!clienteEmail && <p className="text-xs text-yellow-500">Cliente sem e-mail cadastrado — o rascunho não vai ter destinatário preenchido.</p>}
      {filtrados.map((m) => (
        <div key={m.id} className="p-3 rounded-lg border border-dark-600 bg-dark-800 space-y-1.5">
          <p className="text-sm font-medium text-dark-100">{m.nome}</p>
          <p className="text-xs text-dark-400 whitespace-pre-line line-clamp-3">{m.mensagem}</p>
          <button onClick={() => abrir(m)} className="text-xs font-semibold text-gold-400 hover:text-gold-300">Abrir no cliente de e-mail</button>
        </div>
      ))}
    </div>
  )
}
