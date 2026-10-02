import { useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Paperclip, X, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react'
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
  const [cliente, setCliente] = useState<{ id: number; razaoSocial: string } | null>(null)
  const [valorSolicitado, setValorSolicitado] = useState('')
  const [informacoesFiscais, setInformacoesFiscais] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const criarMut = trpc.solicitacaoCredito.solicitar.useMutation({
    onSuccess() {
      toast.success('Solicitação enviada pro Financeiro')
      setCliente(null)
      setValorSolicitado('')
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
    const valorNumero = valorSolicitado ? parseValorBr(valorSolicitado) : undefined
    if (valorSolicitado && !valorNumero) return toast.error('Valor solicitado inválido')
    criarMut.mutate({
      clienteId: cliente.id,
      valorSolicitado: valorNumero,
      informacoesFiscais: informacoesFiscais.trim() || undefined,
      observacoes: observacoes.trim() || undefined,
      anexos: anexos.length ? anexos : undefined,
    })
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-medium text-dark-100">Nova solicitação de crédito</p>

      <ClientePicker label="Cliente (da sua carteira)" clienteId={cliente?.id ?? null} clienteNome={cliente?.razaoSocial ?? null} onSelect={setCliente} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Valor desejado (opcional)" value={valorSolicitado} onChange={(e) => setValorSolicitado(e.target.value)} placeholder="R$ 0,00" />
      </div>

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

type Solicitacao = {
  id: number
  clienteId: number
  clienteNome: string
  clienteCodigo: string
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
            Cód. {s.clienteCodigo} · {formatDateTime(s.createdAt)} {s.valorSolicitado != null && <>· pedido: {formatarMoeda(s.valorSolicitado)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
              {s.status === 'liberado' && (
                <p className="text-green-400 font-medium">Liberado — {formatarMoeda(s.valorLiberado)}</p>
              )}
              {s.status === 'negado' && <p className="text-red-400 font-medium">Negado</p>}
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
