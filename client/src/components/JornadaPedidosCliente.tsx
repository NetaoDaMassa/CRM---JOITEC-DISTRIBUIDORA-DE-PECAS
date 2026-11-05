import { trpc } from '../lib/trpc'
import ConversarSobreIssoButton from './chat/ConversarSobreIssoButton'

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
            {p.entrySap ? (
              <ConversarSobreIssoButton tipoOrigem="expedicao" idOrigem={p.entrySap} titulo={`Pedido ${p.pedido} — expedição`} rotulo="Falar com a expedição" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
