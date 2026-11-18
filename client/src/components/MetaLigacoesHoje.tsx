import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { PhoneCall } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'
import { NaoFoiConversaButton } from './LigacaoWhatsapp'

// Contador do topo: ligações efetivas de hoje (× meta diária, quando a
// empresa tem meta — Odin Tubos: 30/dia). Soma lead, carteira, prospecção,
// número fora do CRM e ligação pelo WhatsApp com print — router/pabx.ts.
// 2026-11-17 (João): aparece pra todo mundo que tem ramal (PABX ou GoTo) e,
// clicando, mostra as ligações de hoje com o botão "Não foi conversa".
const ROTULO: Record<string, string> = {
  atendida: 'Efetiva',
  curta: 'Curta (não conta)',
  caixa_postal: 'Não foi conversa',
  nao_atendida: 'Não atendeu',
  ocupado: 'Ocupado',
  falha: 'Falhou',
}

function duracao(seg: number | null) {
  if (!seg) return '—'
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return m ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s`
}

export default function MetaLigacoesHoje() {
  const { user } = useAuth()
  const [aberto, setAberto] = useState(false)
  const { data } = trpc.pabx.minhasLigacoesHoje.useQuery(undefined, { refetchInterval: 60_000, staleTime: 30_000 })
  if (!data) return null
  const temMeta = data.meta > 0
  const bateu = temMeta && data.efetivas >= data.meta
  const pct = temMeta ? Math.min(100, Math.round((data.efetivas / data.meta) * 100)) : 0
  const cor = bateu ? 'text-green-300 border-green-500/40 bg-green-500/10' : temMeta && pct >= 60 ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-dark-200 border-dark-600 bg-dark-800'

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title={`Ligações efetivas hoje (${data.minimoSegundos}s ou mais de conversa)${temMeta ? ' × meta do dia' : ''} — clique pra ver a lista`}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${cor}`}
      >
        <PhoneCall size={14} />
        <span className="font-mono">{temMeta ? `${data.efetivas}/${data.meta}` : data.efetivas}</span>
        <span className="hidden sm:inline font-normal">ligações hoje</span>
      </button>

      {aberto &&
        createPortal(
          <Modal open onClose={() => setAberto(false)} title="Minhas ligações de hoje" size="lg">
            <div className="space-y-3">
              <p className="text-xs text-dark-400">
                <b className="text-dark-200">{data.efetivas}</b> efetivas de <b className="text-dark-200">{data.tentativas}</b> ligações
                {temMeta ? ` · meta ${data.meta}/dia` : ''}. Conta como efetiva quem atendeu e conversou {data.minimoSegundos}s ou mais. Se uma efetiva foi caixa postal
                ou desligaram, clique em <b>Não foi conversa</b>.
              </p>
              {!data.ligacoes.length ? (
                <p className="text-sm text-dark-500">Nenhuma ligação hoje ainda.</p>
              ) : (
                <div className="divide-y divide-dark-700 border border-dark-700 rounded-xl">
                  {data.ligacoes.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-dark-400 w-11">
                        {l.dataHora ? new Date(l.dataHora.replace(' ', 'T') + 'Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </span>
                      <span className="flex-1 min-w-[8rem] truncate text-dark-100">
                        {l.fonte === 'whatsapp' ? '📱 ' : ''}
                        {l.contato ?? (l.numero && l.numero !== 'whatsapp' ? l.numero : 'Fora do CRM')}
                      </span>
                      <span className="font-mono text-xs text-dark-300">{duracao(l.duracao)}</span>
                      <span className={`text-xs ${l.efetiva ? 'text-green-300' : 'text-dark-400'}`}>{ROTULO[l.status ?? ''] ?? l.status}</span>
                      {l.anexoPrint && (
                        <a href={l.anexoPrint} target="_blank" rel="noreferrer" className="text-[11px] text-gold-400 underline">
                          print
                        </a>
                      )}
                      <NaoFoiConversaButton ligacaoId={l.id} efetiva={!!l.efetiva} tiradaPeloBotao={l.tiradaPeloBotao} />
                    </div>
                  ))}
                </div>
              )}
              {user?.role === 'admin' ? (
                <Link to="/admin/ligacoes" onClick={() => setAberto(false)} className="inline-block text-xs text-gold-400 underline">
                  Abrir relatório completo de ligações
                </Link>
              ) : (
                <Link to="/vendedor/ligacoes" onClick={() => setAberto(false)} className="inline-block text-xs text-gold-400 underline">
                  Ver todas as minhas ligações
                </Link>
              )}
            </div>
          </Modal>,
          document.body
        )}
    </>
  )
}
