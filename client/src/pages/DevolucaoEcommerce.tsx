import { useState } from 'react'
import { Plus, Download, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { usePersistedState } from '../lib/usePersistedState'
import { formatarMoeda as formatarMoedaBr } from '../lib/moeda'
import { paraCsv, baixarCsv } from '../lib/csv'
import { primeiroDiaMesString, hojeBrString } from '../lib/utils'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'

const MARKETPLACE_VALUES = ['mercado_livre', 'shopee', 'tiktok', 'outro'] as const
type Marketplace = (typeof MARKETPLACE_VALUES)[number]
const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  tiktok: 'TikTok',
  outro: 'Outro',
}

const STATUS_RECURSO_VALUES = ['sem_recurso', 'aguardando', 'aprovado', 'negado', 'reembolsado'] as const
type StatusRecurso = (typeof STATUS_RECURSO_VALUES)[number]
const STATUS_RECURSO_LABELS: Record<StatusRecurso, string> = {
  sem_recurso: 'Sem recurso',
  aguardando: 'Aguardando recurso',
  aprovado: 'Recurso aprovado',
  negado: 'Recurso negado',
  reembolsado: 'Reembolsado',
}
const STATUS_RECURSO_CORES: Record<StatusRecurso, string> = {
  sem_recurso: 'text-dark-400 bg-dark-700/40 border-dark-600',
  aguardando: 'text-amber-400 bg-amber-900/20 border-amber-700/40',
  aprovado: 'text-green-400 bg-green-900/20 border-green-700/40',
  negado: 'text-red-400 bg-red-900/20 border-red-700/40',
  reembolsado: 'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
}

function formatarMoeda(v: number): string {
  return formatarMoedaBr(v)
}
function formatarData(d: string): string {
  const [ano, mes, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

type Devolucao = {
  id: number
  data: string
  marketplace: string
  loja: string
  pedido: string
  nfEntrada: string | null
  nfDevolucao: string | null
  valorVenda: number
  motivo: string
  statusRecurso: string
  valorRecurso: number | null
  custoDevolucao: number | null
  erroExpedicao: boolean
  observacoes: string | null
}

const FORM_VAZIO = {
  data: hojeBrString(),
  marketplace: 'mercado_livre' as Marketplace,
  loja: '',
  pedido: '',
  nfEntrada: '',
  nfDevolucao: '',
  valorVenda: '',
  motivo: '',
  statusRecurso: 'sem_recurso' as StatusRecurso,
  valorRecurso: '',
  custoDevolucao: '',
  erroExpedicao: false,
  observacoes: '',
}

function DevolucaoModal({ editando, onClose }: { editando: Devolucao | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [form, setForm] = useState(() =>
    editando
      ? {
          data: editando.data.slice(0, 10),
          marketplace: editando.marketplace as Marketplace,
          loja: editando.loja,
          pedido: editando.pedido,
          nfEntrada: editando.nfEntrada ?? '',
          nfDevolucao: editando.nfDevolucao ?? '',
          valorVenda: String(editando.valorVenda),
          motivo: editando.motivo,
          statusRecurso: editando.statusRecurso as StatusRecurso,
          valorRecurso: editando.valorRecurso != null ? String(editando.valorRecurso) : '',
          custoDevolucao: editando.custoDevolucao != null ? String(editando.custoDevolucao) : '',
          erroExpedicao: editando.erroExpedicao,
          observacoes: editando.observacoes ?? '',
        }
      : FORM_VAZIO
  )

  function invalidar() {
    utils.devolucaoEcommerce.listar.invalidate()
    utils.devolucaoEcommerce.relatorio.invalidate()
    utils.financeiro.painelResumo.invalidate()
  }
  const criarMut = trpc.devolucaoEcommerce.criar.useMutation({
    onSuccess: () => { toast.success('Devolução registrada'); invalidar(); onClose() },
    onError: (e) => toast.error(e.message),
  })
  const atualizarMut = trpc.devolucaoEcommerce.atualizar.useMutation({
    onSuccess: () => { toast.success('Devolução atualizada'); invalidar(); onClose() },
    onError: (e) => toast.error(e.message),
  })

  function salvar() {
    if (!form.loja.trim()) return toast.error('Informe a loja/conta')
    if (!form.pedido.trim()) return toast.error('Informe o pedido')
    if (!form.motivo.trim()) return toast.error('Informe o motivo')
    const payload = {
      data: form.data,
      marketplace: form.marketplace,
      loja: form.loja.trim(),
      pedido: form.pedido.trim(),
      nfEntrada: form.nfEntrada || undefined,
      nfDevolucao: form.nfDevolucao || undefined,
      valorVenda: Number(form.valorVenda) || 0,
      motivo: form.motivo.trim(),
      statusRecurso: form.statusRecurso,
      valorRecurso: form.valorRecurso ? Number(form.valorRecurso) : undefined,
      custoDevolucao: form.custoDevolucao ? Number(form.custoDevolucao) : undefined,
      erroExpedicao: form.erroExpedicao,
      observacoes: form.observacoes || undefined,
    }
    if (editando) atualizarMut.mutate({ id: editando.id, ...payload })
    else criarMut.mutate(payload)
  }

  const temRecurso = form.statusRecurso !== 'sem_recurso'
  const salvando = criarMut.isPending || atualizarMut.isPending

  return (
    <Modal open onClose={onClose} title={editando ? `Editar devolução #${editando.id}` : 'Nova devolução'} size="md">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          <Select
            label="Marketplace"
            value={form.marketplace}
            onChange={(e) => setForm({ ...form, marketplace: e.target.value as Marketplace })}
            options={MARKETPLACE_VALUES.map((v) => ({ value: v, label: MARKETPLACE_LABELS[v] }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Loja/conta" value={form.loja} onChange={(e) => setForm({ ...form, loja: e.target.value })} placeholder="Ex: Hidroplac" />
          <Input label="Pedido" value={form.pedido} onChange={(e) => setForm({ ...form, pedido: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="NF de entrada" value={form.nfEntrada} onChange={(e) => setForm({ ...form, nfEntrada: e.target.value })} />
          <Input label="NF de devolução" value={form.nfDevolucao} onChange={(e) => setForm({ ...form, nfDevolucao: e.target.value })} />
        </div>
        <Input label="Valor de venda (R$)" type="number" step="0.01" min="0" value={form.valorVenda} onChange={(e) => setForm({ ...form, valorVenda: e.target.value })} />
        <Textarea label="Motivo" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />

        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" checked={form.erroExpedicao} onChange={(e) => setForm({ ...form, erroExpedicao: e.target.checked })} /> Foi erro de expedição
        </label>

        <Select
          label="Recurso"
          value={form.statusRecurso}
          onChange={(e) => setForm({ ...form, statusRecurso: e.target.value as StatusRecurso })}
          options={STATUS_RECURSO_VALUES.map((v) => ({ value: v, label: STATUS_RECURSO_LABELS[v] }))}
        />
        {temRecurso && (
          <Input label="Valor de recurso (R$)" type="number" step="0.01" min="0" value={form.valorRecurso} onChange={(e) => setForm({ ...form, valorRecurso: e.target.value })} />
        )}
        <Input label="Custo da devolução (R$)" type="number" step="0.01" min="0" value={form.custoDevolucao} onChange={(e) => setForm({ ...form, custoDevolucao: e.target.value })} />
        <Textarea label="Observações (opcional)" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />

        <Button className="w-full" loading={salvando} onClick={salvar}>
          {editando ? 'Salvar alterações' : 'Registrar devolução'}
        </Button>
      </div>
    </Modal>
  )
}

export default function DevolucaoEcommerce() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [dataInicio, setDataInicio] = usePersistedState('devolucaoEcommerce:dataInicio', primeiroDiaMesString())
  const [dataFim, setDataFim] = usePersistedState('devolucaoEcommerce:dataFim', hojeBrString())
  const [marketplace, setMarketplace] = usePersistedState<Marketplace | ''>('devolucaoEcommerce:marketplace', '')
  const [statusRecurso, setStatusRecurso] = usePersistedState<StatusRecurso | ''>('devolucaoEcommerce:statusRecurso', '')
  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto] = useState<'novo' | Devolucao | null>(null)

  const utils = trpc.useUtils()
  const { data: lista, isLoading } = trpc.devolucaoEcommerce.listar.useQuery({
    dataInicio,
    dataFim,
    marketplace: marketplace || undefined,
    statusRecurso: statusRecurso || undefined,
    busca: busca || undefined,
  })
  const { data: relatorio } = trpc.devolucaoEcommerce.relatorio.useQuery({ dataInicio, dataFim })

  const excluirMut = trpc.devolucaoEcommerce.excluir.useMutation({
    onSuccess() {
      toast.success('Devolução excluída')
      utils.devolucaoEcommerce.listar.invalidate()
      utils.devolucaoEcommerce.relatorio.invalidate()
      utils.financeiro.painelResumo.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  function exportarCsv() {
    if (!lista) return
    baixarCsv(
      `devolucoes_ecommerce_${dataInicio}_a_${dataFim}.csv`,
      paraCsv(
        [
          { chave: 'data', rotulo: 'Data' },
          { chave: 'marketplace', rotulo: 'Marketplace' },
          { chave: 'loja', rotulo: 'Loja' },
          { chave: 'pedido', rotulo: 'Pedido' },
          { chave: 'nfEntrada', rotulo: 'NF Entrada' },
          { chave: 'nfDevolucao', rotulo: 'NF Devolução' },
          { chave: 'valorVenda', rotulo: 'Valor de Venda' },
          { chave: 'motivo', rotulo: 'Motivo' },
          { chave: 'statusRecurso', rotulo: 'Recurso' },
          { chave: 'valorRecurso', rotulo: 'Valor de Recurso' },
          { chave: 'custoDevolucao', rotulo: 'Custo da Devolução' },
          { chave: 'erroExpedicao', rotulo: 'Erro de Expedição' },
        ],
        lista.map((d) => ({
          ...d,
          marketplace: MARKETPLACE_LABELS[d.marketplace as Marketplace] ?? d.marketplace,
          statusRecurso: STATUS_RECURSO_LABELS[d.statusRecurso as StatusRecurso] ?? d.statusRecurso,
          erroExpedicao: d.erroExpedicao ? 'SIM' : '',
        }))
      )
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="font-heading text-xl text-dark-50 font-bold">Devolução E-commerce</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportarCsv}>
            <Download size={14} className="mr-1" /> Exportar CSV
          </Button>
          <Button size="sm" onClick={() => setModalAberto('novo')}>
            <Plus size={14} className="mr-1" /> Nova devolução
          </Button>
        </div>
      </div>

      {relatorio && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-3">
            <p className="text-xl font-bold font-mono text-dark-100">{relatorio.total}</p>
            <p className="text-[10px] text-dark-500 uppercase">Total</p>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-3">
            <p className="text-xl font-bold font-mono text-red-400">{relatorio.comRecurso}</p>
            <p className="text-[10px] text-dark-500 uppercase">Com recurso</p>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-3">
            <p className="text-xl font-bold font-mono text-dark-300">{relatorio.semRecurso}</p>
            <p className="text-[10px] text-dark-500 uppercase">Sem recurso</p>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-3">
            <p className="text-xl font-bold font-mono text-dark-100">{formatarMoeda(relatorio.valorVendasTotal)}</p>
            <p className="text-[10px] text-dark-500 uppercase">Valor em vendas</p>
          </div>
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-3">
            <p className="text-xl font-bold font-mono text-green-400">{formatarMoeda(relatorio.valorRecursoTotal)}</p>
            <p className="text-[10px] text-dark-500 uppercase">Recuperado via recurso</p>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 flex-wrap mb-4">
        <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-auto" />
        <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-auto" />
        <Select
          label="Marketplace"
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value as Marketplace | '')}
          placeholder="Todos"
          options={MARKETPLACE_VALUES.map((v) => ({ value: v, label: MARKETPLACE_LABELS[v] }))}
          className="w-auto"
        />
        <Select
          label="Recurso"
          value={statusRecurso}
          onChange={(e) => setStatusRecurso(e.target.value as StatusRecurso | '')}
          placeholder="Todos"
          options={STATUS_RECURSO_VALUES.map((v) => ({ value: v, label: STATUS_RECURSO_LABELS[v] }))}
          className="w-auto"
        />
        <Input label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pedido, loja ou motivo..." className="w-56" />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-left text-[11px] text-dark-500 uppercase tracking-wide">
              <th className="px-3 py-2.5">Data</th>
              <th className="px-3 py-2.5">Plataforma</th>
              <th className="px-3 py-2.5">Pedido</th>
              <th className="px-3 py-2.5">Valor venda</th>
              <th className="px-3 py-2.5">Motivo</th>
              <th className="px-3 py-2.5">Recurso</th>
              <th className="px-3 py-2.5">Custo devol.</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {(lista ?? []).map((d) => (
              <tr key={d.id} className="hover:bg-dark-700/30">
                <td className="px-3 py-2.5 whitespace-nowrap text-dark-300">{formatarData(d.data)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-dark-200">
                  {MARKETPLACE_LABELS[d.marketplace as Marketplace] ?? d.marketplace} <span className="text-dark-500">· {d.loja}</span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-dark-300 font-mono text-xs">{d.pedido}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-dark-200 font-mono">{formatarMoeda(d.valorVenda)}</td>
                <td className="px-3 py-2.5 text-dark-300 max-w-xs truncate" title={d.motivo}>
                  {d.motivo}
                  {d.erroExpedicao && <span className="ml-1.5 text-[10px] text-amber-400 font-semibold">ERRO EXPED.</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Badge className={STATUS_RECURSO_CORES[d.statusRecurso as StatusRecurso]}>{STATUS_RECURSO_LABELS[d.statusRecurso as StatusRecurso] ?? d.statusRecurso}</Badge>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-dark-400 font-mono">{d.custoDevolucao ? formatarMoeda(d.custoDevolucao) : '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-right">
                  <button onClick={() => setModalAberto(d)} className="text-dark-400 hover:text-gold-400 p-1" title="Editar">
                    <Pencil size={14} />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => { if (confirm(`Excluir devolução #${d.id}?`)) excluirMut.mutate({ id: d.id }) }}
                      className="text-dark-400 hover:text-red-400 p-1"
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <p className="text-dark-500 text-sm p-4">Carregando...</p>}
        {!isLoading && (!lista || lista.length === 0) && <p className="text-dark-500 text-sm p-4">Nenhuma devolução no período.</p>}
      </div>

      {modalAberto && <DevolucaoModal editando={modalAberto === 'novo' ? null : modalAberto} onClose={() => setModalAberto(null)} />}
    </div>
  )
}
