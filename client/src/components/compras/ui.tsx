import { Check, X } from 'lucide-react'
import { ETAPAS_FLUXO, ETAPA_INFO, PRIORIDADE_INFO, TIPO_INFO, type EtapaCompra } from '../../lib/comprasShared'
import { corTexto } from '../../lib/corTexto'

export function EtapaBadge({ etapa }: { etapa: EtapaCompra }) {
  const info = ETAPA_INFO[etapa]
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: `${info.cor}22`, color: corTexto(info.cor), boxShadow: `inset 0 0 0 1px ${info.cor}55` }}
      title={info.ajuda}
    >
      {info.label}
    </span>
  )
}

export function TipoBadge({ tipo }: { tipo: 'revenda' | 'uso_consumo' }) {
  const info = TIPO_INFO[tipo]
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ background: `${info.cor}1f`, color: corTexto(info.cor) }}>
      {info.label}
    </span>
  )
}

export function PrioridadeBadge({ prioridade }: { prioridade: 'baixa' | 'normal' | 'urgente' }) {
  if (prioridade === 'normal') return null
  const info = PRIORIDADE_INFO[prioridade]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${info.classe}`}>{info.label}</span>
}

// Linha do processo com as 7 etapas — mostra onde a compra está.
export function TrilhaEtapas({ etapa, compacta }: { etapa: EtapaCompra; compacta?: boolean }) {
  const encerrada = etapa === 'reprovado' || etapa === 'cancelado'
  const idxAtual = ETAPAS_FLUXO.indexOf(etapa)
  return (
    <div className="flex items-center w-full overflow-x-auto">
      {ETAPAS_FLUXO.map((e, i) => {
        const info = ETAPA_INFO[e]
        const feita = !encerrada && (i < idxAtual || etapa === 'finalizado')
        const atual = !encerrada && i === idxAtual && etapa !== 'finalizado'
        const cor = feita || atual ? info.cor : 'var(--color-dark-600)'
        return (
          <div key={e} className="flex items-center flex-1 min-w-0 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span
                className={`rounded-full flex items-center justify-center text-[11px] font-bold ${compacta ? 'w-5 h-5' : 'w-7 h-7'} ${atual ? 'animate-pulse' : ''}`}
                style={{ background: feita ? cor : atual ? `${cor}33` : 'transparent', color: corTexto(feita ? '#fff' : cor), boxShadow: `inset 0 0 0 2px ${cor}` }}
              >
                {feita ? <Check size={compacta ? 11 : 14} strokeWidth={3} /> : i + 1}
              </span>
              {!compacta && <span className={`text-[11px] whitespace-nowrap ${atual ? 'font-semibold text-dark-100' : 'text-dark-400'}`}>{info.label}</span>}
            </div>
            {i < ETAPAS_FLUXO.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded ${compacta ? '' : '-mt-5'}`} style={{ background: feita ? cor : 'var(--color-dark-700)' }} />}
          </div>
        )
      })}
      {encerrada && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold shrink-0" style={{ color: corTexto(ETAPA_INFO[etapa].cor) }}>
          <X size={14} /> {ETAPA_INFO[etapa].label}
        </span>
      )}
    </div>
  )
}
