import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { trpc } from '../lib/trpc'
import Button from './ui/Button'
import Select from './ui/Select'
import { Input, Textarea } from './ui/Input'

const TIPO_LABEL: Record<string, string> = { ligacao: 'Ligação', visita: 'Visita', reuniao: 'Reunião', outro: 'Outro' }
const TIPO_ICONE: Record<string, string> = { ligacao: '📞', visita: '🚗', reuniao: '🤝', outro: '📌' }
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function chaveData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function horaLocal(dataHora: string): string {
  return new Date(dataHora.replace(' ', 'T') + 'Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

// Calendário mensal compartilhado entre vendedor (só a própria agenda) e
// admin (escolhe um vendedor no seletor da página) — mostra compromissos
// futuros agendados e um resumo do que já aconteceu (vendas/contatos) no
// mesmo grid, dia a dia.
export default function CalendarBoard({ vendedorId }: { vendedorId?: number }) {
  const utils = trpc.useUtils()
  const [mesRef, setMesRef] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [diaSelecionado, setDiaSelecionado] = useState<string>(chaveData(new Date()))
  const [novoAberto, setNovoAberto] = useState(false)

  const primeiroDia = mesRef
  const ultimoDia = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0)
  const dataInicio = chaveData(primeiroDia)
  const dataFim = chaveData(ultimoDia)

  const { data: compromissos } = trpc.compromissos.listar.useQuery({ dataInicio, dataFim, vendedorId })
  const { data: historico } = trpc.compromissos.historico.useQuery({ dataInicio, dataFim, vendedorId })

  const vendasPorDia = useMemo(() => new Map((historico?.vendasPorDia ?? []).map((v) => [v.dia, v.quantidade])), [historico])
  const contatosPorDia = useMemo(() => new Map((historico?.contatosPorDia ?? []).map((v) => [v.dia, v.quantidade])), [historico])
  const compromissosPorDia = useMemo(() => {
    const mapa = new Map<string, typeof compromissos>()
    for (const c of compromissos ?? []) {
      const dia = c.dataHora.slice(0, 10)
      const lista = mapa.get(dia) ?? []
      lista.push(c)
      mapa.set(dia, lista as any)
    }
    return mapa
  }, [compromissos])

  function invalidarTudo() {
    utils.compromissos.listar.invalidate()
    utils.compromissos.historico.invalidate()
    utils.compromissos.pendentesNotificacao.invalidate()
  }

  const excluirMut = trpc.compromissos.excluir.useMutation({
    onSuccess() {
      toast.success('Compromisso excluído')
      invalidarTudo()
    },
    onError: (err) => toast.error(err.message),
  })

  const concluirMut = trpc.compromissos.atualizar.useMutation({
    onSuccess: invalidarTudo,
    onError: (err) => toast.error(err.message),
  })

  // Grid começa no domingo da semana do dia 1 e termina no sábado da semana
  // do último dia — pra sempre fechar semanas completas.
  const dias: Date[] = []
  const cursor = new Date(primeiroDia)
  cursor.setDate(cursor.getDate() - cursor.getDay())
  while (cursor <= ultimoDia || cursor.getDay() !== 0) {
    dias.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
    if (dias.length > 42) break
  }

  const hojeChave = chaveData(new Date())
  const compromissosDoDia = compromissosPorDia.get(diaSelecionado) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMesRef(new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1))}
            className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold text-dark-100 w-40 text-center">
            {mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </h2>
          <button
            onClick={() => setMesRef(new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 1))}
            className="p-1.5 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <Button size="sm" onClick={() => setNovoAberto(true)}>
          + Agendar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="grid grid-cols-7 gap-1.5">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="text-center text-xs text-dark-500 font-medium py-1">
              {d}
            </div>
          ))}
          {dias.map((dia) => {
            const chave = chaveData(dia)
            const foraDoMes = dia.getMonth() !== mesRef.getMonth()
            const compromissosDia = compromissosPorDia.get(chave) ?? []
            const vendas = vendasPorDia.get(chave) ?? 0
            const contatos = contatosPorDia.get(chave) ?? 0
            const selecionado = chave === diaSelecionado

            return (
              <button
                key={chave}
                onClick={() => setDiaSelecionado(chave)}
                className={`aspect-square rounded-lg border p-1.5 text-left flex flex-col transition-all ${
                  selecionado ? 'border-gold-500 bg-gold-700/10 ring-2 ring-gold-500/40' : 'border-dark-700 hover:border-dark-500'
                } ${foraDoMes ? 'opacity-30' : ''}`}
              >
                <span className={`text-xs ${chave === hojeChave ? 'text-gold-400 font-bold' : 'text-dark-300'}`}>{dia.getDate()}</span>
                <div className="flex-1 flex flex-col justify-end gap-0.5 mt-1">
                  {compromissosDia.length > 0 && (
                    <span className="text-[10px] bg-blue-600/30 text-blue-300 rounded px-1 truncate">
                      🎯 {compromissosDia.length}
                    </span>
                  )}
                  {vendas > 0 && <span className="text-[10px] bg-green-600/30 text-green-300 rounded px-1 truncate">💰 {vendas}</span>}
                  {contatos > 0 && <span className="text-[10px] bg-dark-700 text-dark-300 rounded px-1 truncate">📞 {contatos}</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Painel do dia selecionado — fica do lado do grid (não mais
            embaixo), com posição fixa (sticky) pra continuar visível ao
            rolar o mês inteiro numa tela menor. */}
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
              <div
                key={c.id}
                className={`rounded-lg border p-2 text-sm ${c.concluido ? 'border-dark-700 opacity-50' : 'border-dark-600'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-dark-100 font-medium">
                      {TIPO_ICONE[c.tipo]} {horaLocal(c.dataHora)} · {c.titulo}
                    </p>
                    {c.cliente && <p className="text-xs text-dark-400">Cliente: {c.cliente.razaoSocial}</p>}
                    {c.vendedor && vendedorId === undefined && <p className="text-xs text-dark-400">Vendedor: {c.vendedor.name}</p>}
                    {c.descricao && <p className="text-xs text-dark-300 mt-1">{c.descricao}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    {!c.concluido && (
                      <button
                        onClick={() => concluirMut.mutate({ id: c.id, concluido: true })}
                        className="text-green-400 hover:text-green-300"
                      >
                        Concluir
                      </button>
                    )}
                    <button onClick={() => excluirMut.mutate({ id: c.id })} className="text-red-400 hover:text-red-300">
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {novoAberto && (
        <NovoCompromissoModal
          diaSelecionado={diaSelecionado}
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

  const { data: clientesEncontrados } = trpc.clientes.list.useQuery(
    { q: busca, pagina: 1, vendedorId },
    { enabled: busca.length >= 2 }
  )

  const criarMut = trpc.compromissos.criar.useMutation({
    onSuccess: () => {
      toast.success('Compromisso agendado')
      onCriado()
    },
    onError: (err) => toast.error(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) return toast.error('O título é obrigatório.')
    criarMut.mutate({
      tipo: tipo as any,
      titulo,
      descricao: descricao || undefined,
      dataHora: dataHoraLocalParaUtcString(data, hora),
      clienteId,
      vendedorId,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl p-5 space-y-3"
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
