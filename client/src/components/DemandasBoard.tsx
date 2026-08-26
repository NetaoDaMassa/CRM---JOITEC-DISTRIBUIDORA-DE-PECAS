import { useState } from 'react'
import { Calendar, MessageSquare, Paperclip, User, Landmark, Plus, X, Pencil } from 'lucide-react'

export type DemandaCard = {
  id: number
  titulo: string
  estagioId: number
  dataLimite: string | null
  mostrarPainelFinanceiro: boolean
  atribuidoPara: { id: number; name: string } | null
  criadoPor: { id: number; name: string }
  anexos: { id: number }[]
  comentarios: { id: number }[]
}

export type DemandaEstagio = { id: number; nome: string; ordem: number; concluido: boolean }

function formatarPrazo(d: string | null): string {
  if (!d) return ''
  const [ano, mes, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mes}`
}

function prazoVencido(d: string | null): boolean {
  if (!d) return false
  return d.slice(0, 10) < new Date().toISOString().slice(0, 10)
}

function CardDemanda({ demanda, onClick, onDragStart }: { demanda: DemandaCard; onClick: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const vencido = prazoVencido(demanda.dataLimite)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-dark-800 border border-dark-600 hover:border-gold-600/50 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-lg hover:shadow-black/20 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-sm font-medium text-dark-100 group-hover:text-gold-400 transition-colors">{demanda.titulo}</h4>
        {demanda.mostrarPainelFinanceiro && <Landmark size={13} className="text-gold-400 shrink-0 mt-0.5" />}
      </div>

      {demanda.atribuidoPara && (
        <div className="flex items-center gap-1.5 text-xs text-dark-400 mb-1.5">
          <User size={11} />
          <span className="truncate">{demanda.atribuidoPara.name}</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mt-2">
        {demanda.dataLimite && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
              vencido ? 'text-red-400 bg-red-900/20 border-red-700/40' : 'text-dark-400 bg-dark-700/30 border-dark-600'
            }`}
          >
            <Calendar size={10} /> {formatarPrazo(demanda.dataLimite)}
          </span>
        )}
        {demanda.comentarios.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-dark-500">
            <MessageSquare size={10} /> {demanda.comentarios.length}
          </span>
        )}
        {demanda.anexos.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-dark-500">
            <Paperclip size={10} /> {demanda.anexos.length}
          </span>
        )}
      </div>
    </div>
  )
}

export default function DemandasBoard({
  estagios,
  demandas,
  podeGerenciarFases,
  onAbrirDemanda,
  onMover,
  onNovaFaseEm,
  onRenomearFase,
  onExcluirFase,
}: {
  estagios: DemandaEstagio[]
  demandas: DemandaCard[]
  podeGerenciarFases: boolean
  onAbrirDemanda: (id: number) => void
  onMover: (demandaId: number, estagioId: number, ordem: number) => void
  onNovaFaseEm: (nome: string) => void
  onRenomearFase: (id: number, nome: string) => void
  onExcluirFase: (id: number) => void
}) {
  const [colunaSobre, setColunaSobre] = useState<number | null>(null)
  const [editandoFase, setEditandoFase] = useState<number | null>(null)
  const [nomeFase, setNomeFase] = useState('')
  const [criandoFase, setCriandoFase] = useState(false)
  const [nomeNovaFase, setNomeNovaFase] = useState('')

  function handleDrop(estagioId: number) {
    return (e: React.DragEvent) => {
      e.preventDefault()
      setColunaSobre(null)
      const demandaId = Number(e.dataTransfer.getData('text/plain'))
      if (!demandaId) return
      const cardsNaColuna = demandas.filter((d) => d.estagioId === estagioId)
      onMover(demandaId, estagioId, cardsNaColuna.length)
    }
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {estagios.map((estagio) => {
        const cards = demandas.filter((d) => d.estagioId === estagio.id)
        return (
          <div key={estagio.id} className="shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3 group/fase">
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${estagio.concluido ? 'bg-green-500' : 'bg-gold-500'}`} />
              {editandoFase === estagio.id ? (
                <input
                  autoFocus
                  value={nomeFase}
                  onChange={(e) => setNomeFase(e.target.value)}
                  onBlur={() => {
                    if (nomeFase.trim()) onRenomearFase(estagio.id, nomeFase.trim())
                    setEditandoFase(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditandoFase(null)
                  }}
                  className="bg-dark-800 border border-gold-600 rounded px-1.5 py-0.5 text-sm text-dark-100 w-32"
                />
              ) : (
                <span className="text-sm font-semibold text-dark-200 flex-1">{estagio.nome}</span>
              )}
              <span className="text-dark-500 text-xs bg-dark-800 rounded-full px-1.5 py-0.5">{cards.length}</span>
              {podeGerenciarFases && editandoFase !== estagio.id && (
                <div className="hidden group-hover/fase:flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditandoFase(estagio.id)
                      setNomeFase(estagio.nome)
                    }}
                    className="text-dark-500 hover:text-gold-400"
                    title="Renomear fase"
                  >
                    <Pencil size={12} />
                  </button>
                  {cards.length === 0 && (
                    <button onClick={() => onExcluirFase(estagio.id)} className="text-dark-500 hover:text-red-400" title="Excluir fase">
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setColunaSobre(estagio.id)
              }}
              onDragLeave={() => setColunaSobre((c) => (c === estagio.id ? null : c))}
              onDrop={handleDrop(estagio.id)}
              className={`space-y-2 min-h-[80px] rounded-xl transition-colors ${colunaSobre === estagio.id ? 'bg-gold-900/10 ring-1 ring-gold-600/30' : ''}`}
            >
              {cards.map((demanda) => (
                <CardDemanda
                  key={demanda.id}
                  demanda={demanda}
                  onClick={() => onAbrirDemanda(demanda.id)}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(demanda.id))}
                />
              ))}

              {cards.length === 0 && (
                <div className="h-16 border-2 border-dashed border-dark-700 rounded-xl flex items-center justify-center text-dark-600 text-xs">
                  Solte aqui
                </div>
              )}
            </div>
          </div>
        )
      })}

      {podeGerenciarFases && (
        <div className="shrink-0 w-56">
          {criandoFase ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nomeNovaFase}
                onChange={(e) => setNomeNovaFase(e.target.value)}
                placeholder="Nome da fase"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nomeNovaFase.trim()) {
                    onNovaFaseEm(nomeNovaFase.trim())
                    setNomeNovaFase('')
                    setCriandoFase(false)
                  }
                  if (e.key === 'Escape') setCriandoFase(false)
                }}
                className="flex-1 bg-dark-800 border border-gold-600 rounded-lg px-2 py-1.5 text-sm text-dark-100"
              />
              <button
                onClick={() => {
                  if (nomeNovaFase.trim()) onNovaFaseEm(nomeNovaFase.trim())
                  setNomeNovaFase('')
                  setCriandoFase(false)
                }}
                className="text-gold-400 hover:text-gold-300 text-sm font-medium shrink-0"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCriandoFase(true)}
              className="flex items-center gap-1.5 text-sm text-dark-500 hover:text-dark-300 transition-colors px-2 py-2"
            >
              <Plus size={15} /> Nova fase
            </button>
          )}
        </div>
      )}
    </div>
  )
}
