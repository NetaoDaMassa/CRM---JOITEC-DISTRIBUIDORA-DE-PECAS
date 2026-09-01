import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { getStageSequence, STAGE_LABELS, type Stage, type OrderType } from '../../lib/ordensShared'
import { renderEtapa, type OrdemParaEtapa } from './renderEtapa'

export default function HistoricoAccordion({ ordemId, isAdmin, ordem }: { ordemId: number; isAdmin: boolean; ordem: OrdemParaEtapa & { orderType: string } }) {
  const { data } = trpc.ordens.core.historico.useQuery({ id: ordemId })
  const [abertos, setAbertos] = useState<Set<Stage>>(new Set())
  const [editandoEtapa, setEditandoEtapa] = useState<Stage | null>(null)

  const sequencia = getStageSequence(ordem.orderType as OrderType)
  const grupos = new Map<Stage, typeof data>()
  for (const h of data ?? []) {
    const stage = h.stage as Stage
    const lista = grupos.get(stage) ?? []
    lista.push(h)
    grupos.set(stage, lista as any)
  }

  function toggle(stage: Stage) {
    setAbertos((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {sequencia.map((stage) => {
        const eventos = grupos.get(stage) ?? []
        const aberto = abertos.has(stage)
        const editando = editandoEtapa === stage
        return (
          <div key={stage} className="rounded-lg border border-dark-700 overflow-hidden">
            <button onClick={() => toggle(stage)} className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-800/60 hover:bg-dark-800 text-left">
              <span className="flex items-center gap-2 text-sm text-dark-200">
                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {STAGE_LABELS[stage]}
              </span>
              <span className="text-xs text-dark-500">{eventos.length} evento{eventos.length === 1 ? '' : 's'}</span>
            </button>
            {aberto && (
              <div className="p-3 space-y-3 border-t border-dark-700">
                {isAdmin && (
                  <button onClick={() => setEditandoEtapa(editando ? null : stage)} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                    {editando ? 'Concluir edição' : 'Editar'}
                  </button>
                )}
                {renderEtapa(stage, ordem, isAdmin, !editando)}
                <div className="space-y-1.5 pt-2 border-t border-dark-700">
                  {eventos.map((h) => (
                    <HistoricoLinha key={h.id} ordemId={ordemId} historicoId={h.id} description={h.description} userName={h.user?.name} createdAt={h.createdAt} isAdmin={isAdmin} />
                  ))}
                  {eventos.length === 0 && <p className="text-dark-500 text-xs">Sem eventos registrados nesta etapa</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HistoricoLinha({ ordemId, historicoId, description, userName, createdAt, isAdmin }: { ordemId: number; historicoId: number; description: string; userName?: string; createdAt: string; isAdmin: boolean }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(description)

  const salvarMut = trpc.ordens.core.editarNotaHistorico.useMutation({
    onSuccess: () => { toast.success('Atualizado'); setEditando(false); utils.ordens.core.historico.invalidate({ id: ordemId }) },
    onError: (e) => toast.error(e.message),
  })

  if (editando) {
    return (
      <div className="flex items-center gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} className="flex-1 bg-dark-900 border border-dark-600 rounded px-2 py-1 text-xs text-dark-100" />
        <button onClick={() => salvarMut.mutate({ historicoId, description: texto })} className="text-green-400 hover:text-green-300"><Check size={14} /></button>
        <button onClick={() => { setEditando(false); setTexto(description) }} className="text-dark-400 hover:text-dark-200"><X size={14} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <div>
        <div className="text-dark-200">{description}</div>
        <div className="text-dark-500 text-xs mt-0.5">{userName ?? 'sistema'} · {createdAt}</div>
      </div>
      {isAdmin && <button onClick={() => setEditando(true)} className="text-dark-500 hover:text-gold-400 shrink-0"><Pencil size={12} /></button>}
    </div>
  )
}
