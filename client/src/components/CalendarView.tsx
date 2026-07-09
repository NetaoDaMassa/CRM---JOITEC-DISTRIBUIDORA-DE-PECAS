import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, addMonths, subMonths, getDay,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Calendar, AlertCircle } from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import WhatsAppButton from './ui/WhatsAppButton'
import EmailButton from './ui/EmailButton'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface Lead {
  id: number
  name: string
  nextContactAt: string | null
  status: string
  ddd: number
  phone: string
  email?: string | null
  vendor?: { name: string } | null
}

interface Props {
  leads: Lead[]
  basePath: string
  isAdmin?: boolean
}

function isOverdue(lead: Lead) {
  if (!lead.nextContactAt) return false
  if (['ganho', 'perdido', 'desqualificado'].includes(lead.status)) return false
  const d = new Date(lead.nextContactAt)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function isScheduledToday(lead: Lead) {
  if (!lead.nextContactAt) return false
  const d = new Date(lead.nextContactAt)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() === today.getTime()
}

export default function CalendarView({ leads, basePath, isAdmin = false }: Props) {
  const navigate = useNavigate()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())

  const scheduled = leads.filter((l) => l.nextContactAt)
  const overdueCount = scheduled.filter(isOverdue).length
  const todayCount = scheduled.filter(isScheduledToday).length

  const leadsByDate: Record<string, Lead[]> = {}
  scheduled.forEach((lead) => {
    const key = format(new Date(lead.nextContactAt!), 'yyyy-MM-dd')
    if (!leadsByDate[key]) leadsByDate[key] = []
    leadsByDate[key].push(lead)
  })

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = getDay(monthStart)
  const cells: (Date | null)[] = [...Array(startPad).fill(null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedKey = format(selectedDate, 'yyyy-MM-dd')
  const selectedLeads = leadsByDate[selectedKey] ?? []

  return (
    <div className="space-y-4">
      {/* Alerts bar */}
      {(overdueCount > 0 || todayCount > 0) && (
        <div className="flex gap-3">
          {overdueCount > 0 && (
            <div className="flex-1 bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-400">
                <span className="font-semibold">{overdueCount} vencido{overdueCount > 1 ? 's' : ''}</span>
                {' '}— contatos com data passada sem atualização
              </p>
            </div>
          )}
          {todayCount > 0 && (
            <div className="flex-1 bg-orange-900/20 border border-orange-700/40 rounded-xl px-4 py-3 flex items-center gap-2">
              <Calendar size={16} className="text-orange-400 shrink-0" />
              <p className="text-sm text-orange-400">
                <span className="font-semibold">{todayCount} contato{todayCount > 1 ? 's' : ''} hoje</span>
                {' '}— agenda do dia
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Calendar grid */}
        <div className="col-span-2 bg-dark-800 border border-dark-600 rounded-2xl p-5">
          {/* Navigation */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 rounded-xl hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="font-heading text-gold-400 font-semibold capitalize text-lg">
              {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
            </h2>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 rounded-xl hover:bg-dark-700 text-dark-400 hover:text-dark-100 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-xs text-dark-500 font-medium py-2">
                {d}
              </div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="aspect-square" />
              const key = format(day, 'yyyy-MM-dd')
              const dayLeads = leadsByDate[key] ?? []
              const isSelected = isSameDay(day, selectedDate)
              const today = isToday(day)
              const hasOverdue = dayLeads.some(isOverdue)
              const hasFuture = dayLeads.some((l) => !isOverdue(l))

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(day)}
                  className={`
                    aspect-square flex flex-col items-center justify-center rounded-xl text-sm transition-all relative
                    ${isSelected
                      ? 'bg-gold-600 text-dark-950 font-bold shadow-lg shadow-gold-600/20'
                      : today
                        ? 'bg-dark-700 text-gold-400 font-semibold ring-1 ring-gold-600/40'
                        : 'hover:bg-dark-700 text-dark-300 hover:text-dark-100'
                    }
                  `}
                >
                  <span className="text-sm leading-none">{format(day, 'd')}</span>
                  {dayLeads.length > 0 && (
                    <div className="flex gap-0.5 mt-1">
                      {hasOverdue && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-dark-950' : 'bg-red-500'}`} />
                      )}
                      {hasFuture && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-dark-950' : 'bg-gold-500'}`} />
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-4 pt-4 border-t border-dark-700">
            <div className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Vencido
            </div>
            <div className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="w-2 h-2 rounded-full bg-gold-500" />
              Agendado
            </div>
            <div className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="w-4 h-4 rounded-md bg-dark-700 ring-1 ring-gold-600/40 inline-block" />
              Hoje
            </div>
          </div>
        </div>

        {/* Selected day detail */}
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 flex flex-col min-h-[420px]">
          <div className="flex items-center gap-2 mb-1">
            <Calendar size={16} className="text-gold-400" />
            <h3 className="font-heading text-gold-400 font-semibold">
              {format(selectedDate, "d 'de' MMMM", { locale: ptBR })}
            </h3>
          </div>
          <p className="text-xs text-dark-500 mb-4">
            {selectedLeads.length === 0
              ? 'Nenhum contato agendado'
              : `${selectedLeads.length} contato${selectedLeads.length > 1 ? 's' : ''}`}
          </p>

          {selectedLeads.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-dark-600 gap-2">
              <Calendar size={32} className="text-dark-700" />
              <span className="text-sm text-dark-500">Dia livre</span>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto flex-1 pr-0.5">
              {selectedLeads.map((lead) => {
                const overdue = isOverdue(lead)
                return (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`${basePath}/leads/${lead.id}`)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all hover:border-gold-600/50 ${
                      overdue
                        ? 'bg-red-900/10 border-red-700/30 hover:bg-red-900/20'
                        : 'bg-dark-700/50 border-dark-600 hover:bg-dark-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className="text-sm font-medium text-dark-100 leading-tight line-clamp-1">
                        {lead.name}
                      </p>
                      {overdue && <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs text-dark-400 flex-1">({lead.ddd}) {lead.phone}</p>
                      {lead.email && <EmailButton email={lead.email} size="sm" />}
                      <WhatsAppButton ddd={lead.ddd} phone={lead.phone} size="sm" />
                    </div>
                    <div className="flex items-center justify-between">
                      <StatusBadge status={lead.status} />
                      {isAdmin && lead.vendor && (
                        <span className="text-xs text-dark-500 truncate ml-2">{lead.vendor.name}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
