import { useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Paperclip, X, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { usePersistedState } from '../../lib/usePersistedState'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'
import { parseValorBr } from '../../lib/valorBr'
import { formatDateTime } from '../../lib/utils'
import { Input, Textarea } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { HistoricoClienteView } from '../../components/HistoricoCliente'
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

// Detalhe de uma solicitação — mostra o pedido do vendedor + o histórico
// COMPLETO do cliente (reaproveita HistoricoCliente, mesmo componente da
// Ficha do Cliente) pra quem vai decidir não precisar abrir outra tela.
// Se ainda pendente, mostra o formulário de resposta; já decidido, mostra
// só o que foi registrado. Pedido do João, 2026-10-01.
function DetalheSolicitacaoModal({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.solicitacaoCredito.detalhe.useQuery({ id })
  const { data: historico, isLoading: carregandoHistorico } = trpc.solicitacaoCredito.historicoCliente.useQuery(
    { clienteId: data?.clienteId ?? 0 },
    { enabled: !!data?.clienteId }
  )

  const [decisao, setDecisao] = useState<'liberado' | 'negado'>('liberado')
  const [valorLiberado, setValorLiberado] = useState('')
  const [quemLiberou, setQuemLiberou] = useState('')
  const [motivoResposta, setMotivoResposta] = useState('')
  const [serasaObservacao, setSerasaObservacao] = useState('')
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const responderMut = trpc.solicitacaoCredito.responder.useMutation({
    onSuccess() {
      toast.success('Resposta registrada')
      utils.solicitacaoCredito.listar.invalidate()
      utils.solicitacaoCredito.detalhe.invalidate({ id })
      // Toda resposta também vira uma linha em Liberação de Crédito (ver
      // solicitacaoCredito.ts, responder) — invalida pra quem tiver aquela
      // tela aberta numa aba já ver sem precisar recarregar.
      utils.liberacaoCredito.listar.invalidate()
      utils.liberacaoCredito.relatorio.invalidate()
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

  function responder() {
    if (!quemLiberou.trim()) return toast.error('Informe quem decidiu')
    if (!motivoResposta.trim()) return toast.error('Informe o motivo')
    const valorNumero = decisao === 'liberado' ? parseValorBr(valorLiberado) : undefined
    if (decisao === 'liberado' && !valorNumero) return toast.error('Informe o valor liberado')
    responderMut.mutate({
      id,
      decisao,
      valorLiberado: valorNumero,
      quemLiberou: quemLiberou.trim(),
      motivoResposta: motivoResposta.trim(),
      serasaObservacao: serasaObservacao.trim() || undefined,
      anexos: anexos.length ? anexos : undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title="Solicitação de crédito" size="xl">
      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}
      {data && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-dark-100 font-medium">{data.clienteNome}</p>
              <p className="text-xs text-dark-500">
                Cód. {data.clienteCodigo} · {data.empresaNome} · pedido de {data.vendedorNome} · {formatDateTime(data.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ConversarSobreIssoButton tipoOrigem="consulta_credito" idOrigem={data.id} titulo={`Consulta de crédito — ${data.clienteNome}`} />
              <Badge className={STATUS_COR[data.status]}>{STATUS_LABEL[data.status]}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-dark-900/60 border border-dark-700 rounded-xl p-4 text-sm">
            {data.valorSolicitado != null && (
              <div>
                <p className="text-xs text-dark-500 uppercase tracking-wide">Valor solicitado</p>
                <p className="text-dark-100">{formatarMoeda(data.valorSolicitado)}</p>
              </div>
            )}
            {data.informacoesFiscais && (
              <div className="md:col-span-2">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Informações fiscais</p>
                <p className="text-dark-200">{data.informacoesFiscais}</p>
              </div>
            )}
            {data.observacoes && (
              <div className="md:col-span-2">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Observações do vendedor</p>
                <p className="text-dark-200">{data.observacoes}</p>
              </div>
            )}
            {!!data.anexos.filter((a) => a.origem === 'vendedor').length && (
              <div className="md:col-span-2 flex flex-wrap gap-2">
                {data.anexos
                  .filter((a) => a.origem === 'vendedor')
                  .map((a) => (
                    <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                      <Paperclip size={10} /> {a.nomeArquivo}
                    </a>
                  ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-dark-200 mb-2">Histórico completo do cliente</p>
            <HistoricoClienteView data={historico} isLoading={carregandoHistorico} />
          </div>

          {data.status === 'pendente' ? (
            <div className="space-y-3 border-t border-dark-700 pt-4">
              <p className="text-sm font-semibold text-dark-200">Responder</p>
              <div className="flex gap-2">
                <Button variant={decisao === 'liberado' ? 'primary' : 'secondary'} size="sm" onClick={() => setDecisao('liberado')}>
                  Liberar
                </Button>
                <Button variant={decisao === 'negado' ? 'primary' : 'secondary'} size="sm" onClick={() => setDecisao('negado')}>
                  Negar
                </Button>
              </div>

              {decisao === 'liberado' && (
                <Input label="Valor liberado — limite de crédito do cliente *" value={valorLiberado} onChange={(e) => setValorLiberado(e.target.value)} placeholder="R$ 0,00" />
              )}
              <Input label="Quem decidiu *" placeholder="Ex: Rubia, Diretoria..." value={quemLiberou} onChange={(e) => setQuemLiberou(e.target.value)} />
              <Textarea
                label="Motivo *"
                rows={3}
                placeholder="Por que foi liberado/negado..."
                value={motivoResposta}
                onChange={(e) => setMotivoResposta(e.target.value)}
              />
              <Textarea
                label="Serasa (opcional)"
                rows={2}
                placeholder="O que a consulta do Serasa mostrou..."
                value={serasaObservacao}
                onChange={(e) => setSerasaObservacao(e.target.value)}
              />

              <div className="space-y-2">
                <p className="text-sm text-dark-200 font-medium">Anexos (print do Serasa, comprovante...)</p>
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

              <Button className="w-full" loading={responderMut.isPending} onClick={responder}>
                Registrar resposta
              </Button>
            </div>
          ) : (
            <div className="space-y-2 border-t border-dark-700 pt-4 text-sm">
              <p className="text-sm font-semibold text-dark-200">Resposta registrada</p>
              {data.status === 'liberado' && (
                <div>
                  <p className="text-green-400 font-medium">Liberado — {formatarMoeda(data.valorLiberado)}</p>
                  <p className="text-[11px] text-dark-500">Valor de limite de crédito do cliente</p>
                </div>
              )}
              {data.status === 'negado' && <p className="text-red-400 font-medium">Negado</p>}
              {data.quemLiberou && <p className="text-dark-300 text-xs">Decidido por: {data.quemLiberou}</p>}
              {data.motivoResposta && <p className="text-dark-200">{data.motivoResposta}</p>}
              {data.serasaObservacao && (
                <p className="text-dark-300 text-xs">
                  <span className="text-dark-500">Serasa:</span> {data.serasaObservacao}
                </p>
              )}
              {!!data.anexos.filter((a) => a.origem === 'financeiro').length && (
                <div className="flex flex-wrap gap-2">
                  {data.anexos
                    .filter((a) => a.origem === 'financeiro')
                    .map((a) => (
                      <a key={a.id} href={a.urlArquivo} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline flex items-center gap-1">
                        <Paperclip size={10} /> {a.nomeArquivo}
                      </a>
                    ))}
                </div>
              )}
              {data.decididoEm && <p className="text-xs text-dark-500">{formatDateTime(data.decididoEm)}</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function SolicitacaoCredito() {
  const [status, setStatus] = usePersistedState<'pendente' | 'liberado' | 'negado' | ''>('solicitacaoCredito:status', 'pendente')
  const [dataDe, setDataDe] = usePersistedState('solicitacaoCredito:dataDe', '')
  const [dataAte, setDataAte] = usePersistedState('solicitacaoCredito:dataAte', '')
  const [vendedorId, setVendedorId] = usePersistedState('solicitacaoCredito:vendedorId', '')
  const [busca, setBusca] = usePersistedState('solicitacaoCredito:busca', '')
  const [abertoId, setAbertoId] = useState<number | null>(null)

  const { data: vendedores } = trpc.solicitacaoCredito.vendedoresOpcoes.useQuery()
  const { data: linhas, isLoading } = trpc.solicitacaoCredito.listar.useQuery({
    status: status || undefined,
    dataDe: dataDe || undefined,
    dataAte: dataAte || undefined,
    vendedorId: vendedorId ? Number(vendedorId) : undefined,
    q: busca || undefined,
  })

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Consulta/Solicitação de Crédito</h1>
          <p className="text-sm text-dark-400">Pedidos de liberação de crédito feitos pelos vendedores.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="w-56">
          <Input icon={<Search size={14} />} label="Buscar cliente" placeholder="Razão social ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        <div className="w-48">
          <Select
            label="Vendedor"
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            placeholder="Todos"
            options={(vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
        </div>
        <div className="w-44">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: 'pendente', label: 'Pendentes' },
              { value: 'liberado', label: 'Liberados' },
              { value: 'negado', label: 'Negados' },
              { value: '', label: 'Todas' },
            ]}
          />
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !linhas?.length && <p className="p-4 text-dark-400 text-sm">Nenhuma solicitação encontrada.</p>}
        {linhas?.map((l) => (
          <button
            key={l.id}
            onClick={() => setAbertoId(l.id)}
            className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-dark-700/40 transition-colors"
          >
            <div>
              <p className="text-sm text-dark-100 font-medium">{l.clienteNome}</p>
              <p className="text-xs text-dark-500">
                Cód. {l.clienteCodigo} · {l.empresaNome} · pedido de {l.vendedorNome} · {formatDateTime(l.createdAt)}
                {l.valorSolicitado != null && <> · {formatarMoeda(l.valorSolicitado)}</>}
              </p>
            </div>
            <Badge className={STATUS_COR[l.status]}>{STATUS_LABEL[l.status]}</Badge>
          </button>
        ))}
      </div>

      {abertoId !== null && <DetalheSolicitacaoModal id={abertoId} onClose={() => setAbertoId(null)} />}
    </div>
  )
}
