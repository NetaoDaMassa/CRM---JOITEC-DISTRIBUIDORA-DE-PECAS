import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Paperclip, Trash2, Search, UserPlus, Pencil } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { usePersistedState } from '../../lib/usePersistedState'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda as formatarMoedaBr } from '../../lib/moeda'
import CadastroRapidoClienteModal from '../../components/CadastroRapidoClienteModal'
import { QUEM_LIBERA } from './SolicitacaoCredito'
import { parseValorBr } from '../../lib/valorBr'
import Select from '../../components/ui/Select'
import { CartaoTotal, TabelaRelatorio, type Coluna, moeda, pct, numCsv, mesBr, limitesDoMes, dataBr } from './creditoRelatorioUi'

const STATUS_LABEL: Record<string, string> = { liberado: 'Liberado', negado: 'Negado' }
const STATUS_COR: Record<string, string> = {
  liberado: 'text-green-400 bg-green-900/20 border-green-700/40',
  negado: 'text-red-400 bg-red-900/20 border-red-700/40',
}

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
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false)
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
          <button
            type="button"
            onClick={() => setCadastroRapidoAberto(true)}
            className="w-full text-left px-3 py-2 text-sm text-gold-400 hover:bg-dark-700/50 transition-colors flex items-center gap-1.5"
          >
            <UserPlus size={13} /> Não achou? Cadastrar cliente novo
          </button>
        </div>
      )}
      <CadastroRapidoClienteModal
        open={cadastroRapidoAberto}
        onClose={() => setCadastroRapidoAberto(false)}
        onCriado={(cliente) => {
          onSelecionar(cliente)
          setCadastroRapidoAberto(false)
          setBusca('')
        }}
      />
    </div>
  )
}

type RegistroEditavel = { id: number; clienteNome: string; quemLiberou: string; motivo: string; valorLiberado: number | null; celular: string | null }

function NovaLiberacaoModal({ open, onClose, editando }: { open: boolean; onClose: () => void; editando?: RegistroEditavel | null }) {
  const utils = trpc.useUtils()
  const [cliente, setCliente] = useState<ClienteResultado | null>(null)
  const [quemLiberou, setQuemLiberou] = useState('')
  const [motivo, setMotivo] = useState('')
  const [valor, setValor] = useState('')
  const [celular, setCelular] = useState('')
  useEffect(() => {
    if (!open) return
    setQuemLiberou(editando?.quemLiberou ?? '')
    setMotivo(editando?.motivo ?? '')
    setValor(editando?.valorLiberado != null ? String(editando.valorLiberado).replace('.', ',') : '')
    setCelular(editando?.celular ?? '')
  }, [open, editando])
  const editarMut = trpc.liberacaoCredito.editar.useMutation({
    onSuccess() {
      toast.success('Registro atualizado')
      utils.liberacaoCredito.listar.invalidate()
      utils.liberacaoCredito.relatorio.invalidate()
      fechar()
    },
    onError: (err) => toast.error(err.message),
  })
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
    setValor('')
    setCelular('')
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
    if (!editando && !cliente) return toast.error('Selecione o cliente.')
    const quem = QUEM_LIBERA.find((q) => q === quemLiberou)
    if (!quem) return toast.error('Escolha quem liberou.')
    const valorNum = parseValorBr(valor)
    if (!valorNum) return toast.error('Informe o valor liberado a mais.')
    if (!motivo.trim()) return toast.error('Informe o motivo.')
    if (editando) return editarMut.mutate({ id: editando.id, quemLiberou: quem, motivo: motivo.trim(), valorLiberado: valorNum, celular: celular.trim() })
    if (!cliente) return
    criarMut.mutate({
      clienteId: cliente.id,
      quemLiberou: quem,
      valorLiberado: valorNum,
      celular: celular.trim(),
      motivo: motivo.trim(),
      urlArquivo: arquivo?.urlArquivo,
      nomeArquivo: arquivo?.nomeArquivo,
      tipoArquivo: arquivo?.tipoArquivo,
    })
  }

  return (
    <Modal open={open} onClose={fechar} title={editando ? 'Editar registro de liberação' : 'Novo registro de liberação'} size="md">
      <div className="space-y-4">
        {editando ? (
          <p className="text-sm text-dark-100 font-medium">{editando.clienteNome}</p>
        ) : (
          <div>
            <label className="text-sm text-dark-200 font-medium mb-1 block">Cliente</label>
            <SeletorCliente clienteSelecionado={cliente} onSelecionar={setCliente} />
          </div>
        )}

        <div>
          <label className="text-sm text-dark-200 font-medium mb-1 block">Quem liberou *</label>
          <select value={quemLiberou} onChange={(e) => setQuemLiberou(e.target.value)} className="w-full bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-2">
            <option value="">Escolha…</option>
            {QUEM_LIBERA.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor liberado a mais *" placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          <Input label="Celular (opcional)" placeholder="(47) 99999-9999" value={celular} onChange={(e) => setCelular(e.target.value)} />
        </div>

        <Textarea label="Motivo" placeholder="Como/por que foi liberado..." rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />

        {!editando && <div>
          <label className="text-sm text-dark-200 font-medium mb-1 block">Anexo (opcional)</label>
          {arquivo ? (
            <div className="flex items-center justify-between rounded-lg border border-dark-600 px-3 py-2 text-sm">
              <span className="text-dark-200 flex items-center gap-1.5 min-w-0">
                <Paperclip size={13} className="shrink-0" />
                <span className="truncate">{arquivo.nomeArquivo}</span>
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
        </div>}

        <Button className="w-full" loading={criarMut.isPending || editarMut.isPending || enviandoArquivo} onClick={salvar}>
          {editando ? 'Salvar alterações' : 'Registrar liberação'}
        </Button>
      </div>
    </Modal>
  )
}

type FiltrosLib = { q: string; dataDe: string; dataAte: string; mesReferencia: string; quemLiberou: string; vendedorId: string; empresaId: string }
const FILTROS_LIB_VAZIOS: FiltrosLib = { q: '', dataDe: '', dataAte: '', mesReferencia: '', quemLiberou: '', vendedorId: '', empresaId: '' }

function BarraFiltrosLib({ f, set, completo }: { f: FiltrosLib; set: (p: Partial<FiltrosLib>) => void; completo: boolean }) {
  const { data: opcoesQuem } = trpc.liberacaoCredito.quemLiberouOpcoes.useQuery()
  const { data: opcoes } = trpc.liberacaoCredito.filtrosOpcoes.useQuery()
  const algum = (Object.keys(FILTROS_LIB_VAZIOS) as (keyof FiltrosLib)[]).some((k) => f[k] !== '')
  return (
    <div className="flex flex-wrap items-end gap-3 bg-dark-800 border border-dark-600 rounded-2xl p-4">
      {completo && (
        <div className="w-64">
          <Input icon={<Search size={14} />} label="Buscar" placeholder="Cliente ou código..." value={f.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
      )}
      <Input label="De" type="date" value={f.dataDe} onChange={(e) => set({ dataDe: e.target.value })} />
      <Input label="Até" type="date" value={f.dataAte} onChange={(e) => set({ dataAte: e.target.value })} />
      {completo && (
        <div>
          <label className="text-sm text-dark-200 font-medium mb-1 block">Mês</label>
          <input
            type="month"
            value={f.mesReferencia}
            onChange={(e) => set({ mesReferencia: e.target.value })}
            className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-2"
          />
        </div>
      )}
      <div className="w-48">
        <Select label="Quem liberou" value={f.quemLiberou} onChange={(e) => set({ quemLiberou: e.target.value })} placeholder="Todos" options={(opcoesQuem ?? []).map((n) => ({ value: n, label: n }))} />
      </div>
      <div className="w-48">
        <Select label="Vendedor" value={f.vendedorId} onChange={(e) => set({ vendedorId: e.target.value })} placeholder="Todos" options={(opcoes?.vendedores ?? []).map((v) => ({ value: v.id, label: v.name }))} />
      </div>
      {(opcoes?.empresas.length ?? 0) > 1 && (
        <div className="w-48">
          <Select label="Empresa" value={f.empresaId} onChange={(e) => set({ empresaId: e.target.value })} placeholder="Todas" options={(opcoes?.empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))} />
        </div>
      )}
      {algum && (
        <button type="button" className="text-xs text-dark-400 hover:text-dark-100 underline pb-2.5" onClick={() => set(FILTROS_LIB_VAZIOS)}>
          Limpar filtros
        </button>
      )}
    </div>
  )
}

function AbaLancamentos({ f }: { f: FiltrosLib }) {
  const [criarOpen, setCriarOpen] = useState(false)
  const [editando, setEditando] = useState<RegistroEditavel | null>(null)
  const utils = trpc.useUtils()

  const { data: linhas, isLoading } = trpc.liberacaoCredito.listar.useQuery({
    q: f.q || undefined,
    dataDe: f.dataDe || undefined,
    dataAte: f.dataAte || undefined,
    mesReferencia: f.mesReferencia || undefined,
    quemLiberou: f.quemLiberou || undefined,
    vendedorId: f.vendedorId ? Number(f.vendedorId) : undefined,
    empresaId: f.empresaId ? Number(f.empresaId) : undefined,
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

  const soma = (linhas ?? []).filter((l) => l.status === 'liberado').reduce((t, l) => t + (l.valorLiberado ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-dark-400">
          {linhas?.length ?? 0} registro(s) · <span className="text-dark-200">{moeda(soma)}</span> liberado a mais
        </p>
        <Button size="sm" onClick={() => setCriarOpen(true)}>
          <Plus size={14} /> Nova liberação
        </Button>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700">
        {isLoading && <div className="p-4 text-sm text-dark-500">Carregando...</div>}
        {!isLoading && linhas?.length === 0 && <div className="p-4 text-sm text-dark-500">Nenhuma liberação encontrada.</div>}
        {linhas?.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-dark-100 flex items-center gap-2 flex-wrap">
                {l.clienteNome} <span className="text-dark-500 font-normal">(Cód. {l.clienteCodigo} · {l.empresaNome})</span>
                <Badge className={STATUS_COR[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                {l.origemSolicitacaoId && <span className="text-[10px] text-dark-500">via Solicitação de Crédito</span>}
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                {l.status === 'liberado' ? 'Liberado' : 'Negado'} por <span className="text-dark-200">{l.quemLiberou}</span> · vendedor:{' '}
                {l.vendedorNome ?? 'sem vendedor'} · lançado por {l.criadoPorNome} em {formatDateTime(l.createdAt)}
                {l.valorLiberado != null && <> · {formatarMoedaBr(l.valorLiberado)}</>}
                {l.celular && <> · 📱 {l.celular}</>}
                {l.editadoEm && <> · editado em {formatDateTime(l.editadoEm)}</>}
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
            <div className="flex shrink-0">
              <button onClick={() => setEditando(l)} className="p-1.5 rounded-lg text-dark-400 hover:text-gold-300 hover:bg-dark-700" aria-label="Editar">
                <Pencil size={14} />
              </button>
              <button
                onClick={() => confirm('Excluir essa liberação?') && excluirMut.mutate({ id: l.id })}
                className="p-1.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-900/20"
                aria-label="Excluir"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <NovaLiberacaoModal open={criarOpen || !!editando} editando={editando} onClose={() => (setCriarOpen(false), setEditando(null))} />
    </div>
  )
}

// Ranking de "quem está liberando fora do esquema" (João, 2026-11-16).
// Cartões de total em cima; tabelas por quem liberou, vendedor, cliente,
// mês e empresa. Clicar numa linha abre os Registros já filtrados.
function AbaRelatorio({ f, irParaRegistros }: { f: FiltrosLib; irParaRegistros: (p: Partial<FiltrosLib>) => void }) {
  const { data, isLoading } = trpc.liberacaoCredito.relatorio.useQuery({
    dataDe: f.dataDe || undefined,
    dataAte: f.dataAte || undefined,
    quemLiberou: f.quemLiberou || undefined,
    vendedorId: f.vendedorId ? Number(f.vendedorId) : undefined,
    empresaId: f.empresaId ? Number(f.empresaId) : undefined,
  })
  if (isLoading || !data) return <p className="text-sm text-dark-400">Carregando...</p>
  const t = data.totais
  const lider = data.porQuemLiberou[0]
  type G = { qtd: number; soma: number; maior: number; media: number; pctDoTotal: number; ultimo: string }
  const colsValores = <T extends G>(): Coluna<T>[] => [
    { titulo: 'Liberações', valor: (l) => <span className="font-semibold text-dark-100">{l.qtd}</span>, csv: (l) => l.qtd, alinhar: 'direita' },
    { titulo: 'Valor liberado a mais', valor: (l) => <span className="font-semibold text-gold-300">{moeda(l.soma)}</span>, csv: (l) => numCsv(l.soma), alinhar: 'direita' },
    { titulo: '% do total', valor: (l) => pct(l.pctDoTotal), csv: (l) => numCsv(l.pctDoTotal), alinhar: 'direita' },
    { titulo: 'Maior valor', valor: (l) => moeda(l.maior), csv: (l) => numCsv(l.maior), alinhar: 'direita' },
    { titulo: 'Média', valor: (l) => moeda(l.media), csv: (l) => numCsv(l.media), alinhar: 'direita' },
    { titulo: 'Última', valor: (l) => dataBr(l.ultimo), csv: (l) => dataBr(l.ultimo), alinhar: 'direita' },
  ]
  const dica = 'clique numa linha para ver os registros'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CartaoTotal titulo="Liberações fora do esquema" valor={t.qtd} detalhe={`${t.clientes} cliente(s)`} />
        <CartaoTotal titulo="Valor liberado a mais" valor={moeda(t.soma)} cor="text-gold-300" detalhe={`média ${moeda(t.media)} por liberação`} />
        <CartaoTotal titulo="Maior liberação" valor={moeda(t.maior)} />
        <CartaoTotal
          titulo="Quem mais liberou"
          valor={<span className="text-lg">{lider?.quemLiberou ?? '—'}</span>}
          detalhe={lider ? `${lider.qtd} liberação(ões) · ${moeda(lider.soma)} (${pct(lider.pctDoTotal)})` : undefined}
        />
      </div>

      <TabelaRelatorio
        titulo="Ranking — quem está liberando"
        subtitulo="ordenado pelo valor liberado a mais"
        dicaClique={dica}
        arquivo="liberacoes-por-quem-liberou"
        linhas={data.porQuemLiberou}
        chave={(l) => l.quemLiberou}
        onClicar={(l) => irParaRegistros({ quemLiberou: l.quemLiberou })}
        colunas={[
          { titulo: 'Quem liberou', valor: (l) => <span className="text-dark-100 font-medium">{l.quemLiberou}</span>, csv: (l) => l.quemLiberou },
          ...colsValores<(typeof data.porQuemLiberou)[number]>(),
        ]}
      />

      <TabelaRelatorio
        titulo="Por vendedor beneficiado"
        subtitulo="vendedor do cliente na hora da liberação"
        dicaClique={dica}
        arquivo="liberacoes-por-vendedor"
        linhas={data.porVendedor}
        chave={(l) => l.vendedorId ?? 0}
        onClicar={(l) => l.vendedorId && irParaRegistros({ vendedorId: String(l.vendedorId) })}
        colunas={[
          { titulo: 'Vendedor', valor: (l) => <span className="text-dark-100">{l.vendedorNome}</span>, csv: (l) => l.vendedorNome },
          ...colsValores<(typeof data.porVendedor)[number]>(),
        ]}
      />

      <TabelaRelatorio
        titulo="Por cliente beneficiado"
        dicaClique={dica}
        arquivo="liberacoes-por-cliente"
        linhas={data.porCliente}
        chave={(l) => l.clienteId}
        onClicar={(l) => irParaRegistros({ q: l.clienteCodigo })}
        colunas={[
          {
            titulo: 'Cliente',
            valor: (l) => (
              <span className="text-dark-100">
                {l.clienteNome} <span className="text-dark-500 text-xs">Cód. {l.clienteCodigo} · {l.empresaNome}</span>
              </span>
            ),
            csv: (l) => l.clienteNome,
          },
          { titulo: 'Código', valor: (l) => l.clienteCodigo, csv: (l) => l.clienteCodigo },
          { titulo: 'Empresa', valor: (l) => l.empresaNome, csv: (l) => l.empresaNome },
          ...colsValores<(typeof data.porCliente)[number]>(),
        ]}
      />

      <TabelaRelatorio
        titulo="Por mês"
        dicaClique={dica}
        arquivo="liberacoes-por-mes"
        linhas={data.porMes}
        chave={(l) => l.mes}
        onClicar={(l) => {
          const { de, ate } = limitesDoMes(l.mes)
          irParaRegistros({ dataDe: de, dataAte: ate, mesReferencia: '' })
        }}
        colunas={[{ titulo: 'Mês', valor: (l) => <span className="text-dark-100">{mesBr(l.mes)}</span>, csv: (l) => mesBr(l.mes) }, ...colsValores<(typeof data.porMes)[number]>()]}
      />

      {data.porEmpresa.length > 1 && (
        <TabelaRelatorio
          titulo="Por empresa"
          dicaClique={dica}
          arquivo="liberacoes-por-empresa"
          linhas={data.porEmpresa}
          chave={(l) => l.empresaId}
          onClicar={(l) => irParaRegistros({ empresaId: String(l.empresaId) })}
          colunas={[{ titulo: 'Empresa', valor: (l) => <span className="text-dark-100">{l.empresaNome}</span>, csv: (l) => l.empresaNome }, ...colsValores<(typeof data.porEmpresa)[number]>()]}
        />
      )}
      <p className="text-[11px] text-dark-500">Conta só os registros de liberação (negativas antigas copiadas da Consulta de Crédito ficam de fora).</p>
    </div>
  )
}

// Termo principal virou "Liberação / Limite de Crédito" — a tela passou a
// cobrir as duas coisas (pedido do João, 2026-10-05): "Lançamentos" segue
// sendo o registro de liberações já decididas (consultas, como sempre
// foi); "Limites" é fila nova, à parte — pedidos de LIMITE de crédito
// (tipo='limite' em solicitacoesCredito) não entram mais em Lançamentos,
// só aparecem aqui (ver solicitacaoCredito.ts, responder).
export default function LiberacaoCredito() {
  const [tab, setTab] = usePersistedState<'lancamentos' | 'relatorio'>('liberacaoCredito:aba', 'lancamentos')
  const [filtros, setFiltros] = usePersistedState<FiltrosLib>('liberacaoCredito:filtros', FILTROS_LIB_VAZIOS)
  const f = { ...FILTROS_LIB_VAZIOS, ...filtros }
  const set = (p: Partial<FiltrosLib>) => setFiltros({ ...f, ...p })

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Registros de liberação</h1>
        <p className="text-sm text-dark-400 mt-1">Limites liberados a mais pelo Financeiro (Jessica, Rubia) ou pela Diretoria (Guilherme) — vale pras empresas do grupo todas juntas. Controle manual de quem está liberando fora do esquema. Consultas e pedidos de limite são respondidos em Consulta/Solicitação de Crédito.</p>
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
            {t === 'lancamentos' ? 'Registros' : 'Relatório'}
          </button>
        ))}
      </div>

      <BarraFiltrosLib f={f} set={set} completo={tab === 'lancamentos'} />

      {tab === 'lancamentos' && <AbaLancamentos f={f} />}
      {tab === 'relatorio' && (
        <AbaRelatorio
          f={f}
          irParaRegistros={(p) => {
            set(p)
            setTab('lancamentos')
          }}
        />
      )}
    </div>
  )
}
