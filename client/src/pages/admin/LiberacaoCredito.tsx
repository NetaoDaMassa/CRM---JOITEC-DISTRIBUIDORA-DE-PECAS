import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Paperclip, Trash2, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'

type ClienteResultado = {
  id: number
  razaoSocial: string
  codigo: string
  empresaId: number
  empresaNome: string
  vendedorId: number | null
  vendedorNome: string | null
}

// Cliente é sempre um já cadastrado no sistema (cross-empresa) — nunca
// texto livre, pra não virar um cadastro paralelo desencontrado do real.
function SeletorCliente({
  clienteSelecionado,
  onSelecionar,
}: {
  clienteSelecionado: ClienteResultado | null
  onSelecionar: (c: ClienteResultado | null) => void
}) {
  const [busca, setBusca] = useState('')
  const { data: resultados } = trpc.liberacaoCredito.clientesBuscar.useQuery({ q: busca }, { enabled: busca.trim().length >= 2 })

  if (clienteSelecionado) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dark-600 px-3 py-2">
        <div>
          <p className="text-sm text-dark-100">{clienteSelecionado.razaoSocial}</p>
          <p className="text-xs text-dark-500">
            Cód. {clienteSelecionado.codigo} · {clienteSelecionado.empresaNome} · vendedor: {clienteSelecionado.vendedorNome ?? 'sem vendedor'}
          </p>
        </div>
        <button onClick={() => onSelecionar(null)} className="text-xs text-dark-400 hover:text-dark-100">
          Trocar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Input
        icon={<Search size={14} />}
        placeholder="Buscar cliente por razão social, código ou CNPJ (qualquer empresa)..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      {busca.trim().length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-dark-600 divide-y divide-dark-700">
          {resultados?.length === 0 && <p className="px-3 py-2 text-sm text-dark-500">Nenhum cliente encontrado.</p>}
          {resultados?.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelecionar(c)
                setBusca('')
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-dark-700/50 transition-colors"
            >
              <p className="text-dark-100">{c.razaoSocial}</p>
              <p className="text-xs text-dark-500">
                Cód. {c.codigo} · {c.empresaNome} · vendedor: {c.vendedorNome ?? 'sem vendedor'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NovaLiberacaoModal({ open, onClose, quemLiberouOpcoes }: { open: boolean; onClose: () => void; quemLiberouOpcoes: string[] }) {
  const utils = trpc.useUtils()
  const [cliente, setCliente] = useState<ClienteResultado | null>(null)
  const [quemLiberou, setQuemLiberou] = useState('')
  const [motivo, setMotivo] = useState('')
  const [arquivo, setArquivo] = useState<{ urlArquivo: string; nomeArquivo: string; tipoArquivo?: string } | null>(null)
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)

  const criarMut = trpc.liberacaoCredito.criar.useMutation({
    onSuccess() {
      toast.success('Liberação registrada')
      utils.liberacaoCredito.listar.invalidate()
      utils.liberacaoCredito.relatorio.invalidate()
      utils.liberacaoCredito.quemLiberouOpcoes.invalidate()
      fechar()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function fechar() {
    setCliente(null)
    setQuemLiberou('')
    setMotivo('')
    setArquivo(null)
    onClose()
  }

  async function selecionarArquivo(file: File) {
    setEnviandoArquivo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const token = localStorage.getItem('odin_token')
      const res = await fetch('/upload/liberacao-credito-anexo', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Falha no upload')
      setArquivo({ urlArquivo: data.path, nomeArquivo: data.nome, tipoArquivo: data.tipo })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o anexo')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  function salvar() {
    if (!cliente) return toast.error('Selecione o cliente.')
    if (!quemLiberou.trim()) return toast.error('Informe quem liberou.')
    if (!motivo.trim()) return toast.error('Informe o motivo.')
    criarMut.mutate({
      clienteId: cliente.id,
      quemLiberou: quemLiberou.trim(),
      motivo: motivo.trim(),
      urlArquivo: arquivo?.urlArquivo,
      nomeArquivo: arquivo?.nomeArquivo,
      tipoArquivo: arquivo?.tipoArquivo,
    })
  }

  return (
    <Modal open={open} onClose={fechar} title="Nova liberação de crédito" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-sm text-dark-200 font-medium mb-1 block">Cliente</label>
          <SeletorCliente clienteSelecionado={cliente} onSelecionar={setCliente} />
        </div>

        <div>
          <Input
            label="Quem liberou"
            list="quem-liberou-opcoes"
            placeholder="Ex: Guilherme, Financeiro..."
            value={quemLiberou}
            onChange={(e) => setQuemLiberou(e.target.value)}
          />
          <datalist id="quem-liberou-opcoes">
            {quemLiberouOpcoes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <Textarea label="Motivo" placeholder="Como/por que foi liberado..." rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />

        <div>
          <label className="text-sm text-dark-200 font-medium mb-1 block">Anexo (opcional)</label>
          {arquivo ? (
            <div className="flex items-center justify-between rounded-lg border border-dark-600 px-3 py-2 text-sm">
              <span className="text-dark-200 truncate flex items-center gap-1.5">
                <Paperclip size={13} /> {arquivo.nomeArquivo}
              </span>
              <button onClick={() => setArquivo(null)} className="text-dark-400 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={enviandoArquivo}
              onChange={(e) => e.target.files?.[0] && selecionarArquivo(e.target.files[0])}
              className="text-sm text-dark-300"
            />
          )}
        </div>

        <Button className="w-full" loading={criarMut.isPending || enviandoArquivo} onClick={salvar}>
          Registrar liberação
        </Button>
      </div>
    </Modal>
  )
}

function FiltroTexto({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="w-48">
      <label className="text-xs text-dark-400 mb-1 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-2"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function AbaLancamentos() {
  const [criarOpen, setCriarOpen] = useState(false)
  const [q, setQ] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [mesReferencia, setMesReferencia] = useState('')
  const [quemLiberouFiltro, setQuemLiberouFiltro] = useState('')
  const utils = trpc.useUtils()

  const { data: opcoes } = trpc.liberacaoCredito.quemLiberouOpcoes.useQuery()
  const { data: linhas, isLoading } = trpc.liberacaoCredito.listar.useQuery({
    q: q || undefined,
    dataDe: dataDe || undefined,
    dataAte: dataAte || undefined,
    mesReferencia: mesReferencia ? `${mesReferencia}` : undefined,
    quemLiberou: quemLiberouFiltro || undefined,
  })

  const excluirMut = trpc.liberacaoCredito.excluir.useMutation({
    onSuccess() {
      toast.success('Liberação excluída')
      utils.liberacaoCredito.listar.invalidate()
      utils.liberacaoCredito.relatorio.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-dark-400">{linhas?.length ?? 0} liberação(ões)</p>
        <Button size="sm" onClick={() => setCriarOpen(true)}>
          <Plus size={14} /> Nova liberação
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="w-64">
          <Input icon={<Search size={14} />} label="Buscar" placeholder="Cliente ou código..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        <div>
          <label className="text-xs text-dark-400 mb-1 block">Mês</label>
          <input
            type="month"
            value={mesReferencia}
            onChange={(e) => setMesReferencia(e.target.value)}
            className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-2"
          />
        </div>
        <FiltroTexto label="Quem liberou" value={quemLiberouFiltro} onChange={setQuemLiberouFiltro} options={opcoes ?? []} />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && linhas?.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhuma liberação encontrada.</div>}
        {linhas?.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-dark-100">
                {l.clienteNome} <span className="text-dark-500 font-normal">(Cód. {l.clienteCodigo} · {l.empresaNome})</span>
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                Liberado por <span className="text-dark-200">{l.quemLiberou}</span> · vendedor: {l.vendedorNome ?? 'sem vendedor'} · lançado por{' '}
                {l.criadoPorNome} em {formatDateTime(l.createdAt)}
              </p>
              <p className="text-xs text-dark-300 mt-1.5 bg-dark-900/60 rounded-lg px-2.5 py-1.5">{l.motivo}</p>
              {l.urlArquivo && (
                <a
                  href={l.urlArquivo}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 mt-1.5"
                >
                  <Paperclip size={11} /> {l.nomeArquivo}
                </a>
              )}
            </div>
            <button
              onClick={() => confirm('Excluir essa liberação?') && excluirMut.mutate({ id: l.id })}
              className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-900/20 shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <NovaLiberacaoModal open={criarOpen} onClose={() => setCriarOpen(false)} quemLiberouOpcoes={opcoes ?? []} />
    </div>
  )
}

function AbaRelatorio() {
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const { data } = trpc.liberacaoCredito.relatorio.useQuery({ dataDe: dataDe || undefined, dataAte: dataAte || undefined })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <Input label="De" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        <Input label="Até" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <p className="text-sm text-dark-400">Total no período</p>
        <p className="text-3xl font-bold text-dark-50">{data?.quantidadeGeral ?? 0}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-2">Por cliente</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {data?.porCliente.map((r) => (
              <div key={r.clienteId} className="flex items-center justify-between text-xs">
                <span className="text-dark-300 truncate">
                  {r.clienteNome} <span className="text-dark-500">({r.empresaNome})</span>
                </span>
                <span className="text-dark-100 font-medium shrink-0 ml-2">{r.qtd}</span>
              </div>
            ))}
            {!data?.porCliente.length && <p className="text-xs text-dark-500">Nada no período.</p>}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-2">Por vendedor</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {data?.porVendedor.map((r) => (
              <div key={r.vendedorId ?? 'sem-vendedor'} className="flex items-center justify-between text-xs">
                <span className="text-dark-300 truncate">{r.vendedorNome}</span>
                <span className="text-dark-100 font-medium shrink-0 ml-2">{r.qtd}</span>
              </div>
            ))}
            {!data?.porVendedor.length && <p className="text-xs text-dark-500">Nada no período.</p>}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-2">Por quem liberou</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {data?.porQuemLiberou.map((r) => (
              <div key={r.quemLiberou} className="flex items-center justify-between text-xs">
                <span className="text-dark-300 truncate">{r.quemLiberou}</span>
                <span className="text-dark-100 font-medium shrink-0 ml-2">{r.qtd}</span>
              </div>
            ))}
            {!data?.porQuemLiberou.length && <p className="text-xs text-dark-500">Nada no período.</p>}
          </div>
        </div>

        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
          <p className="text-sm font-semibold text-dark-100 mb-2">Por dia</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {data?.porDia.map((r) => (
              <div key={r.dia} className="flex items-center justify-between text-xs">
                <span className="text-dark-300">{r.dia.split('-').reverse().join('/')}</span>
                <span className="text-dark-100 font-medium shrink-0 ml-2">{r.qtd}</span>
              </div>
            ))}
            {!data?.porDia.length && <p className="text-xs text-dark-500">Nada no período.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LiberacaoCredito() {
  const [tab, setTab] = useState<'lancamentos' | 'relatorio'>('lancamentos')

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Liberação de Crédito</h1>
        <p className="text-sm text-dark-400 mt-1">Registro de liberações feitas pelo Financeiro — vale pras empresas do grupo todas juntas.</p>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {(['lancamentos', 'relatorio'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {t === 'lancamentos' ? 'Lançamentos' : 'Relatório'}
          </button>
        ))}
      </div>

      {tab === 'lancamentos' ? <AbaLancamentos /> : <AbaRelatorio />}
    </div>
  )
}
