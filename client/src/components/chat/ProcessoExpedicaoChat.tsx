import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { trpc } from '../../lib/trpc'

// SQLite em UTC ("YYYY-MM-DD HH:MM:SS") → "05/11 08:10" no horário do Brasil.
function dataHora(utc: string | null): string {
  if (!utc) return ''
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

// Coleta agendada já vem no horário local ("YYYY-MM-DD HH:MM").
function agenda(v: string): string {
  return `${v.slice(8, 10)}/${v.slice(5, 7)}${v.length > 10 ? ` ${v.slice(11, 16)}` : ''}`
}

const TIPO_ERRO: Record<string, string> = { faltou: 'Faltou', sobrou: 'Sobrou', trocado: 'Item trocado', quantidade: 'Quantidade errada', avaria: 'Avaria', outro: 'Erro' }

// Quadro no topo da conversa "Falar com a expedição": a situação do pedido
// agora, não uma foto de quando a conversa começou. Pedido do João, 2026-11-05.
export default function ProcessoExpedicaoChat({ conversaId }: { conversaId: number }) {
  const [aberto, setAberto] = useState(true)
  const { data: cards } = trpc.chat.conversas.processoExpedicao.useQuery({ conversaId }, { refetchInterval: 30_000 })
  if (!cards?.length) return null

  return (
    <div className="border-b border-dark-700 bg-dark-900/50 shrink-0 text-xs">
      {cards.map((c) => {
        const atual = c.passos.find((p) => p.estado === 'agora')
        const situacao = c.encerrado ? (c.encerrado.tipo === 'cancelado' ? 'Cancelado' : 'Descartado') : c.etapa === 'coletado' ? 'Coletado' : atual?.nome
        return (
          <div key={c.id} className="px-3 py-2">
            <button type="button" onClick={() => setAberto((a) => !a)} className="w-full flex items-center justify-between gap-2 text-left">
              <span className="min-w-0 truncate text-dark-100">
                <b>Pedido {c.pedido}</b> {c.cliente ? `· ${c.cliente}` : ''}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${c.encerrado ? 'bg-red-900/40 text-red-200' : c.atrasado ? 'bg-red-900/40 text-red-200' : 'bg-cyan-900/40 text-cyan-200'}`}>
                  {situacao}
                  {c.atrasado ? ' · passou das 48h' : ''}
                </span>
                {aberto ? <ChevronUp size={14} className="text-dark-400" /> : <ChevronDown size={14} className="text-dark-400" />}
              </span>
            </button>
            {aberto && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {c.passos.map((p) => (
                  <div key={p.chave} className={`flex gap-1.5 ${p.estado === 'futuro' ? 'text-dark-500' : 'text-dark-200'}`}>
                    <span className={`w-3 shrink-0 ${p.estado === 'feito' ? 'text-green-400' : p.estado === 'agora' ? 'text-cyan-300' : ''}`}>{p.estado === 'feito' ? '✓' : p.estado === 'agora' ? '●' : '○'}</span>
                    <span className="w-[78px] shrink-0">{p.nome}</span>
                    <span className="min-w-0">
                      {[
                        p.quem,
                        p.inicio && p.fim ? `${dataHora(p.inicio)} → ${dataHora(p.fim)}` : p.inicio ? `desde ${dataHora(p.inicio)}` : p.fim ? dataHora(p.fim) : null,
                        p.chave === 'agendamento' && p.info ? agenda(p.info) : p.info,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {p.erros > 0 && <span className="ml-1 font-semibold text-red-300">({p.erros} {p.erros === 1 ? 'erro' : 'erros'})</span>}
                    </span>
                  </div>
                ))}
                <p className="text-dark-400 pt-0.5">
                  {[c.empresa, `picking ${c.picking}`, c.volumes ? `${c.volumes} volume(s)` : null, c.transportadora].filter(Boolean).join(' · ')}
                </p>
                {c.pausa && <p className="text-amber-300">⏸ Pausado desde {dataHora(c.pausa.em)}{c.pausa.motivo ? ` — ${c.pausa.motivo}` : ''}</p>}
                {c.alteracaoSap && <p className="text-orange-300">✎ {c.alteracaoSap}</p>}
                {c.encerrado?.motivo && <p className="text-red-300">Motivo: {c.encerrado.motivo}</p>}
                {c.erros.map((e) => (
                  <p key={e.id} className="text-red-300">
                    ⚠ {TIPO_ERRO[e.tipo] ?? 'Erro'}{e.descricao ? `: ${e.descricao}` : ''}{e.quantidade ? ` (${e.quantidade})` : ''}{e.observacao ? ` — ${e.observacao}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
