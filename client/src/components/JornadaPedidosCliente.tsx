import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { textoVolumes } from '../lib/volumesExpedicao'
import ConversarSobreIssoButton from './chat/ConversarSobreIssoButton'
import HistoricoAgendamentos from './HistoricoAgendamentos'

const PASSOS = ['aprovacao', 'pedido', 'separacao', 'conferencia', 'embalagem', 'nf', 'agendamento', 'coleta', 'coletado'] as const
const ROTULO: Record<(typeof PASSOS)[number], string> = {
  aprovacao: 'Financeiro',
  pedido: 'Pedido',
  separacao: 'Separação',
  conferencia: 'Conferência',
  embalagem: 'Embalagem',
  nf: 'NF',
  agendamento: 'Agendamento',
  coleta: 'Coleta',
  coletado: 'Coletado',
}

function dataHoraBr(utc: string | null): string {
  if (!utc) return ''
  return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Onde está cada pedido do cliente, do "aguardando financeiro" até
// "coletado" (pedido do João, 2026-10-29) — card do Kanban e ficha. Os dados
// vêm do SAP (pedidos/aprovações) e da Expedição (quem está separando etc.).
export default function JornadaPedidosCliente({ clienteId }: { clienteId: number }) {
  const { data } = trpc.expedicao.jornadaCliente.useQuery({ clienteId })
  if (!data || data.length === 0) return null
  return (
    <div className="rounded-xl border border-dark-600 bg-dark-900/40 p-3 space-y-3">
      <p className="text-sm font-semibold text-dark-100">📦 Pedidos em andamento</p>
      {data.map((p, i) => {
        const atual = PASSOS.indexOf(p.etapa as (typeof PASSOS)[number])
        return (
          <div key={`${p.pedido}-${i}`} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-dark-100">
                Pedido <b>{p.pedido}</b> · <span className={p.atrasado ? 'text-red-300' : 'text-cyan-300'}>{p.texto}</span>
                {p.atrasado && <span className="ml-1 text-xs font-semibold text-red-300">(passou das 48h)</span>}
              </p>
              <p className="text-[11px] text-dark-500">
                {p.detalhe ? `${p.detalhe} · ` : ''}
                {dataHoraBr(p.data)}
              </p>
            </div>
            <ol className="flex gap-1">
              {PASSOS.filter((s) => s !== 'aprovacao' || p.etapa === 'aprovacao').map((s) => {
                const idx = PASSOS.indexOf(s)
                const feito = idx < atual || p.etapa === 'coletado'
                const agora = idx === atual && p.etapa !== 'coletado'
                return (
                  <li
                    key={s}
                    className={`flex-1 text-center text-[10px] rounded px-1 py-0.5 ${
                      feito ? 'bg-green-900/30 text-green-300' : agora ? (p.atrasado ? 'bg-red-900/40 text-red-200' : 'bg-cyan-900/40 text-cyan-200') : 'bg-dark-800 text-dark-500'
                    }`}
                  >
                    {ROTULO[s]}
                  </li>
                )
              })}
            </ol>
            {p.podeAgendar && p.expedicaoId && (
              <AgendarColeta expedicaoId={p.expedicaoId} pedido={p.pedido} jaAgendada={p.etapa === 'coleta'} transportadora={p.transportadora ?? ''} coletaAgendada={p.coletaAgendada ?? ''} volumes={textoVolumes(p)} />
            )}
            {p.agendamentos && p.agendamentos.length > 1 && <HistoricoAgendamentos agendamentos={p.agendamentos} />}
            {p.entrySap ? (
              <ConversarSobreIssoButton tipoOrigem="expedicao" idOrigem={p.entrySap} titulo={`Pedido ${p.pedido} — expedição`} rotulo="Falar com a expedição" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// Odin Tubos: o vendedor agenda (ou reagenda) a coleta pelo card, depois que
// a NF sai (João 2026-11-12). Cada mudança fica no histórico de tentativas.
function AgendarColeta({ expedicaoId, pedido, jaAgendada, transportadora: t0, coletaAgendada: c0, volumes }: { expedicaoId: number; pedido: string; jaAgendada: boolean; transportadora: string; coletaAgendada: string; volumes: string | null }) {
  const utils = trpc.useUtils()
  const [aberto, setAberto] = useState(!jaAgendada)
  const [transportadora, setTransportadora] = useState(t0)
  const [quando, setQuando] = useState(c0)
  const agendar = trpc.expedicao.agendarPeloVendedor.useMutation({
    onSuccess: () => {
      toast.success(`Coleta do pedido ${pedido} agendada`)
      utils.expedicao.jornadaCliente.invalidate()
      utils.expedicao.jornadaMapa.invalidate()
      setAberto(false)
    },
    onError: (e) => toast.error(e.message),
  })
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline">
        📅 Reagendar coleta
      </button>
    )
  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-900/15 p-2.5 space-y-2">
      <p className="text-sm font-bold text-amber-200">📅 {jaAgendada ? 'Reagendar' : 'Agendar'} a coleta — a NF já saiu</p>
      <p className="text-sm text-dark-100">📦 {volumes ?? 'Volumes ainda não informados pelo estoque'}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end">
        <label className="text-xs text-dark-300 space-y-1">
          <span>Transportadora</span>
          <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-sm text-dark-100" />
        </label>
        <label className="text-xs text-dark-300 space-y-1">
          <span>Dia e hora que pediram</span>
          <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-sm text-dark-100" />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!transportadora.trim() || !quando || agendar.isPending}
            onClick={() => agendar.mutate({ id: expedicaoId, transportadora, coletaAgendada: quando })}
            className="rounded-lg bg-gold-600 border border-gold-500 px-3 py-1.5 text-sm font-semibold text-dark-950 hover:bg-gold-500 disabled:opacity-50"
          >
            {agendar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {jaAgendada && (
            <button type="button" onClick={() => setAberto(false)} className="rounded-lg border border-dark-600 px-3 py-1.5 text-sm text-dark-300 hover:bg-dark-800">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
