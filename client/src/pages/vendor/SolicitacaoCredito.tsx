import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Paperclip, X, MessageCircle, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'
import { parseValorBr } from '../../lib/valorBr'
import { formatDateTime } from '../../lib/utils'
import { buildContestarCreditoWaLink } from '../../lib/creditoWhatsapp'
import { Input, Textarea } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import ClientePicker from '../../components/ClientePicker'
import ConversarSobreIssoButton from '../../components/chat/ConversarSobreIssoButton'

function formatarMoeda(v: number | null | undefined): string {
  return v == null ? '—' : formatarMoedaBr(v)
}

const STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', liberado: 'Liberado', negado: 'Negado' }
const STATUS_COR: Record<string, string> = {
  pendente: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  liberado: 'text-green-400 bg-green-900/20 border-green-700/40',
  negado: 'text-red-400 bg-red-900/20 border-red-700/40',
}

type Anexo = { urlArquivo: string; nomeArquivo: string; tipoArquivo?: string }

async function fazerUpload(file: File): Promise<Anexo> {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/solicitacao-credito-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  return { urlArquivo: json.path, nomeArquivo: json.nome, tipoArquivo: json.tipo }
}

// Form de abertura — o vendedor só pode escolher cliente da própria
// carteira (ClientePicker já restringe isso em clientes.list pra não-admin).
// Anexos aceitam qualquer tipo (print, PDF, áudio, vídeo), um a um, igual
// CartaoCredito.tsx. Pedido do João, 2026-10-01.
function FormularioNovaSolicitacao() {
  const utils = trpc.useUtils()
  const [tipo, setTipo] = useState<'consulta' | 'limite'>('consulta')
  const [tipoConsulta, setTipoConsulta] = useState<'geral' | 'limpo'>('geral')
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [valorPedido, setValorPedido] = useState('')
  const [informacoesFiscais, setInformacoesFiscais] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const criarMut = trpc.solicitacaoCredito.solicitar.useMutation({
    onSuccess() {
      toast.success('Solicitação enviada pro Financeiro')
      setCliente(null)
      setValorPedido('')
      setInformacoesFiscais('')
      setObservacoes('')
      setAnexos([])
      utils.solicitacaoCredito.meusPedidos.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  async function onSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviandoArquivo(true)
    try {
      const anexo = await fazerUpload(file)
      setAnexos((prev) => [...prev, anexo])
    } catch (err: any) {
      toast.error(err.message ?? 'Erro no upload')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  function enviar() {
    if (!cliente) return toast.error('Escolha o cliente')
    const pedidoNumero = tipo === 'limite' && valorPedido ? parseValorBr(valorPedido) : undefined
    if (tipo === 'limite' && valorPedido && !pedidoNumero) return toast.error('Valor do pedido inválido')
    criarMut.mutate({
      clienteId: cliente.id,
      tipo,
      tipoConsulta: tipo === 'consulta' ? tipoConsulta : undefined,
      valorPedido: pedidoNumero,
      informacoesFiscais: informacoesFiscais.trim() || undefined,
      observacoes: observacoes.trim() || undefined,
      anexos: anexos.length ? anexos : undefined,
    })
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-medium text-dark-100">Nova solicitação de crédito</p>

      <div>
        <p className="text-sm text-dark-200 font-medium mb-1.5">O que você precisa?</p>
        <div className="flex gap-2">
          <Button variant={tipo === 'consulta' ? 'primary' : 'secondary'} size="sm" onClick={() => setTipo('consulta')}>
            Consulta
          </Button>
          <Button variant={tipo === 'limite' ? 'primary' : 'secondary'} size="sm" onClick={() => setTipo('limite')}>
            Limite de crédito
          </Button>
        </div>
      </div>

      {tipo === 'consulta' && (
        <p className="text-xs text-dark-400">O financeiro responde primeiro se o cliente está limpo no Serasa (com a data da consulta) e o limite.</p>
      )}
      {false && (
        <div>
          <p className="text-xs text-dark-400 mb-1.5">Tipo de consulta</p>
          <div className="flex gap-2">
            <Button variant={tipoConsulta === 'geral' ? 'primary' : 'secondary'} size="sm" onClick={() => setTipoConsulta('geral')}>
              Consulta geral
            </Button>
            <Button variant={tipoConsulta === 'limpo' ? 'primary' : 'secondary'} size="sm" onClick={() => setTipoConsulta('limpo')}>
              Só verificar se está limpo
            </Button>
          </div>
        </div>
      )}

      <ClientePicker label="Cliente (da sua carteira)" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />

      {tipo === 'limite' && (
        // "Limite desejado" saiu (João, 2026-11-25): vendedor confundia o valor
        // que pediu com o que o financeiro liberou. Só o valor do pedido.
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="Valor do pedido de venda" value={valorPedido} onChange={(e) => setValorPedido(e.target.value)} placeholder="R$ 0,00" />
        </div>
      )}

      <Textarea
        label="Informações fiscais (opcional)"
        placeholder="CNPJ, IE, situação fiscal, limite já usado, etc."
        rows={2}
        value={informacoesFiscais}
        onChange={(e) => setInformacoesFiscais(e.target.value)}
      />
      <Textarea
        label="Observações (opcional)"
        placeholder="Contexto da negociação, urgência, o que o cliente pediu..."
        rows={3}
        value={observacoes}
        onChange={(e) => setObservacoes(e.target.value)}
      />

      <div className="space-y-2">
        <p className="text-sm text-dark-200 font-medium">Anexos (print, comprovante, áudio, vídeo...)</p>
        <div className="flex items-center gap-2 flex-wrap">
          {anexos.map((a, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-dark-700 border border-dark-600 rounded-full px-2 py-1 text-dark-200">
              <Paperclip size={11} /> {a.nomeArquivo}
              <button type="button" onClick={() => setAnexos((prev) => prev.filter((_, idx) => idx !== i))} className="text-dark-500 hover:text-red-400">
                <X size={11} />
              </button>
            </span>
          ))}
          <label className="text-xs text-gold-400 hover:underline cursor-pointer">
            {enviandoArquivo ? 'Enviando...' : '+ anexar arquivo'}
            <input type="file" className="hidden" onChange={onSelecionarArquivo} disabled={enviandoArquivo} />
          </label>
        </div>
      </div>

      <Button loading={criarMut.isPending} onClick={enviar}>
        Enviar solicitação
      </Button>
    </div>
  )
}

const TIPO_LABEL: Record<string, string> = { consulta: 'Consulta', limite: 'Limite de crédito' }
const TIPO_CONSULTA_LABEL: Record<string, string> = { geral: 'Consulta geral', limpo: 'Só verificar se está limpo' }

type Solicitacao = {
  id: number
  clienteId: number
  clienteNome: string
  clienteCodigo: string
  tipo: string
  tipoConsulta: string | null
  status: string
  valorSolicitado: number | null
  informacoesFiscais: string | null
  observacoes: string | null
  valorLiberado: number | null
  quemLiberou: string | null
  motivoResposta: string | null
  serasaObservacao: string | null
  decisorNome: string | null
  decisorWhatsapp: string | null
  decididoEm: string | null
  createdAt: string
  anexos: { id: number; origem: string; urlArquivo: string; nomeArquivo: string }[]
}

function LinhaSolicitacao({ s }: { s: Solicitacao }) {
  const { user } = useAuth()
  const [aberto, setAberto] = useState(false)
  const anexosVendedor = s.anexos.filter((a) => a.origem === 'vendedor')
  const anexosFinanceiro = s.anexos.filter((a) => a.origem === 'financeiro')

  return (
    <div className="p-4">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div>
          <p className="text-sm text-dark-100 font-medium">{s.clienteNome}</p>
          <p className="text-xs text-dark-500">
            {s.tipo === 'consulta' && s.tipoConsulta ? TIPO_CONSULTA_LABEL[s.tipoConsulta] : TIPO_LABEL[s.tipo]} · Cód. {s.clienteCodigo} ·{' '}
            {formatDateTime(s.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Valor que o financeiro LIBEROU, bem à vista (João, 2026-11-25). */}
          {s.status === 'liberado' && s.valorLiberado != null && (
            <span className="text-right leading-tight">
              <span className="block text-[10px] uppercase tracking-wide text-dark-500">limite liberado</span>
              <span className="block text-base font-bold text-green-400">{formatarMoeda(s.valorLiberado)}</span>
            </span>
          )}
          <Badge className={STATUS_COR[s.status]}>{STATUS_LABEL[s.status]}</Badge>
          {aberto ? <ChevronUp size={16} className="text-dark-500" /> : <ChevronDown size={16} className="text-dark-500" />}
        </div>
      </button>

      {aberto && (
        <div className="mt-3 space-y-3 text-sm">
          <ConversarSobreIssoButton tipoOrigem="consulta_credito" idOrigem={s.id} titulo={`Consulta de crédito — ${s.clienteNome}`} />
          {s.informacoesFiscais && (
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wide">Informações fiscais</p>
              <p className="text-dark-200">{s.informacoesFiscais}</p>
            </div>
          )}
          {s.observacoes && (
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wide">Observações</p>
              <p className="text-dark-200">{s.observacoes}</p>
            </div>
          )}
          {!!anexosVendedor.length && (
            <div className="flex flex-wrap gap-2">
              {anexosVendedor.map((a) => (
                <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                  <Paperclip size={10} /> {a.nomeArquivo}
                </a>
              ))}
            </div>
          )}

          {s.status !== 'pendente' && (
            <div className="bg-dark-900/60 rounded-lg p-3 space-y-2 border border-dark-700">
              <p className="text-xs text-dark-500 uppercase tracking-wide">Resposta do Financeiro</p>
              {s.status === 'liberado' &&
                (s.tipo === 'consulta' && s.tipoConsulta === 'limpo' ? (
                  <p className="text-green-400 font-medium">Cliente está limpo</p>
                ) : (
                  <div>
                    <p className="text-green-400 font-medium">Liberado — {formatarMoeda(s.valorLiberado)}</p>
                    <p className="text-[11px] text-dark-500">Valor de limite de crédito do cliente</p>
                  </div>
                ))}
              {s.status === 'negado' && (
                <p className="text-red-400 font-medium">
                  {s.tipo === 'consulta' && s.tipoConsulta === 'limpo' ? 'Cliente não está limpo' : 'Negado'}
                </p>
              )}
              {s.quemLiberou && <p className="text-dark-300 text-xs">Decidido por: {s.quemLiberou}</p>}
              {s.motivoResposta && <p className="text-dark-200">{s.motivoResposta}</p>}
              {s.serasaObservacao && (
                <p className="text-dark-300 text-xs">
                  <span className="text-dark-500">Serasa:</span> {s.serasaObservacao}
                </p>
              )}
              {!!anexosFinanceiro.length && (
                <div className="flex flex-wrap gap-2">
                  {anexosFinanceiro.map((a) => (
                    <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                      <Paperclip size={10} /> {a.nomeArquivo}
                    </a>
                  ))}
                </div>
              )}
              {s.decididoEm && <p className="text-xs text-dark-500">{formatDateTime(s.decididoEm)}</p>}

              {s.decisorWhatsapp && (
                <a
                  href={buildContestarCreditoWaLink({
                    decisorWhatsapp: s.decisorWhatsapp,
                    vendedorNome: user?.name ?? '',
                    clienteNome: s.clienteNome,
                    decisao: s.status as 'liberado' | 'negado',
                    motivoResposta: s.motivoResposta ?? '',
                  })}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-green-500 hover:text-green-400 font-medium"
                >
                  <MessageCircle size={13} /> Contestar no WhatsApp
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function diasDesde(iso: string) {
  const hoje = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00')
  const n = Math.round((hoje.getTime() - new Date(iso.slice(0, 10) + 'T00:00:00').getTime()) / 86400000)
  return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`
}
const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/')

// Pesquisar antes de pedir (João, 2026-11-24): o vendedor digita código,
// CNPJ ou nome e vê se o cliente já foi consultado (em qualquer empresa do
// grupo) e se já tem pedido esperando resposta — pra não mandar de novo.
function PesquisarCliente() {
  const [texto, setTexto] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 350)
    return () => clearTimeout(t)
  }, [texto])
  const { data, isFetching } = trpc.solicitacaoCredito.pesquisarClienteVendedor.useQuery({ q }, { enabled: q.length >= 2 })

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-dark-100">Antes de pedir: esse cliente já foi consultado?</p>
        <p className="text-xs text-dark-500">Digite o código, o CNPJ/CPF ou o nome. Vale para todas as empresas do grupo.</p>
      </div>
      <Input icon={<Search size={14} />} placeholder="Ex: C001234 ou 12.345.678/0001-90" value={texto} onChange={(e) => setTexto(e.target.value)} />
      {q.length >= 2 && isFetching && !data && <p className="text-sm text-dark-400">Procurando...</p>}
      {q.length >= 2 && data && !data.grupos.length && <p className="text-sm text-dark-400">Nenhum cliente encontrado com "{q}".</p>}
      {data?.muitos && <p className="text-xs text-amber-400">Muitos resultados — digite o código ou o CNPJ completo.</p>}
      {q.length >= 2 &&
        data?.grupos.map((g) => {
          const u = g.ultimaConsulta
          return (
            <div key={g.chave} className="border border-dark-600 rounded-xl p-3 space-y-2">
              <div>
                <p className="text-sm font-medium text-dark-50">{g.nome}</p>
                <p className="text-xs text-dark-400">
                  {g.documento ? <>CNPJ/CPF {g.documento} · </> : null}
                  {g.cadastros.map((c) => `${c.codigo} (${c.empresaNome})`).join(' · ')}
                </p>
              </div>
              {u?.serasaConsultaEm ? (
                <div className={`rounded-lg border px-3 py-2 text-sm ${u.serasaLimpo ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                  <span className="font-semibold">
                    Consultado em {dataBr(u.serasaConsultaEm)} ({diasDesde(u.serasaConsultaEm)})
                  </span>{' '}
                  · {u.serasaLimpo ? 'Limpo' : 'Não está limpo'} · {STATUS_LABEL[u.status]} · {u.empresaNome}
                </div>
              ) : (
                <div className="rounded-lg border px-3 py-2 text-sm bg-dark-700/50 border-dark-600 text-dark-300">Ainda não foi consultado.</div>
              )}
              {g.pendenteDesde && (
                <div className="rounded-lg border px-3 py-2 text-sm bg-amber-500/10 border-amber-500/30 text-amber-300">
                  Já tem pedido esperando resposta do financeiro desde {formatDateTime(g.pendenteDesde)} — não precisa mandar de novo.
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}

export default function SolicitacaoCredito() {
  const { data: pedidos, isLoading } = trpc.solicitacaoCredito.meusPedidos.useQuery()

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Consulta/Solicitação de Crédito</h1>
          <p className="text-sm text-dark-400">Peça a liberação de crédito de um cliente da sua carteira pro Financeiro.</p>
        </div>
      </div>

      <PesquisarCliente />

      <FormularioNovaSolicitacao />

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !pedidos?.length && <p className="p-4 text-dark-400 text-sm">Nenhuma solicitação ainda.</p>}
        {pedidos?.map((s) => (
          <LinhaSolicitacao key={s.id} s={s as Solicitacao} />
        ))}
      </div>
    </div>
  )
}
