import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import ContatoButtons from '../components/ui/ContatoButtons'
import { timeAgo } from '../lib/utils'

const CANAL_LABELS: Record<string, string> = {
  google: 'Google',
  indicacao: 'Indicação',
  redes_sociais: 'Redes sociais',
  porta_a_porta: 'Porta a porta',
  outro: 'Outro',
}
const CANAL_OPTIONS = Object.entries(CANAL_LABELS).map(([value, label]) => ({ value, label }))

const TIPO_REGISTRO_LABELS: Record<string, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  visita: 'Visita',
  nota: 'Anotação',
}
const TIPO_REGISTRO_ICONE: Record<string, string> = { ligacao: '📞', whatsapp: '💬', email: '📧', visita: '🚗', nota: '📝' }
const TIPO_REGISTRO_OPTIONS = Object.entries(TIPO_REGISTRO_LABELS).map(([value, label]) => ({ value, label }))

// Linha do tempo de contatos/informações de um prospect específico —
// registrar o que já foi feito (ligou, mandou mensagem, visitou, ou só uma
// anotação solta) direto na tela de Prospecção, sem precisar mandar pra
// carteira só pra ter onde anotar. Pedido do João, 2026-09-02.
function HistoricoProspect({ clienteId }: { clienteId: number }) {
  const utils = trpc.useUtils()
  const { data: registros, isLoading } = trpc.prospeccao.listarRegistros.useQuery({ clienteId })
  const [tipo, setTipo] = useState('nota')
  const [observacao, setObservacao] = useState('')

  const registrarMut = trpc.prospeccao.registrarContato.useMutation({
    onSuccess() {
      toast.success('Registrado')
      setObservacao('')
      utils.prospeccao.listarRegistros.invalidate({ clienteId })
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!observacao.trim()) return toast.error('Escreva o que aconteceu.')
    registrarMut.mutate({ clienteId, tipo: tipo as any, observacao: observacao.trim() })
  }

  return (
    <div className="border-t border-dark-700 bg-dark-900/40 px-4 py-3 space-y-3">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-40 shrink-0">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)} options={TIPO_REGISTRO_OPTIONS} />
        </div>
        <Textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={1}
          placeholder="O que aconteceu com esse prospect..."
          className="flex-1"
        />
        <Button type="submit" size="sm" loading={registrarMut.isPending} className="shrink-0">
          Registrar
        </Button>
      </form>

      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {isLoading && <p className="text-xs text-dark-500">Carregando...</p>}
        {!isLoading && !registros?.length && <p className="text-xs text-dark-500">Nenhum registro ainda.</p>}
        {registros?.map((r) => (
          <div key={r.id} className="text-xs bg-dark-800 rounded-lg px-3 py-2">
            <p className="text-dark-200">
              {TIPO_REGISTRO_ICONE[r.tipo]} {r.observacao}
            </p>
            <p className="text-dark-500 mt-0.5">
              {r.registradoPor?.name ?? '—'} · {timeAgo(r.createdAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Prospects que o próprio vendedor caçou (Google, indicação, porta a porta...)
// — cadastro rápido (só nome + telefone), fora do Kanban/funil normal até o
// vendedor mandar "pra carteira", quando vira cliente de verdade. Pedido
// direto do João pra registrar esses leads sem misturar com a carteira ativa.
export default function Prospeccao() {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'

  const { data: vendedores } = trpc.users.vendors.useQuery(undefined, { enabled: user?.role === 'admin' })
  const [vendedorId, setVendedorId] = useState<number | null>(null)

  // Admin não tem carteira própria — a tela sempre olha pra um vendedor
  // específico, igual o Kanban do admin (seleciona o primeiro da lista).
  useEffect(() => {
    if (user?.role === 'admin' && vendedores && vendedores.length > 0 && vendedorId === null) {
      setVendedorId(vendedores[0].id)
    }
  }, [user, vendedores, vendedorId])

  const { data: prospects, isLoading } = trpc.prospeccao.listar.useQuery(
    user?.role === 'admin' ? { vendedorId: vendedorId ?? undefined } : undefined,
    { enabled: user?.role !== 'admin' || vendedorId !== null }
  )

  const [razaoSocial, setRazaoSocial] = useState('')
  const [telefone, setTelefone] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [canalOrigem, setCanalOrigem] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [expandidoId, setExpandidoId] = useState<number | null>(null)

  function invalidar() {
    utils.prospeccao.listar.invalidate()
  }

  const criarMut = trpc.prospeccao.criar.useMutation({
    onSuccess() {
      toast.success('Prospect cadastrado')
      setRazaoSocial('')
      setTelefone('')
      setObservacoes('')
      setCanalOrigem('')
      setMostrarForm(false)
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const enviarMut = trpc.prospeccao.enviarParaCarteira.useMutation({
    onSuccess() {
      toast.success('Enviado pra carteira — já aparece no Kanban.')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const descartarMut = trpc.prospeccao.descartar.useMutation({
    onSuccess() {
      toast.success('Prospect descartado')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!razaoSocial.trim()) return toast.error('Informe o nome do prospect.')
    if (!canalOrigem) return toast.error('Selecione o canal — de onde veio esse prospect.')
    criarMut.mutate({
      razaoSocial: razaoSocial.trim(),
      telefoneWhatsapp: telefone.trim() || undefined,
      observacoes: observacoes.trim() || undefined,
      canalOrigem: canalOrigem as 'google' | 'indicacao' | 'redes_sociais' | 'porta_a_porta' | 'outro',
      vendedorId: user?.role === 'admin' ? (vendedorId ?? undefined) : undefined,
    })
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Prospecção</h1>
          <p className="text-sm text-dark-400">Leads que você mesmo encontrou (Google, indicação...), antes de virarem cliente de carteira.</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === 'admin' && (
            <div className="w-56">
              <Select
                value={vendedorId ?? ''}
                onChange={(e) => setVendedorId(Number(e.target.value))}
                options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
              />
            </div>
          )}
          <Button onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? 'Cancelar' : '+ Novo prospect'}</Button>
        </div>
      </div>

      {mostrarForm && (
        <form onSubmit={handleSubmit} className="space-y-3 bg-dark-800 border border-dark-600 rounded-2xl p-5">
          <Input label="Nome do prospect" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} required />
          <Input label="Telefone/WhatsApp (opcional)" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <Select
            label="Canal — de onde veio esse prospect"
            value={canalOrigem}
            onChange={(e) => setCanalOrigem(e.target.value)}
            placeholder="Selecione..."
            options={CANAL_OPTIONS}
          />
          <Textarea
            label="Observações (opcional)"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={2}
            placeholder="Onde encontrou, o que conversaram..."
          />
          <Button type="submit" loading={criarMut.isPending}>
            Cadastrar prospect
          </Button>
        </form>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !prospects?.length && <p className="p-4 text-dark-400 text-sm">Nenhum prospect cadastrado ainda.</p>}
        {prospects?.map((p) => {
          const expandido = expandidoId === p.id
          return (
            <div key={p.id}>
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <button
                  onClick={() => setExpandidoId(expandido ? null : p.id)}
                  className="min-w-0 flex-1 text-left flex items-center gap-2"
                >
                  {expandido ? <ChevronUp size={14} className="shrink-0 text-dark-500" /> : <ChevronDown size={14} className="shrink-0 text-dark-500" />}
                  <span className="min-w-0">
                    <p className="font-medium text-dark-100 truncate">
                      {p.razaoSocial}
                      {p.canalOrigem && (
                        <span className="ml-2 text-xs font-normal text-gold-400 bg-gold-600/10 border border-gold-600/30 rounded px-1.5 py-0.5">
                          {CANAL_LABELS[p.canalOrigem]}
                        </span>
                      )}
                    </p>
                    {p.observacoes && <p className="text-xs text-dark-400 truncate">{p.observacoes}</p>}
                  </span>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Sem clienteId: prospect ainda não tem funil aberto (só existe depois de
                      "Enviar pra carteira"), então não dá pra registrar tentativa de contato aqui. */}
                  <ContatoButtons telefone={p.telefoneWhatsapp} telefonesExtras={p.telefonesExtras} size="sm" />
                  <Button size="sm" variant="secondary" onClick={() => enviarMut.mutate({ id: p.id })} loading={enviarMut.isPending}>
                    Enviar pra carteira
                  </Button>
                  <button
                    onClick={() => {
                      if (confirm(`Descartar o prospect "${p.razaoSocial}"?`)) descartarMut.mutate({ id: p.id })
                    }}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Descartar
                  </button>
                  <Link to={`${basePath}/clientes/${p.id}`} className="text-xs text-gold-400 hover:underline">
                    Editar
                  </Link>
                </div>
              </div>
              {expandido && <HistoricoProspect clienteId={p.id} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
