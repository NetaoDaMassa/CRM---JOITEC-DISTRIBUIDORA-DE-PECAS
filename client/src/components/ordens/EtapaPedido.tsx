import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { PRIORIDADE_CONFIG, type OrderType } from '../../lib/ordensShared'

const PRIORIDADES_MAQUINA = ['urgente', 'lead', 'normal', 'direto'] as const
const PRIORIDADES_PECA = ['urgente', 'normal'] as const

export default function EtapaPedido({ ordemId, isAdmin, readonly, orderType }: { ordemId: number; isAdmin: boolean; readonly: boolean; orderType: OrderType }) {
  const { data, isLoading } = trpc.ordens.financeiro.obterDetalhes.useQuery({ ordemId })
  const { data: anexos } = trpc.ordens.anexos.listar.useQuery({ ordemId, stage: 'pedido' })
  if (isLoading) return <p className="text-dark-500 text-sm">Carregando...</p>
  return <EtapaPedidoForm ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} data={data ?? null} anexos={anexos ?? []} />
}

function EtapaPedidoForm({
  ordemId,
  isAdmin,
  readonly,
  orderType,
  data,
  anexos,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  orderType: OrderType
  data: { numeroPedido: string | null; prioridadeDespacho: string | null; valorPedido: number | null; comissaoRevenda: string | null; revenda: string | null; observacoes: string | null } | null
  anexos: { id: number; nomeOriginal: string; nomeArmazenado: string }[]
}) {
  const utils = trpc.useUtils()
  const [numeroPedido, setNumeroPedido] = useState(data?.numeroPedido ?? '')
  const [prioridade, setPrioridade] = useState(data?.prioridadeDespacho ?? 'normal')
  const [valor, setValor] = useState(data?.valorPedido?.toString() ?? '')
  const [comissaoRevenda, setComissaoRevenda] = useState(data?.comissaoRevenda ?? '')
  const [revenda, setRevenda] = useState(data?.revenda ?? '')
  const { data: revendas } = trpc.revendas.listar.useQuery(undefined, { retry: false })
  const [obs, setObs] = useState(data?.observacoes ?? '')
  const [enviando, setEnviando] = useState(false)
  const podeEditar = isAdmin && !readonly
  const isPeca = orderType === 'peca'
  const opcoesPrioridade = isPeca ? PRIORIDADES_PECA : PRIORIDADES_MAQUINA

  const salvarMut = trpc.ordens.financeiro.atualizarDetalhes.useMutation({
    onSuccess: () => { toast.success('Salvo'); utils.ordens.financeiro.obterDetalhes.invalidate({ ordemId }) },
    onError: (e) => toast.error(e.message),
  })
  const registrarMut = trpc.ordens.anexos.registrar.useMutation({
    onSuccess: () => { toast.success('Pedido oficial anexado'); utils.ordens.anexos.listar.invalidate({ ordemId, stage: 'pedido' }) },
    onError: (e) => toast.error(e.message),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEnviando(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('odin_token')
      const resp = await fetch('/upload/ordem-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
      registrarMut.mutate({ ordemId, stage: 'pedido', fileCategory: 'pedido_oficial', nomeOriginal: json.nome, nomeArmazenado: json.path.replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setEnviando(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {!isPeca && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Número do pedido" defaultValue={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} disabled={!podeEditar} />
          <Input label="Valor do pedido" type="number" defaultValue={valor} onChange={(e) => setValor(e.target.value)} disabled={!podeEditar} />
          <Input label="Revenda responsável" list="revendas-pedido" defaultValue={revenda} onChange={(e) => setRevenda(e.target.value)} disabled={!podeEditar} />
          <datalist id="revendas-pedido">{(revendas ?? []).map((r) => <option key={r.id} value={r.nome} />)}</datalist>
          <Input label="Comissão de revenda" defaultValue={comissaoRevenda} onChange={(e) => setComissaoRevenda(e.target.value)} disabled={!podeEditar} />
        </div>
      )}

      <div>
        <label className="text-xs text-dark-400 mb-2 block">Prioridade de despacho</label>
        <div className={`grid gap-2 ${isPeca ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {opcoesPrioridade.map((p) => {
            const cfg = PRIORIDADE_CONFIG[p]
            const selecionado = prioridade === p
            const label = isPeca ? cfg.labelPeca ?? cfg.label : cfg.label
            return (
              <button
                key={p}
                type="button"
                disabled={!podeEditar}
                onClick={() => setPrioridade(p)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 py-2.5 px-2 text-center transition-colors disabled:opacity-60 ${
                  selecionado ? cfg.badge : 'border-dark-600 text-dark-400 hover:border-dark-500'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${cfg.barra}`} />
                <span className="text-xs font-semibold">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <Textarea label="Observações" defaultValue={obs} onChange={(e) => setObs(e.target.value)} disabled={!podeEditar} />

      {podeEditar && (
        <Button
          size="sm"
          loading={salvarMut.isPending}
          onClick={() => salvarMut.mutate({ ordemId, numeroPedido, prioridadeDespacho: prioridade as any, valorPedido: valor ? Number(valor) : undefined, comissaoRevenda, revenda, observacoes: obs })}
        >
          Salvar
        </Button>
      )}

      <div>
        <label className="text-xs text-dark-400 mb-1.5 block">Upload do Pedido Oficial *</label>
        <div className="space-y-2">
          {anexos.map((a) => (
            <a key={a.id} href={`/uploads/${a.nomeArmazenado}`} target="_blank" rel="noreferrer" className="block text-sm text-blue-400 hover:underline">{a.nomeOriginal}</a>
          ))}
        </div>
        {podeEditar && (
          <label className="mt-2 inline-block px-4 py-2 text-sm rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-100 border border-dark-600 cursor-pointer">
            {enviando ? 'Enviando...' : 'Anexar pedido oficial'}
            <input type="file" className="hidden" onChange={handleUpload} disabled={enviando} />
          </label>
        )}
        {anexos.length === 0 && <p className="text-xs text-yellow-500 mt-1.5">⚠️ O arquivo do pedido é obrigatório para avançar pra Cotação de Frete</p>}
      </div>
    </div>
  )
}
