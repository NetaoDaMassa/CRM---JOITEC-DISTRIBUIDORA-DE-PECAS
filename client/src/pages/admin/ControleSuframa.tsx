import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, Plus, Pencil, Trash2, Copy, History } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { Input, Textarea } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ComoUsar from '../../components/ui/ComoUsar'

// Controle SUFRAMA (Financeiro) — PIN de cada nota fiscal de cliente da Zona
// Franca, nota a nota. Substitui o documento Word "SUFRAMA" (os dados dele
// entraram na migração 0129). Pedido do João, 2026-10-28.

type ClienteSuframa = inferRouterOutputs<AppRouter>['suframa']['listar'][number]
type NotaSuframa = ClienteSuframa['notas'][number]
type Status = NotaSuframa['status']

const STATUS: { value: Status; label: string; classe: string; cor: string }[] = [
  { value: 'pin_solicitado', label: 'PIN solicitado', classe: 'bg-blue-500/15 text-blue-300 border-blue-500/30', cor: 'text-blue-300' },
  { value: 'aguardando', label: 'Aguardando conf. de receb.', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30', cor: 'text-amber-300' },
  { value: 'ok', label: 'OK', classe: 'bg-green-500/15 text-green-300 border-green-500/30', cor: 'text-green-300' },
]
const STATUS_POR_VALOR = Object.fromEntries(STATUS.map((s) => [s.value, s])) as Record<Status, (typeof STATUS)[number]>

// CNPJ do emitente (dentro da chave) → empresa do grupo.
const EMITENTES: Record<string, string> = {
  '21940961000156': 'Joitec',
  '54774805000111': 'Odin Tubos',
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function nomeMes(mes: string) {
  return `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`
}

function formatarCnpj(c: string) {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

// Mesmo cálculo do servidor (suframa.ts lerChaveNfe) — só pra mostrar a
// prévia enquanto digita a chave.
function lerChave(bruta: string) {
  const chave = bruta.replace(/\D/g, '')
  if (chave.length !== 44) return null
  return { numero: String(Number(chave.slice(25, 34))), mes: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`, cnpj: chave.slice(6, 20) }
}

function ModalCliente({ cliente, open, onClose }: { cliente: ClienteSuframa | null; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [codigo, setCodigo] = useState(cliente?.codigo ?? '')
  const [nome, setNome] = useState(cliente?.nome ?? '')
  const [telefone, setTelefone] = useState(cliente?.telefone ?? '')
  const [naoPrecisaPin, setNaoPrecisaPin] = useState(cliente?.naoPrecisaPin ?? false)
  const [observacao, setObservacao] = useState(cliente?.observacao ?? '')
  const [clienteId, setClienteId] = useState<number | null>(cliente?.clienteId ?? null)
  const [codigoBusca, setCodigoBusca] = useState('')
  const { data: achados } = trpc.suframa.buscarClienteCrm.useQuery({ codigo: codigoBusca }, { enabled: !!codigoBusca })

  const salvarMut = trpc.suframa.salvarCliente.useMutation({
    onSuccess() {
      toast.success('Cliente salvo')
      utils.suframa.listar.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title={cliente ? 'Editar cliente' : 'Novo cliente no controle'} size="md">
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label="Código do cliente" placeholder="ex: C001855" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />
          </div>
          <Button size="sm" variant="secondary" onClick={() => setCodigoBusca(codigo.trim())} disabled={!codigo.trim()}>
            Buscar no CRM
          </Button>
        </div>
        {codigoBusca && achados && (
          <div className="rounded-lg border border-dark-700 bg-dark-900/50 p-2 text-sm space-y-1">
            {achados.length === 0 && <p className="text-dark-400">Nenhum cliente com esse código no CRM — preencha o nome à mão.</p>}
            {achados.map((a) => (
              <button
                key={a.id}
                type="button"
                className="block w-full text-left rounded px-2 py-1 hover:bg-dark-700"
                onClick={() => {
                  setNome(a.razaoSocial)
                  if (a.telefone) setTelefone(a.telefone)
                  setClienteId(a.id)
                  setCodigoBusca('')
                }}
              >
                <span className="text-dark-100">{a.razaoSocial}</span> <span className="text-dark-500">· {a.empresa}</span>
              </button>
            ))}
          </div>
        )}
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input label="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" checked={naoPrecisaPin} onChange={(e) => setNaoPrecisaPin(e.target.checked)} />
          Este cliente não precisa de PIN
        </label>
        <Textarea label="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvarMut.isPending}
            onClick={() => {
              if (!codigo.trim()) return toast.error('Informe o código do cliente')
              salvarMut.mutate({ id: cliente?.id, codigo, nome, telefone, naoPrecisaPin, observacao, clienteId })
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ModalNota({ cliente, open, onClose }: { cliente: ClienteSuframa; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [chave, setChave] = useState('')
  const [status, setStatus] = useState<Status>('pin_solicitado')
  const [pin, setPin] = useState('')
  const [observacao, setObservacao] = useState('')
  const lida = lerChave(chave)
  const digitos = chave.replace(/\D/g, '').length

  const criarMut = trpc.suframa.adicionarNota.useMutation({
    onSuccess() {
      toast.success('Nota adicionada')
      utils.suframa.listar.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title={`Nova nota — ${cliente.nome ?? cliente.codigo}`} size="md">
      <div className="space-y-3">
        <Input
          label="Chave de acesso da nota (44 números)"
          placeholder="Cole a chave da NF-e"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
        />
        {lida ? (
          <p className="text-xs text-green-400">
            Nota {lida.numero} · emitida em {nomeMes(lida.mes)} · {EMITENTES[lida.cnpj] ?? formatarCnpj(lida.cnpj)}
          </p>
        ) : (
          digitos > 0 && <p className="text-xs text-amber-400">{digitos} de 44 números</p>
        )}
        <div>
          <p className="text-xs text-dark-400 mb-1">Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(s.value)}
                className={`text-xs rounded-lg border px-2.5 py-1.5 ${status === s.value ? s.classe : 'border-dark-600 text-dark-400'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Input label="PIN (se já tiver)" value={pin} onChange={(e) => setPin(e.target.value)} />
        <Textarea label="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={criarMut.isPending}
            disabled={!lida}
            onClick={() => criarMut.mutate({ suframaClienteId: cliente.id, chave, status, pin, observacao })}
          >
            Adicionar nota
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ModalHistorico({ nota, onClose }: { nota: NotaSuframa; onClose: () => void }) {
  const { data } = trpc.suframa.eventos.useQuery({ notaId: nota.id })
  return (
    <Modal open onClose={onClose} title={`Histórico — nota ${nota.numeroNota}`} size="md">
      <div className="space-y-2">
        {data?.length === 0 && <p className="text-sm text-dark-400">Sem histórico.</p>}
        {data?.map((e) => (
          <div key={e.id} className="rounded-lg border border-dark-700 px-3 py-2">
            <p className="text-sm text-dark-100">{e.descricao}</p>
            <p className="text-xs text-dark-500">
              {e.createdAt.slice(8, 10)}/{e.createdAt.slice(5, 7)}/{e.createdAt.slice(0, 4)} {e.createdAt.slice(11, 16)} (UTC) · {e.usuario ?? 'sistema'}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function LinhaNota({ nota }: { nota: NotaSuframa }) {
  const utils = trpc.useUtils()
  const [pin, setPin] = useState(nota.pin ?? '')
  const [historico, setHistorico] = useState(false)
  const atualizarMut = trpc.suframa.atualizarNota.useMutation({
    onSuccess() {
      utils.suframa.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const excluirMut = trpc.suframa.excluirNota.useMutation({
    onSuccess() {
      toast.success('Nota excluída')
      utils.suframa.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const st = STATUS_POR_VALOR[nota.status]

  return (
    <div className="grid grid-cols-1 md:grid-cols-[110px_70px_1fr_140px_290px] gap-2 md:gap-3 items-center px-4 py-3 border-t border-dark-700 first:border-t-0">
      <div>
        <p className="text-sm font-semibold text-dark-100">Nota {nota.numeroNota}</p>
        <p className="text-[11px] text-dark-500">{EMITENTES[nota.cnpjEmitente] ?? formatarCnpj(nota.cnpjEmitente)}</p>
      </div>
      <p className="text-xs text-dark-400">{nomeMes(nota.mesEmissao)}</p>
      <div className="min-w-0">
        <p className="text-[11px] text-dark-400 break-all font-mono">{nota.chave}</p>
        {nota.observacao && <p className="text-xs text-amber-400 mt-0.5">⚠ {nota.observacao}</p>}
      </div>
      <input
        className="w-full rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-sm text-dark-100"
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onBlur={() => {
          if ((pin.trim() || null) !== (nota.pin ?? null)) atualizarMut.mutate({ id: nota.id, pin })
        }}
      />
      <div className="flex items-center gap-1.5">
        <select
          className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs font-semibold ${st.classe}`}
          value={nota.status}
          onChange={(e) => atualizarMut.mutate({ id: nota.id, status: e.target.value as Status })}
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value} className="bg-dark-800 text-dark-100">
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Copiar chave"
          className="p-1.5 rounded-lg text-dark-400 hover:text-gold-400 hover:bg-dark-700"
          onClick={() => {
            navigator.clipboard?.writeText(nota.chave).then(() => toast.success('Chave copiada'), () => toast.error('Não deu pra copiar'))
          }}
        >
          <Copy size={14} />
        </button>
        <button type="button" title="Histórico" className="p-1.5 rounded-lg text-dark-400 hover:text-gold-400 hover:bg-dark-700" onClick={() => setHistorico(true)}>
          <History size={14} />
        </button>
        <button
          type="button"
          title="Excluir nota"
          className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-dark-700"
          onClick={() => {
            if (window.confirm(`Excluir a nota ${nota.numeroNota} do controle?`)) excluirMut.mutate({ id: nota.id })
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {historico && <ModalHistorico nota={nota} onClose={() => setHistorico(false)} />}
    </div>
  )
}

export default function ControleSuframa() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.suframa.listar.useQuery()
  const [busca, setBusca] = useState('')
  const [mes, setMes] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<Status | ''>('')
  const [clienteEditando, setClienteEditando] = useState<ClienteSuframa | null | 'novo'>(null)
  const [notaNova, setNotaNova] = useState<ClienteSuframa | null>(null)
  const excluirClienteMut = trpc.suframa.excluirCliente.useMutation({
    onSuccess() {
      toast.success('Cliente removido do controle')
      utils.suframa.listar.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const clientes = data ?? []
  const todasNotas = clientes.flatMap((c) => c.notas)
  const contagem = { pin_solicitado: 0, aguardando: 0, ok: 0 } as Record<Status, number>
  for (const n of todasNotas) contagem[n.status]++
  const meses = useMemo(() => [...new Set(todasNotas.map((n) => n.mesEmissao))].sort().reverse(), [todasNotas])

  const termo = busca.trim().toLowerCase()
  const visiveis = clientes
    .map((c) => {
      const notas = c.notas.filter((n) => (!filtroStatus || n.status === filtroStatus) && (!mes || n.mesEmissao === mes))
      return { c, notas }
    })
    .filter(({ c, notas }) => {
      if (termo) {
        const texto = `${c.codigo} ${c.nome ?? ''} ${c.notas.map((n) => `${n.numeroNota} ${n.chave} ${n.pin ?? ''}`).join(' ')}`.toLowerCase()
        if (!texto.includes(termo)) return false
      }
      if ((filtroStatus || mes) && notas.length === 0) return false
      return true
    })

  const cartoes: { valor: Status | ''; label: string; qtd: number; cor: string }[] = [
    { valor: '', label: 'Todas as notas', qtd: todasNotas.length, cor: 'text-dark-100' },
    ...STATUS.map((s) => ({ valor: s.value, label: s.label, qtd: contagem[s.value], cor: s.cor })),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
            <KeyRound size={20} className="text-blue-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Controle SUFRAMA</h1>
            <p className="text-sm text-dark-400">PIN de cada nota fiscal por cliente — altere o status conforme a consulta no Simnac.</p>
          </div>
        </div>
        <Button onClick={() => setClienteEditando('novo')}>
          <Plus size={16} className="mr-1" /> Novo cliente
        </Button>
      </div>

      <ComoUsar
        chave="controle_suframa"
        passos={[
          <>Cliente novo? Clique em <b>Novo cliente</b>, digite o <b>código</b> (ex.: C001855) e clique em <b>Buscar no CRM</b> — nome e telefone vêm sozinhos. Se o cliente não precisa de PIN, marque <b>“Este cliente não precisa de PIN”</b>.</>,
          <>Para cada nota vendida, clique em <b>+ Nota</b> no cliente e <b>cole a chave de acesso da NF-e</b> (os 44 números da DANFE). O número da nota, o mês e a empresa que emitiu (Joitec ou Odin Tubos) aparecem sozinhos — confira e clique em <b>Adicionar nota</b>.</>,
          <>Quando pedir o PIN no Simnac, deixe o status em <b>PIN solicitado</b>. Recebeu o número do PIN? Digite no campo <b>PIN</b> da nota (salva quando você clica fora do campo).</>,
          <>Depois de consultar no Simnac, troque o status: <b>Aguardando conf. de receb.</b> enquanto o cliente não confirmar o recebimento, e <b>OK</b> quando estiver tudo certo.</>,
        ]}
        dicas={[
          <>Botão de copiar ao lado do status: copia a chave da nota para colar no Simnac.</>,
          <>Botão de relógio: mostra o histórico da nota (quem mudou o quê e quando).</>,
          <>Clique nos números do topo (PIN solicitado / Aguardando / OK) para ver só as notas daquele status; use a busca ou o filtro de mês para achar uma nota.</>,
          <>A mesma chave não entra duas vezes — se aparecer aviso de nota já cadastrada, ela já está em algum cliente (use a busca).</>,
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cartoes.map((k) => (
          <button
            key={k.valor || 'todas'}
            type="button"
            onClick={() => setFiltroStatus(k.valor)}
            className={`text-left rounded-xl border bg-dark-800 p-3 transition-colors ${filtroStatus === k.valor ? 'border-gold-500' : 'border-dark-600 hover:border-dark-500'}`}
          >
            <p className={`text-2xl font-bold ${k.cor}`}>{k.qtd}</p>
            <p className="text-xs text-dark-400">{k.label}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input placeholder="Buscar cliente, código, nº da nota, chave ou PIN…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select
          className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
        >
          <option value="">Todos os meses</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {nomeMes(m)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando…</p>}
      {!isLoading && visiveis.length === 0 && <p className="text-dark-400 text-sm">Nenhum resultado.</p>}

      <div className="space-y-3">
        {visiveis.map(({ c, notas }) => {
          const cont = { pin_solicitado: 0, aguardando: 0, ok: 0 } as Record<Status, number>
          for (const n of c.notas) cont[n.status]++
          return (
            <div key={c.id} className="rounded-2xl border border-dark-600 bg-dark-800 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-dark-700">
                <div>
                  <p className="font-semibold text-dark-100">
                    {c.nome || '—'} <span className="text-sm font-normal text-dark-400">· {c.codigo}{c.telefone ? ` · ${c.telefone}` : ''}</span>
                  </p>
                  {c.observacao && <p className="text-xs text-dark-400">{c.observacao}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.naoPrecisaPin ? (
                    <span className="text-xs rounded-full px-2.5 py-0.5 bg-dark-700 text-dark-300">Não precisa de PIN</span>
                  ) : (
                    STATUS.filter((s) => cont[s.value] > 0).map((s) => (
                      <span key={s.value} className={`text-xs rounded-full border px-2.5 py-0.5 ${s.classe}`}>
                        {cont[s.value]} {s.label}
                      </span>
                    ))
                  )}
                  {!c.naoPrecisaPin && (
                    <Button size="sm" variant="secondary" onClick={() => setNotaNova(c)}>
                      <Plus size={14} className="mr-1" /> Nota
                    </Button>
                  )}
                  <button type="button" title="Editar cliente" className="p-1.5 rounded-lg text-dark-400 hover:text-gold-400 hover:bg-dark-700" onClick={() => setClienteEditando(c)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    title="Remover cliente do controle"
                    className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-dark-700"
                    onClick={() => {
                      if (window.confirm(`Remover ${c.nome || c.codigo} do Controle SUFRAMA (com as notas dele)?`)) excluirClienteMut.mutate({ id: c.id })
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {c.naoPrecisaPin && <p className="px-4 py-3 text-sm text-dark-400">Este cliente não precisa de PIN.</p>}
              {!c.naoPrecisaPin && c.notas.length === 0 && <p className="px-4 py-3 text-sm text-dark-400">Nenhuma nota cadastrada ainda.</p>}
              {notas.map((n) => (
                <LinhaNota key={n.id} nota={n} />
              ))}
            </div>
          )
        })}
      </div>

      {clienteEditando && (
        <ModalCliente
          key={clienteEditando === 'novo' ? 'novo' : clienteEditando.id}
          cliente={clienteEditando === 'novo' ? null : clienteEditando}
          open
          onClose={() => setClienteEditando(null)}
        />
      )}
      {notaNova && <ModalNota key={notaNova.id} cliente={notaNova} open onClose={() => setNotaNova(null)} />}
    </div>
  )
}
