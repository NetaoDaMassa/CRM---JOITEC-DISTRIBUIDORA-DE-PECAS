import { trpc } from '../../lib/trpc'
import GravacaoLigacao from './GravacaoLigacao'

// Ligações do PABX com gravação, na ficha do lead / do prospect (João,
// 2026-11-05). O link da gravação chega alguns minutos depois da ligação.
function quando(utc: string | null): string {
  if (!utc) return '—'
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function duracao(seg: number | null): string {
  if (!seg) return '0s'
  const m = Math.floor(seg / 60)
  return m ? `${m}min ${seg % 60}s` : `${seg}s`
}

export default function GravacoesDoContato({ leadId, clienteId, className = '' }: { leadId?: number; clienteId?: number; className?: string }) {
  const { data } = trpc.pabx.gravacoesDoContato.useQuery({ leadId, clienteId }, { refetchInterval: 2 * 60_000 })
  if (!data?.length) return null
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-dark-400 mb-2">📞 Ligações (PABX)</p>
      <div className="space-y-2">
        {data.map((l) => (
          <div key={l.id} className="rounded-lg border border-dark-700 p-2 text-xs">
            <p className="text-dark-300">
              {l.direcao === 'INBOUND' ? 'Recebida' : 'Feita'} · {quando(l.dataHora)} · {l.quem ?? `ramal ${l.ramal ?? '?'}`} · {duracao(l.duracao)} ·{' '}
              {l.efetiva ? <span className="text-green-400">atendida</span> : <span className="text-dark-500">não atendida</span>}
            </p>
            {l.partes > 0 ? (
              <div className="mt-1">
                <GravacaoLigacao ligacaoId={l.id} partes={l.partes} />
              </div>
            ) : (
              l.efetiva && <p className="mt-1 text-[11px] text-dark-500">🎧 A gravação aparece aqui alguns minutos depois da ligação.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
