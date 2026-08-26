// Calendário consolidado (Odin Compressores) — portado de pages/Calendar.tsx
// do odincrm.duckdns.org. Junta Coleta/Faturamento/Financeiro/Preparação/
// Pós-Venda/Propostas "Chamar Depois"/Visitas num só calendário mensal,
// cada tipo com sua cor (mesma legenda do sistema original).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Select from '../components/ui/Select'
import type { EventoTipo } from '@server/router/calendarioOdin'

const TIPO_LABEL: Record<EventoTipo, string> = {
  coleta: 'Coleta',
  faturamento: 'Faturamento',
  financeiro: 'Financeiro',
  preparacao: 'Preparação',
  pos_venda: 'Pós-Venda',
  proposta_chamar_depois: 'Proposta — Chamar Depois',
  visita: 'Visita',
  visita_retorno: 'Visita — Retorno',
}
const TIPO_COR: Record<EventoTipo, string> = {
  coleta: 'bg-blue-500',
  faturamento: 'bg-green-500',
  financeiro: 'bg-pink-500',
  preparacao: 'bg-amber-500',
  pos_venda: 'bg-emerald-500',
  proposta_chamar_depois: 'bg-orange-500',
  visita: 'bg-violet-500',
  visita_retorno: 'bg-red-500',
}
const TIPO_COR_BADGE: Record<EventoTipo, string> = {
  coleta: 'text-blue-400 bg-blue-900/20 border-blue-700/40',
  faturamento: 'text-green-400 bg-green-900/20 border-green-700/40',
  financeiro: 'text-pink-400 bg-pink-900/20 border-pink-700/40',
  preparacao: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  pos_venda: 'text-emerald-400 bg-emerald-900/20 border-emerald-700/40',
  proposta_chamar_depois: 'text-orange-400 bg-orange-900/20 border-orange-700/40',
  visita: 'text-violet-400 bg-violet-900/20 border-violet-700/40',
  visita_retorno: 'text-red-400 bg-red-900/20 border-red-700/40',
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function chave(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Modo = 'mes' | 'semana' | 'dia' | 'agenda'
type Evento = { id: string; tipo: EventoTipo; data: string; titulo: string; concluido: boolean; atrasado: boolean; link: string }

function EventoPill({ e }: { e: Evento }) {
  return (
    <Link
      to={e.link}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium truncate ${TIPO_COR_BADGE[e.tipo]}`}
      title={e.titulo}
    >
      {e.concluido ? <CheckCircle2 size={9} className="shrink-0" /> : e.atrasado ? <AlertTriangle size={9} className="shrink-0" /> : null}
      <span className="truncate">{e.titulo}</span>
    </Link>
  )
}

export default function CalendarioOdin() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [modo, setModo] = useState<Modo>('mes')
  const [cursor, setCursor] = useState(new Date())
  const [vendedorId, setVendedorId] = useState('')
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null)

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: isAdmin })

  const inicioGrid = useMemo(() => {
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    d.setDate(d.getDate() - d.getDay())
    return d
  }, [cursor])
  const fimGrid = useMemo(() => {
    const d = new Date(inicioGrid)
    d.setDate(d.getDate() + 41)
    return d
  }, [inicioGrid])

  const dataDe = modo === 'agenda' ? chave(new Date()) : chave(inicioGrid)
  const dataAte = modo === 'agenda' ? chave(new Date(new Date().setDate(new Date().getDate() + 60))) : chave(fimGrid)

  const { data: eventos, isLoading } = trpc.calendarioOdin.eventos.useQuery({
    dataDe,
    dataAte,
    vendedorId: vendedorId ? Number(vendedorId) : undefined,
  })

  const eventosPorDia = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of eventos ?? []) {
      if (!m.has(e.data)) m.set(e.data, [])
      m.get(e.data)!.push(e)
    }
    return m
  }, [eventos])

  function irPara(delta: number) {
    const d = new Date(cursor)
    if (modo === 'mes') d.setMonth(d.getMonth() + delta)
    else if (modo === 'semana') d.setDate(d.getDate() + delta * 7)
    else d.setDate(d.getDate() + delta)
    setCursor(d)
  }

  const semanas: Date[][] = []
  if (modo === 'mes') {
    let atual = new Date(inicioGrid)
    for (let semana = 0; semana < 6; semana++) {
      const linha: Date[] = []
      for (let dia = 0; dia < 7; dia++) {
        linha.push(new Date(atual))
        atual.setDate(atual.getDate() + 1)
      }
      semanas.push(linha)
    }
  } else if (modo === 'semana') {
    const inicioSemana = new Date(cursor)
    inicioSemana.setDate(inicioSemana.getDate() - inicioSemana.getDay())
    const linha: Date[] = []
    for (let i = 0; i < 7; i++) {
      linha.push(new Date(inicioSemana))
      inicioSemana.setDate(inicioSemana.getDate() + 1)
    }
    semanas.push(linha)
  }

  const hojeChave = chave(new Date())
  const eventosDoDiaSelecionado = diaSelecionado ? eventosPorDia.get(diaSelecionado) ?? [] : []

  return (
    <div className="p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-2xl text-dark-50 font-bold flex items-center gap-2">
          <CalendarDays size={22} /> Calendário
        </h1>
        {isAdmin && (
          <div className="w-56">
            <Select
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              placeholder="Todos os vendedores"
              options={(vendedores ?? []).filter((v) => v.role === 'vendor').map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-5 text-[11px] text-dark-400 bg-dark-800 border border-dark-600 rounded-xl px-3 py-2">
        {(Object.keys(TIPO_LABEL) as EventoTipo[]).map((t) => (
          <span key={t} className="flex items-center gap-1 mr-2">
            <span className={`h-2 w-2 rounded-full ${TIPO_COR[t]}`} /> {TIPO_LABEL[t]}
          </span>
        ))}
        <span className="flex items-center gap-1 mr-2 text-green-400"><CheckCircle2 size={11} /> concluído</span>
        <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={11} /> atrasado</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date())} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-dark-600 text-dark-300 hover:bg-dark-800">Hoje</button>
          <button onClick={() => irPara(-1)} className="p-1.5 rounded-lg border border-dark-600 text-dark-400 hover:bg-dark-800"><ChevronLeft size={14} /></button>
          <button onClick={() => irPara(1)} className="p-1.5 rounded-lg border border-dark-600 text-dark-400 hover:bg-dark-800"><ChevronRight size={14} /></button>
          <span className="text-sm font-semibold text-dark-100 ml-1">
            {modo === 'dia' ? `${cursor.getDate()} de ${MESES[cursor.getMonth()]} ${cursor.getFullYear()}` : `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-dark-800 border border-dark-600 rounded-lg p-1">
          {(['mes', 'semana', 'dia', 'agenda'] as Modo[]).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${modo === m ? 'bg-gold-600 text-dark-950' : 'text-dark-400 hover:text-dark-100'}`}
            >
              {m === 'mes' ? 'Mês' : m === 'semana' ? 'Semana' : m === 'dia' ? 'Dia' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          {isLoading ? (
            <p className="text-dark-400 text-sm">Carregando...</p>
          ) : modo === 'agenda' ? (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
              {Array.from(eventosPorDia.entries()).map(([dia, evs]) => (
                <div key={dia} className="p-3">
                  <p className="text-xs font-semibold text-dark-300 mb-1.5">{dia}</p>
                  <div className="space-y-1">
                    {evs.map((e) => <EventoPill key={e.id} e={e} />)}
                  </div>
                </div>
              ))}
              {eventosPorDia.size === 0 && <p className="text-dark-500 text-sm p-4">Nenhum evento nos próximos 60 dias.</p>}
            </div>
          ) : modo === 'dia' ? (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-1.5">
              {(eventosPorDia.get(chave(cursor)) ?? []).map((e) => <EventoPill key={e.id} e={e} />)}
              {(eventosPorDia.get(chave(cursor)) ?? []).length === 0 && <p className="text-dark-500 text-sm">Nenhum evento neste dia.</p>}
            </div>
          ) : (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-7 border-b border-dark-700">
                {DIAS_SEMANA.map((d) => (
                  <div key={d} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-dark-500 text-center">{d.slice(0, 3)}</div>
                ))}
              </div>
              {semanas.map((linha, i) => (
                <div key={i} className="grid grid-cols-7 border-b border-dark-700 last:border-b-0">
                  {linha.map((d) => {
                    const k = chave(d)
                    const evs = eventosPorDia.get(k) ?? []
                    const foraDoMes = modo === 'mes' && d.getMonth() !== cursor.getMonth()
                    return (
                      <button
                        key={k}
                        onClick={() => setDiaSelecionado(k)}
                        className={`min-h-[92px] border-r border-dark-700 last:border-r-0 p-1.5 text-left align-top hover:bg-dark-700/40 transition-colors ${diaSelecionado === k ? 'bg-dark-700/60' : ''} ${foraDoMes ? 'opacity-40' : ''}`}
                      >
                        <span className={`text-xs font-medium ${k === hojeChave ? 'inline-flex items-center justify-center h-5 w-5 rounded-full bg-gold-600 text-dark-950' : 'text-dark-300'}`}>
                          {d.getDate()}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {evs.slice(0, 3).map((e) => <EventoPill key={e.id} e={e} />)}
                          {evs.length > 3 && <p className="text-[10px] text-dark-500">+{evs.length - 3} mais</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 h-fit">
          <p className="text-sm font-semibold text-dark-100 mb-3">
            {diaSelecionado ? diaSelecionado.split('-').reverse().join('/') : 'Clique num dia'}
          </p>
          {!diaSelecionado ? (
            <p className="text-sm text-dark-500">Clique num dia no calendário para ver os detalhes aqui.</p>
          ) : eventosDoDiaSelecionado.length === 0 ? (
            <p className="text-sm text-dark-500">Nenhum evento neste dia.</p>
          ) : (
            <div className="space-y-2">
              {eventosDoDiaSelecionado.map((e) => (
                <Link key={e.id} to={e.link} className={`block rounded-lg border px-3 py-2 text-xs ${TIPO_COR_BADGE[e.tipo]}`}>
                  <p className="font-semibold flex items-center gap-1">
                    {e.concluido ? <CheckCircle2 size={11} /> : e.atrasado ? <AlertTriangle size={11} /> : null}
                    {TIPO_LABEL[e.tipo]}
                  </p>
                  <p className="mt-0.5">{e.titulo}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
