import type { ReactNode } from 'react'
import { STATUS_LABELS, STATUS_COLORS } from '../../lib/utils'

interface BadgeProps {
  children: ReactNode
  className?: string
}

export function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
        ${className}
      `}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLORS[status] ?? 'bg-zinc-500/20 text-zinc-400'}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

const SLA_LABELS: Record<string, string> = {
  critico: 'Crítico',
  em_risco: 'Em risco',
  normal: 'Normal',
}

const SLA_COLORS: Record<string, string> = {
  critico: 'bg-red-500/15 text-red-400 border-red-500/30',
  em_risco: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  normal: 'bg-dark-600/40 text-dark-300 border-dark-500/30',
}

export function SlaBadge({ slaStatus }: { slaStatus: string | null | undefined }) {
  const key = slaStatus ?? 'normal'
  return <Badge className={SLA_COLORS[key]}>{SLA_LABELS[key]}</Badge>
}

export function ReassignedBadge() {
  return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30">Reatribuído</Badge>
}
