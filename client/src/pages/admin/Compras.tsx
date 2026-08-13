import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'

const EMPRESA_LABEL: Record<string, string> = {
  'odin-tubos': 'Odin Tubos',
  'odin-compressores': 'Odin Compressores',
  joitec: 'Joitec',
}

const STATUS_LABEL: Record<string, string> = {
  em_producao: 'Em produção',
  embarcado: 'Embarcado',
  a_caminho: 'A caminho',
  chegou: 'Chegou',
}

const STATUS_COR: Record<string, string> = {
  em_producao: 'text-dark-300 bg-dark-700',
  embarcado: 'text-gold-400 bg-gold-900/20',
  a_caminho: 'text-blue-400 bg-blue-900/20',
  chegou: 'text-green-400 bg-green-900/20',
}

type Invoice = {
  id: number
  empresa: 'odin-tubos' | 'odin-compressores' | 'joitec'
  numeroInvoice: string
  fornecedor: string | null
  status: 'em_producao' | 'embarcado' | 'a_caminho' | 'chegou'
  dataEmbarque: string | null
  dataChegada: string | null
  invoicePaga: boolean
  valorDolar: number | null
  valorInvoiceReais: number | null
  numeroContainer: string | null
  navio: string | null
  portoOrigem: string | null
  portoDestino: string | null
  observacoes: string | null
}

function formatarData(d: string | null): string {
  if (!d) return '—'
  return new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR')
}

function formatarDolar(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatarReais(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

type FormInvoice = {
  empresa: Invoice['empresa']
  numeroInvoice: string
  fornecedor: string
  status: Invoice['status']
  dataEmbarque: string
  dataChegada: string
  invoicePaga: boolean
  valorDolar: string
  valorInvoiceReais: string
  numeroContainer: string
  navio: string
  portoOrigem: string
  portoDestino: string
  observacoes: string
}

const FORM_VAZIO: FormInvoice = {
  empresa: 'odin-tubos',
  numeroInvoice: '',
  fornecedor: '',
  status: 'em_producao',
  dataEmbarque: '',
  dataChegada: '',
  invoicePaga: false,
  valorDolar: '',
  valorInvoiceReais: '',
  numeroContainer: '',
  navio: '',
  portoOrigem: '',
  portoDestino: '',
  observacoes: '',
}

function InvoiceForm({ inicial, onSalvar, salvando }: { inicial: Invoice | null; onSalvar: (dados: FormInvoice) => void; salvando: boolean }) {
  const [form, setForm] = useState<FormInvoice>(() =>
    inicial
      ? {
          empresa: inicial.empresa,
          numeroInvoice: inicial.numeroInvoice,
          fornecedor: inicial.fornecedor ?? '',
          status: inicial.status,
          dataEmbarque: inicial.dataEmbarque ?? '',
          dataChegada: inicial.dataChegada ?? '',
          invoicePaga: inicial.invoicePaga,
          valorDolar: inicial.valorDolar !== null ? String(inicial.valorDolar) : '',
          valorInvoiceReais: inicial.valorInvoiceReais !== null ? String(inicial.valorInvoiceReais) : '',
          numeroContainer: inicial.numeroContainer ?? '',
          navio: inicial.navio ?? '',
          portoOrigem: inicial.portoOrigem ?? '',
          portoDestino: inicial.portoDestino ?? '',
          observacoes: inicial.observacoes ?? '',
        }
      : FORM_VAZIO
  )

  function set<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Empresa"
          value={form.empresa}
          onChange={(e) => set('empresa', e.target.value as typeof form.empresa)}
          options={Object.entries(EMPRESA_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Input label="Nº Invoice" value={form.numeroInvoice} onChange={(e) => set('numeroInvoice', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Fornecedor" value={form.fornecedor} onChange={(e) => set('fornecedor', e.target.value)} />
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => set('status', e.target.value as typeof form.status)}
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Data de embarque" type="date" value={form.dataEmbarque} onChange={(e) => set('dataEmbarque', e.target.value)} />
        <Input label="Data de chegada" type="date" value={form.dataChegada} onChange={(e) => set('dataChegada', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Nº do container" value={form.numeroContainer} onChange={(e) => set('numeroContainer', e.target.value)} />
        <Input label="Navio" value={form.navio} onChange={(e) => set('navio', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Porto de origem" value={form.portoOrigem} onChange={(e) => set('portoOrigem', e.target.value)} />
        <Input label="Porto de destino" value={form.portoDestino} onChange={(e) => set('portoDestino', e.target.value)} />
      </div>
      <Input label="Valor da invoice (R$)" type="number" min="0" step="0.01" value={form.valorInvoiceReais} onChange={(e) => set('valorInvoiceReais', e.target.value)} />

      <div className="bg-dark-900/50 border border-dark-700 rounded-xl p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-dark-200">
          <input type="checkbox" checked={form.invoicePaga} onChange={(e) => set('invoicePaga', e.target.checked)} className="accent-gold-500" />
          Invoice paga
        </label>
        {form.invoicePaga && (
          <Input label="Valor do dólar (US$)" type="number" min="0" step="0.0001" value={form.valorDolar} onChange={(e) => set('valorDolar', e.target.value)} />
        )}
        {!form.invoicePaga && <p className="text-xs text-dark-500">O valor do dólar só aparece no painel depois que a invoice for paga.</p>}
      </div>

      <Input label="Observações" value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />

      <Button
        className="w-full"
        loading={salvando}
        onClick={() => {
          if (!form.numeroInvoice.trim()) return toast.error('Informe o número da invoice')
          onSalvar(form)
        }}
      >
        Salvar
      </Button>
    </div>
  )
}

// Setor Compras — controle de invoices de importação (container) das 3
// empresas que importam. Sem escopo de empresa ativa de propósito: é um
// setor único do grupo, compartilhado entre admins de qualquer empresa
// (ver comentário no schema). Alimenta a 2ª página do Painel Financeiro.
export default function Compras() {
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Invoice | null>(null)

  const utils = trpc.useUtils()
  const { data: invoices, isLoading } = trpc.compras.listar.useQuery({
    empresa: (filtroEmpresa || undefined) as Invoice['empresa'] | undefined,
    status: (filtroStatus || undefined) as Invoice['status'] | undefined,
  })

  function invalidar() {
    utils.compras.listar.invalidate()
  }

  const criarMut = trpc.compras.criar.useMutation({
    onSuccess() {
      toast.success('Invoice cadastrada')
      setModalAberto(false)
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const atualizarMut = trpc.compras.atualizar.useMutation({
    onSuccess() {
      toast.success('Invoice atualizada')
      setModalAberto(false)
      setEditando(null)
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const removerMut = trpc.compras.remover.useMutation({
    onSuccess() {
      toast.success('Invoice removida')
      invalidar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function salvar(form: FormInvoice) {
    const dados = {
      ...form,
      valorDolar: form.valorDolar ? Number(form.valorDolar) : undefined,
      valorInvoiceReais: form.valorInvoiceReais ? Number(form.valorInvoiceReais) : undefined,
    }
    if (editando) atualizarMut.mutate({ id: editando.id, ...dados })
    else criarMut.mutate(dados)
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Compras — Importações</h1>
          <p className="text-sm text-dark-400">Controle de invoices e containers das empresas que importam.</p>
        </div>
        <Button
          onClick={() => {
            setEditando(null)
            setModalAberto(true)
          }}
        >
          Nova invoice
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="w-52">
          <Select
            value={filtroEmpresa}
            onChange={(e) => setFiltroEmpresa(e.target.value)}
            placeholder="Todas as empresas"
            options={Object.entries(EMPRESA_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <div className="w-48">
          <Select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            placeholder="Todos os status"
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <p className="p-4 text-dark-400 text-sm">Carregando...</p>}
        {!isLoading && !invoices?.length && <p className="p-4 text-dark-400 text-sm">Nenhuma invoice cadastrada.</p>}
        {invoices?.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex items-center gap-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COR[inv.status]}`}>
                {STATUS_LABEL[inv.status]}
              </span>
              <div className="min-w-0">
                <p className="text-dark-100 font-medium">
                  {inv.numeroInvoice} <span className="text-dark-500 font-normal">· {EMPRESA_LABEL[inv.empresa]}</span>
                </p>
                <p className="text-dark-500 text-xs">
                  Embarque {formatarData(inv.dataEmbarque)} · Chegada {formatarData(inv.dataChegada)}
                  {inv.numeroContainer ? ` · Container ${inv.numeroContainer}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <p className="text-dark-100 font-mono tabular-nums">{inv.invoicePaga ? formatarDolar(inv.valorDolar) : '—'}</p>
                <p className="text-[10px] text-dark-500">{inv.invoicePaga ? 'paga' : 'não paga'}</p>
              </div>
              <button
                onClick={() => {
                  setEditando(inv as Invoice)
                  setModalAberto(true)
                }}
                className="text-xs text-gold-400 hover:underline"
              >
                Editar
              </button>
              <button
                onClick={() => removerMut.mutate({ id: inv.id })}
                className="text-xs text-dark-500 hover:text-red-400"
                disabled={removerMut.isPending}
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={modalAberto}
        onClose={() => {
          setModalAberto(false)
          setEditando(null)
        }}
        title={editando ? `Editar invoice ${editando.numeroInvoice}` : 'Nova invoice'}
      >
        <InvoiceForm inicial={editando} onSalvar={salvar} salvando={criarMut.isPending || atualizarMut.isPending} />
      </Modal>
    </div>
  )
}
