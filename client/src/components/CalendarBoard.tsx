import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'
import LegendaIcones from './LegendaIcones'

const TIPO_LABEL: Record<string, string> = { ligacao: 'Ligação', visita: 'Visita', reuniao: 'Reunião', outro: 'Outro' }
const TIPO_ICONE: Record<string, string> = { ligacao: '📞', visita: '🚗', reuniao: '🤝', outro: '📌' }
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const RECORRENCIA_LABEL: Record<string, string> = { nenhuma: 'Não repetir', diaria: 'Todo dia', semanal: 'Toda semana', quinzenal: 'A cada 2 semanas', mensal: 'Todo mês' }

type Modo = 'mes' | 'semana' | 'dia'
type Compromisso = {
  id: number
  dataHora: string
  tipo: string
  titulo: string
  descricao: string | null
  concluido: boolean
  recorrenciaGrupoId: number | null
  cliente: { id: number; razaoSocial: string } | null
  vendedor: { id: number; name: string } | null
}

function chaveData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function horaLocal(dataHora: string): string {
  return new Date(dataHora.replace(' ', 'T') + 'Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// `leads.nextContactAt` não segue a mesma convenção de `compromissos.dataHora`
// ("YYYY-MM-DD HH:MM:SS" sem sufixo, sempre UTC) — vem em formatos mistos
// (ISO com "Z", ISO sem segundos/timezone de um <input type="datetime-local">,
// etc, dependendo de onde foi gravado). `horaLocal` quebraria em vários
// desses casos, então esta função tenta o parse direto e nunca lança.
function horaLocalLead(dataHora: string): string {
  const d = new Date(dataHora)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Troca só a parte de data de um "YYYY-MM-DD HH:MM:SS", mantendo o horário
// — usado quando o compromisso é arrastado pra outro dia (a hora não muda,
// só o dia).
function trocarDia(dataHora: string, novoDiaChave: string): string {
  return `${novoDiaChave} ${dataHora.slice(11)}`
}

// O resto do app guarda tudo como "YYYY-MM-DD HH:MM:SS" representando UTC
// sem sufixo (mesma convenção de `datetime('now')` do SQLite) — os campos de
// data/hora do formulário, porém, são preenchidos pelo vendedor no fuso
// local do navegador. Sem essa conversão, um compromisso marcado às 16h
// apareceria de volta como 13h (UTC-3 aplicado duas vezes).
function dataHoraLocalParaUtcString(data: string, hora: string): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const [h, m] = hora.split(':').map(Number)
  const localDate = new Date(ano, mes - 1, dia, h, m, 0)
  return localDate.toISOString().slice(0, 19).replace('T', ' ')
}

function inicioDaSemana(d: Date): Date {
  const r = new Date(d)
  r.setDate(r.getDate() - r.getDay())
  return r
}

// Card de um compromisso — arrastável (native HTML5 DnD) pra reagendar
// soltando em outro dia. `onDragStart` guarda só o id no dataTransfer; quem
// recebe o drop resolve o resto.
function CompromissoCard({
  c,
  mostrarVendedor,
  onConcluir,
  onExcluir,
  onDragStart,
  compacto,
}: {
  c: Compromisso
  mostrarVendedor: boolean
  onConcluir: () => void
  onExcluir: (escopo: 'somente_este' | 'futuros' | 'todos') => void
  onDragStart: (e: React.DragEvent) => void
  compacto?: boolean
}) {
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`rounded-lg border p-2 text-sm cursor-grab active:cursor-grabbing ${
        c.concluido ? 'border-dark-700 opacity-50' : 'border-dark-600'
      }`}
    >
      <div className={compacto ? 'space-y-1' : 'flex items-start justify-between gap-2'}>
        <div className="min-w-0">
          <p className={`text-dark-100 font-medium ${compacto ? 'truncate' : ''}`}>
            {TIPO_ICONE[c.tipo]} {horaLocal(c.dataHora)} · {c.titulo}
          </p>
          {c.cliente && <p className="text-xs text-dark-400 truncate">Cliente: {c.cliente.razaoSocial}</p>}
          {c.vendedor && mostrarVendedor && <p className="text-xs text-dark-400 truncate">Vendedor: {c.vendedor.name}</p>}
          {!compacto && c.descricao && <p className="text-xs text-dark-300 mt-1">{c.descricao}</p>}
        </div>
        <div className={compacto ? 'flex flex-wrap gap-2 text-xs' : 'flex shrink-0 gap-2 text-xs'}>
          {!c.concluido && (
            <button onClick={onConcluir} className="text-green-400 hover:text-green-300">
              Concluir
            </button>
          )}
          {!confirmandoExclusao ? (
            <button onClick={() => setConfirmandoExclusao(true)} className="text-red-400 hover:text-red-300">
              Excluir
            </button>
          ) : c.recorrenciaGrupoId ? (
            <div className="flex flex-col items-end gap-0.5">
              <button onClick={() => onExcluir('somente_este')} className="text-red-400 hover:text-red-300 whitespace-nowrap">
                Só este
              </button>
              <button onClick={() => onExcluir('futuros')} className="text-red-400 hover:text-red-300 whitespace-nowrap">
                Este e os futuros
              </button>
            </div>
          ) : (
            <button onClick={() => onExcluir('somente_este')} className="text-red-400 hover:text-red-300 whitespace-nowrap">
              Confirmar?
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Calendário compartilhado entre vendedor (só a própria agenda) e admin
// (escolhe um vendedor no seletor da página) — 3 modos de visualização
// (mês/semana/dia), arrastar um compromisso pra outro dia reagenda na hora,
// e compromissos podem repetir (diária/semanal/quinzenal/mensal, até uma
// data).
export default function CalendarBoard({ vendedorId }: { vendedorId?: number }) {
  const utils = trpc.useUtils()
  const [modo, setModo] = useState<Modo>('mes')
  const [dataRef, setDataRef] = useState(() => new Date())
  const [diaSelecionado, setDiaSelecionado] = useState<string>(chaveData(new Date()))
  const [novoAberto, setNovoAberto] = useState(false)
  const [arrastandoSobre, setArrastandoSobre] = useState<string | null>(null)

  const mesRef = new Date(dataRef.getFullYear(), dataRef.getMonth(), 1)
  const primeiroDiaMes = mesRef
  const ultimoDiaMes = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0)
  const inicioSemanaRef = inicioDaSemana(dataRef)
  const fimSemanaRef = new Date(inicioSemanaRef)
  fimSemanaRef.setDate(fimSemanaRef.getDate() + 6)

  // Grid do mês começa no domingo da semana do dia 1 e termina no sábado da
  // semana do último dia — pra sempre fechar semanas completas. A consulta
  // pro servidor tem que cobrir esse intervalo INTEIRO (não só o mês
  // "puro" 1–31), senão um compromisso caindo nesses dias de outro mês
  // mostrados na borda da grade nunca é buscado e some silenciosamente.
  const diasMes: Date[] = []
  const cursorMes = new Date(primeiroDiaMes)
  cursorMes.setDate(cursorMes.getDate() - cursorMes.getDay())
  while (cursorMes <= ultimoDiaMes || cursorMes.getDay() !== 0) {
    diasMes.push(new Date(cursorMes))
    cursorMes.setDate(cursorMes.getDate() + 1)
    if (diasMes.length > 42) break
  }
  const inicioGridMes = diasMes[0]
  const fimGridMes = diasMes[diasMes.length - 1]

  const dataInicio = modo === 'mes' ? chaveData(inicioGridMes) : modo === 'semana' ? chaveData(inicioSemanaRef) : chaveData(dataRef)
  const dataFim = modo === 'mes' ? chaveData(fimGridMes) : modo === 'semana' ? chaveData(fimSemanaRef) : chaveData(dataRef)

  const { data: compromissos } = trpc.compromissos.listar.useQuery({ dataInicio, dataFim, vendedorId })
  const { data: historico } = trpc.compromissos.historico.useQuery({ dataInicio, dataFim, vendedorId })
  // Lembretes de Leads (nextContactAt) — fonte independente de `compromissos`,
  // mesclada só aqui no client (ver plano fase 2 bloco D: não vira linha em
  // `compromissos`, o schema de agendamento não muda).
  const { data: leadReminders } = trpc.leads.listReminders.useQuery({ dataInicio, dataFim, vendedorId })
  const { user } = useAuth()
  const leadsBasePath = user?.role === 'admin' ? '/admin/leads' : '/vendedor/leads'

  const vendasPorDia = useMemo(() => new Map((historico?.vendasPorDia ?? []).map((v) => [v.dia, v.quantidade])), [historico])
  const contatosPorDia = useMemo(() => new Map((historico?.contatosPorDia ?? []).map((v) => [v.dia, v.quantidade])), [historico])
  const compromissosPorDia = useMemo(() => {
    const mapa = new Map<string, Compromisso[]>()
    for (const c of compromissos ?? []) {
      const dia = c.dataHora.slice(0, 10)
      const lista = mapa.get(dia) ?? []
      lista.push(c as Compromisso)
      mapa.set(dia, lista)
    }
    return mapa
  }, [compromissos])
  const leadsPorDia = useMemo(() => {
    const mapa = new Map<string, NonNullable<typeof leadReminders>>()
    for (const l of leadReminders ?? []) {
      if (!l.nextContactAt) continue
      const dia = l.nextContactAt.slice(0, 10)
      const lista = mapa.get(dia) ?? []
      lista.push(l)
      mapa.set(dia, lista)
    }
    return mapa
  }, [leadReminders])

  function invalidarTudo() {
    utils.compromissos.listar.invalidate()
    utils.compromissos.historico.invalidate()
    utils.compromissos.pendentesNotificacao.invalidate()
    // O Kanban mostra o próximo compromisso agendado direto no card — sem
    // isso, concluir/excluir/arrastar por aqui deixava o badge desatualizado
    // lá até a próxima ação no próprio Kanban invalidar essas queries.
    utils.funil.meuFunil.invalidate()
    utils.funil.funilPorVendedor.invalidate()
  }

  const excluirMut = trpc.compromissos.excluir.useMutation({
    onSuccess() {
      toast.success('Compromisso excluído')
      invalidarTudo()
    },
    onError: (err) => toast.error(err.message),
  })

  const atualizarMut = trpc.compromissos.atualizar.useMutation({
    onSuccess: invalidarTudo,
    onError: (err) => toast.error(err.message),
  })

  function handleDrop(diaChave: string) {
    return (e: React.DragEvent) => {
      e.preventDefault()
      setArrastandoSobre(null)
      const idStr = e.dataTransfer.getData('text/plain')
      if (!idStr) return
      const id = Number(idStr)
      const c = (compromissos ?? []).find((x) => x.id === id)
      if (!c || c.dataHora.slice(0, 10) === diaChave) return
      atualizarMut.mutate(
        { id, dataHora: trocarDia(c.dataHora, diaChave) },
        { onSuccess: () => toast.success(`Reagendado pra ${diaChave.split('-').reverse().join('/')}`) }
      )
    }
  }

  function navegar(direcao: 1 | -1) {
    const d = new Date(dataRef)
    if (modo === 'mes') d.setMonth(d.getMonth() + direcao)
    else if (modo === 'semana') d.setDate(d.getDate() + direcao * 7)
    else d.setDate(d.getDate() + direcao)
    setDataRef(d)
    if (modo !== 'mes') setDiaSelecionado(chaveData(d))
  }

  const diasSemana: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicioSemanaRef)
    d.setDate(d.getDate() + i)
    return d
  })

  const hojeChave = chaveData(new Date())
  const compromissosDoDia = compromissosPorDia.get(diaSelecionado) ?? []

  const tituloPeriodo =
    modo === 'mes'
      ? mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : modo === 'semana'
        ? `${inicioSemanaRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${fimSemanaRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`
        : dataRef.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navegar(-1)} className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold text-dark-100 min-w-40 text-center capitalize">{tituloPeriodo}</h2>
          <button onClick={() => navegar(1)} className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800">
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => {
              const hoje = new Date()
              setDataRef(hoje)
              setDiaSelecionado(chaveData(hoje))
            }}
            className="text-xs text-dark-400 hover:text-gold-400 ml-1"
          >
            Hoje
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-dark-700 overflow-hidden">
            {(['mes', 'semana', 'dia'] as Modo[]).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  modo === m ? 'bg-gold-600/20 text-gold-400' : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800'
                }`}
              >
                {m === 'mes' ? 'Mês' : m === 'semana' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setNovoAberto(true)}>
            + Agendar
          </Button>
          <LegendaIcones />
        </div>
      </div>

      {modo === 'mes' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="grid grid-cols-7 gap-1.5">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="text-center text-xs text-dark-500 font-medium py-1">
                {d}
              </div>
            ))}
            {diasMes.map((dia) => {
              const chave = chaveData(dia)
              const foraDoMes = dia.getMonth() !== mesRef.getMonth()
              const compromissosDia = compromissosPorDia.get(chave) ?? []
              const vendas = vendasPorDia.get(chave) ?? 0
              const contatos = contatosPorDia.get(chave) ?? 0
              const leadsDia = leadsPorDia.get(chave) ?? []
              const selecionado = chave === diaSelecionado

              return (
                <button
                  key={chave}
                  onClick={() => setDiaSelecionado(chave)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setArrastandoSobre(chave)
                  }}
                  onDragLeave={() => setArrastandoSobre((a) => (a === chave ? null : a))}
                  onDrop={handleDrop(chave)}
                  className={`aspect-square rounded-lg border p-1.5 text-left flex flex-col transition-all ${
                    selecionado ? 'border-gold-500 bg-gold-700/10 ring-2 ring-gold-500/40' : 'border-dark-700 hover:border-dark-500'
                  } ${foraDoMes ? 'opacity-30' : ''} ${arrastandoSobre === chave ? 'ring-2 ring-gold-400 bg-gold-700/20' : ''}`}
                >
                  <span className={`text-xs ${chave === hojeChave ? 'text-gold-400 font-bold' : 'text-dark-300'}`}>{dia.getDate()}</span>
                  <div className="flex-1 flex flex-col justify-end gap-0.5 mt-1">
                    {compromissosDia.length > 0 && (
                      <span className="text-[10px] bg-blue-600/30 text-blue-300 rounded px-1 truncate">🎯 {compromissosDia.length}</span>
                    )}
                    {vendas > 0 && <span className="text-[10px] bg-green-600/30 text-green-300 rounded px-1 truncate">💰 {vendas}</span>}
                    {contatos > 0 && <span className="text-[10px] bg-dark-700 text-dark-300 rounded px-1 truncate">📞 {contatos}</span>}
                    {leadsDia.length > 0 && (
                      <span className="text-[10px] bg-cyan-600/30 text-cyan-300 rounded px-1 truncate">🧲 {leadsDia.length}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Painel do dia selecionado — fica do lado do grid, sticky pra
              continuar visível ao rolar o mês inteiro. Os cards aqui são a
              origem do arrastar-pra-outro-dia no grid ao lado. */}
          <div className="bg-dark-800 border border-gold-600/30 rounded-2xl p-4 lg:sticky lg:top-4">
            <h3 className="text-sm font-semibold text-dark-100 mb-3 capitalize">
              {new Date(diaSelecionado + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </h3>
            {(vendasPorDia.get(diaSelecionado) ?? 0) > 0 || (contatosPorDia.get(diaSelecionado) ?? 0) > 0 ? (
              <p className="text-xs text-dark-400 mb-3">
                {(vendasPorDia.get(diaSelecionado) ?? 0) > 0 && `💰 ${vendasPorDia.get(diaSelecionado)} venda(s) fechada(s)`}
                {(vendasPorDia.get(diaSelecionado) ?? 0) > 0 && (contatosPorDia.get(diaSelecionado) ?? 0) > 0 && ' · '}
                {(contatosPorDia.get(diaSelecionado) ?? 0) > 0 && `📞 ${contatosPorDia.get(diaSelecionado)} contato(s) registrado(s)`}
              </p>
            ) : (
              <p className="text-xs text-dark-500 mb-3">Nenhuma venda ou contato registrado nesse dia.</p>
            )}

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {compromissosDoDia.length === 0 && <p className="text-xs text-dark-500">Nenhum compromisso agendado.</p>}
              {compromissosDoDia.map((c) => (
                <CompromissoCard
                  key={c.id}
                  c={c}
                  mostrarVendedor={vendedorId === undefined}
                  onConcluir={() => atualizarMut.mutate({ id: c.id, concluido: true })}
                  onExcluir={(escopo) => excluirMut.mutate({ id: c.id, escopo })}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                />
              ))}
              {(leadsPorDia.get(diaSelecionado) ?? []).map((l) => (
                <Link
                  key={`lead-${l.id}`}
                  to={`${leadsBasePath}/${l.id}`}
                  className="block rounded-lg border border-cyan-700/40 bg-cyan-950/20 p-2 text-sm hover:border-cyan-500/60"
                >
                  <p className="text-cyan-200 font-medium truncate">🧲 {horaLocalLead(l.nextContactAt!)} · {l.name}</p>
                  <p className="text-xs text-dark-400 truncate">
                    Lead · {l.phone}
                    {vendedorId === undefined && l.vendor && ` · ${l.vendor.name}`}
                  </p>
                </Link>
              ))}
            </div>
            <p className="text-[10px] text-dark-600 mt-2">Arraste um compromisso pra outro dia no calendário pra reagendar.</p>
          </div>
        </div>
      )}

      {modo === 'semana' && (
        <div className="grid grid-cols-7 gap-2">
          {diasSemana.map((dia) => {
            const chave = chaveData(dia)
            const compromissosDia = (compromissosPorDia.get(chave) ?? []).slice().sort((a, b) => a.dataHora.localeCompare(b.dataHora))
            return (
              <div
                key={chave}
                onDragOver={(e) => {
                  e.preventDefault()
                  setArrastandoSobre(chave)
                }}
                onDragLeave={() => setArrastandoSobre((a) => (a === chave ? null : a))}
                onDrop={handleDrop(chave)}
                className={`rounded-xl border p-2 min-h-[220px] space-y-1.5 transition-colors ${
                  chave === hojeChave ? 'border-gold-500/50' : 'border-dark-700'
                } ${arrastandoSobre === chave ? 'ring-2 ring-gold-400 bg-gold-700/10' : ''}`}
              >
                <p className={`text-xs font-medium text-center pb-1 border-b border-dark-700 ${chave === hojeChave ? 'text-gold-400' : 'text-dark-300'}`}>
                  {DIAS_SEMANA[dia.getDay()]} {dia.getDate()}
                </p>
                {(vendasPorDia.get(chave) ?? 0) > 0 && (
                  <span className="text-[10px] bg-green-600/30 text-green-300 rounded px-1 block w-fit">💰 {vendasPorDia.get(chave)}</span>
                )}
                {compromissosDia.map((c) => (
                  <CompromissoCard
                    key={c.id}
                    c={c}
                    compacto
                    mostrarVendedor={vendedorId === undefined}
                    onConcluir={() => atualizarMut.mutate({ id: c.id, concluido: true })}
                    onExcluir={(escopo) => excluirMut.mutate({ id: c.id, escopo })}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                  />
                ))}
                {(leadsPorDia.get(chave) ?? []).map((l) => (
                  <Link
                    key={`lead-${l.id}`}
                    to={`${leadsBasePath}/${l.id}`}
                    className="block rounded-lg border border-cyan-700/40 bg-cyan-950/20 p-2 text-sm hover:border-cyan-500/60"
                  >
                    <p className="text-cyan-200 font-medium truncate">🧲 {l.name}</p>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {modo === 'dia' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          className="bg-dark-800 border border-dark-600 rounded-2xl p-4 max-w-xl space-y-2"
        >
          {(vendasPorDia.get(dataInicio) ?? 0) > 0 || (contatosPorDia.get(dataInicio) ?? 0) > 0 ? (
            <p className="text-xs text-dark-400 mb-2">
              {(vendasPorDia.get(dataInicio) ?? 0) > 0 && `💰 ${vendasPorDia.get(dataInicio)} venda(s) fechada(s)`}
              {(vendasPorDia.get(dataInicio) ?? 0) > 0 && (contatosPorDia.get(dataInicio) ?? 0) > 0 && ' · '}
              {(contatosPorDia.get(dataInicio) ?? 0) > 0 && `📞 ${contatosPorDia.get(dataInicio)} contato(s) registrado(s)`}
            </p>
          ) : (
            <p className="text-xs text-dark-500 mb-2">Nenhuma venda ou contato registrado nesse dia.</p>
          )}
          {(compromissosPorDia.get(dataInicio) ?? []).length === 0 && (
            <p className="text-sm text-dark-500">Nenhum compromisso agendado pra esse dia.</p>
          )}
          {(compromissosPorDia.get(dataInicio) ?? [])
            .slice()
            .sort((a, b) => a.dataHora.localeCompare(b.dataHora))
            .map((c) => (
              <CompromissoCard
                key={c.id}
                c={c}
                mostrarVendedor={vendedorId === undefined}
                onConcluir={() => atualizarMut.mutate({ id: c.id, concluido: true })}
                onExcluir={(escopo) => excluirMut.mutate({ id: c.id, escopo })}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
              />
            ))}
          {(leadsPorDia.get(dataInicio) ?? []).map((l) => (
            <Link
              key={`lead-${l.id}`}
              to={`${leadsBasePath}/${l.id}`}
              className="block rounded-lg border border-cyan-700/40 bg-cyan-950/20 p-2 text-sm hover:border-cyan-500/60"
            >
              <p className="text-cyan-200 font-medium truncate">🧲 {horaLocalLead(l.nextContactAt!)} · {l.name}</p>
              <p className="text-xs text-dark-400 truncate">
                Lead · {l.phone}
                {vendedorId === undefined && l.vendor && ` · ${l.vendor.name}`}
              </p>
            </Link>
          ))}
        </div>
      )}

      {novoAberto && (
        <NovoCompromissoModal
          diaSelecionado={modo === 'mes' ? diaSelecionado : dataInicio}
          vendedorId={vendedorId}
          onClose={() => setNovoAberto(false)}
          onCriado={() => {
            invalidarTudo()
            setNovoAberto(false)
          }}
        />
      )}
    </div>
  )
}

export function NovoCompromissoModal({
  diaSelecionado,
  vendedorId,
  clienteIdFixo,
  clienteNomeFixo,
  onClose,
  onCriado,
}: {
  diaSelecionado: string
  vendedorId?: number
  clienteIdFixo?: number
  clienteNomeFixo?: string
  onClose: () => void
  onCriado: () => void
}) {
  const [tipo, setTipo] = useState('ligacao')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [data, setData] = useState(diaSelecionado)
  const [hora, setHora] = useState('09:00')
  const [busca, setBusca] = useState('')
  const [clienteId, setClienteId] = useState<number | undefined>(clienteIdFixo)
  const [recorrencia, setRecorrencia] = useState('nenhuma')
  const [recorrenciaAte, setRecorrenciaAte] = useState('')

  const { data: clientesEncontrados } = trpc.clientes.list.useQuery(
    { q: busca, pagina: 1, vendedorId },
    { enabled: busca.length >= 2 }
  )

  const criarMut = trpc.compromissos.criar.useMutation({
    onSuccess: () => {
      toast.success(recorrencia === 'nenhuma' ? 'Compromisso agendado' : 'Série de compromissos agendada')
      onCriado()
    },
    onError: (err) => toast.error(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) return toast.error('O título é obrigatório.')
    if (recorrencia !== 'nenhuma' && !recorrenciaAte) return toast.error('Escolha até quando repetir.')
    criarMut.mutate({
      tipo: tipo as any,
      titulo,
      descricao: descricao || undefined,
      dataHora: dataHoraLocalParaUtcString(data, hora),
      clienteId,
      vendedorId,
      recorrencia: recorrencia as any,
      recorrenciaAte: recorrencia !== 'nenhuma' ? recorrenciaAte : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-heading text-lg text-gold-400">Agendar compromisso</h2>

        <div className="grid grid-cols-2 gap-2">
          <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <Input label="Hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>

        <Select
          label="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          options={[
            { value: 'ligacao', label: 'Ligação' },
            { value: 'visita', label: 'Visita' },
            { value: 'reuniao', label: 'Reunião' },
            { value: 'outro', label: 'Outro' },
          ]}
        />

        <Input label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ligar de volta, visitar loja..." />

        {clienteIdFixo ? (
          <p className="text-sm text-dark-300">
            Cliente: <span className="font-medium text-dark-100">{clienteNomeFixo}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-sm text-dark-200 font-medium">Cliente (opcional)</label>
            <Input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setClienteId(undefined)
              }}
              placeholder="Buscar por nome..."
            />
            {busca.length >= 2 && !clienteId && (
              <div className="max-h-32 overflow-y-auto border border-dark-600 rounded-lg mt-1">
                {clientesEncontrados?.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setClienteId(c.id)
                      setBusca(c.razaoSocial)
                    }}
                    className="w-full text-left px-2 py-1.5 text-sm text-dark-200 hover:bg-dark-700"
                  >
                    {c.razaoSocial}
                  </button>
                ))}
                {!clientesEncontrados?.items.length && <p className="px-2 py-1.5 text-xs text-dark-500">Nenhum cliente encontrado.</p>}
              </div>
            )}
          </div>
        )}

        <Textarea label="Descrição (opcional)" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dark-700">
          <Select
            label="Repetir"
            value={recorrencia}
            onChange={(e) => setRecorrencia(e.target.value)}
            options={Object.entries(RECORRENCIA_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {recorrencia !== 'nenhuma' && (
            <Input label="Repetir até" type="date" min={data} value={recorrenciaAte} onChange={(e) => setRecorrenciaAte(e.target.value)} />
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={criarMut.isPending}>
            Salvar
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
