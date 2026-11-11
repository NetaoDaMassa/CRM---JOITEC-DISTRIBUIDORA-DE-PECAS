import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, Plus, Minus, Trash2, Package, RefreshCw, Printer, Send, ArrowLeft, ShoppingCart, User, Settings2, CheckCircle2, XCircle, ThumbsUp, Undo2, History, BadgeCheck, Clock, Copy } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { formatarMoeda } from '../lib/moeda'
import { timeAgo } from '../lib/utils'
import { parseValorBr } from '../lib/valorBr'

// Cotações no CRM — troca do Portal One (pedido do João, 2026-11-10).
// Etapa 1: catálogo, preço e prazo copiados do SAP, cotação salva no CRM.
// O catálogo inteiro vem de uma vez e a busca filtra aqui mesmo — nada de
// esperar o SAP a cada tecla (a reclamação nº 1 do portal: "lerdo e trava").
// Enviar ao SAP fica pra etapa 2 (usuário próprio + base de teste).

type Saidas = inferRouterOutputs<AppRouter>['cotacoesCrm']
type ItemCatalogo = Saidas['catalogo'][number]
type ClienteBusca = Saidas['clientes'][number]
// preco = preço digitado pelo vendedor (pode ser acima da tabela, como no SAP);
// sem ele, vale tabela − desconto.
type Linha = { itemCodigo: string; quantidade: number; descontoPct: number; preco?: number | null }

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Aceita "1,5" e "1.5" (lib/valorBr — já evitou o bug do ponto virar milhar).
const numero = (s: string) => parseValorBr(s)
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')

type Status = 'rascunho' | 'aguardando_aprovacao' | 'aprovada' | 'enviada' | 'ganha' | 'perdida' | 'cancelada'
const STATUS: Record<Status, { rotulo: string; cor: string }> = {
  rascunho: { rotulo: 'Rascunho', cor: 'bg-dark-700 text-dark-300' },
  aguardando_aprovacao: { rotulo: 'Aguardando aprovação', cor: 'bg-amber-900/40 text-amber-300' },
  aprovada: { rotulo: 'Pronta p/ enviar', cor: 'bg-sky-900/40 text-sky-300' },
  enviada: { rotulo: 'Enviada ao cliente', cor: 'bg-indigo-900/40 text-indigo-300' },
  ganha: { rotulo: 'Cliente aprovou', cor: 'bg-green-900/40 text-green-300' },
  perdida: { rotulo: 'Perdida', cor: 'bg-red-900/40 text-red-300' },
  cancelada: { rotulo: 'Cancelada', cor: 'bg-dark-700 text-dark-400' },
}
function ChipStatus({ status, vencida }: { status: Status; vencida?: boolean }) {
  if (vencida) return <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-orange-900/40 text-orange-300">Vencida</span>
  return <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS[status].cor}`}>{STATUS[status].rotulo}</span>
}

export default function Cotacoes() {
  // ?abrir=ID (link do card do Kanban) abre direto a cotação.
  const [aberta, setAberta] = useState<number | 'nova' | null>(() => {
    const n = Number(new URLSearchParams(window.location.search).get('abrir'))
    return Number.isInteger(n) && n > 0 ? n : null
  })
  return aberta === null ? <ListaCotacoes onAbrir={setAberta} /> : <EditorCotacao key={String(aberta)} id={aberta === 'nova' ? null : aberta} onVoltar={() => setAberta(null)} onSalva={setAberta} />
}

const FILTROS: { chave: string; rotulo: string; teste: (c: { status: Status; vencida: boolean }) => boolean }[] = [
  { chave: 'abertas', rotulo: 'Em aberto', teste: (c) => ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada'].includes(c.status) },
  { chave: 'aprovacao', rotulo: 'Aguardando aprovação', teste: (c) => c.status === 'aguardando_aprovacao' },
  { chave: 'enviadas', rotulo: 'Enviadas', teste: (c) => c.status === 'enviada' && !c.vencida },
  { chave: 'vencidas', rotulo: 'Vencidas', teste: (c) => c.vencida },
  { chave: 'ganhas', rotulo: 'Cliente aprovou', teste: (c) => c.status === 'ganha' },
  { chave: 'perdidas', rotulo: 'Perdidas', teste: (c) => c.status === 'perdida' },
  { chave: 'todas', rotulo: 'Todas', teste: () => true },
]

function ListaCotacoes({ onAbrir }: { onAbrir: (id: number | 'nova') => void }) {
  const { data: ctx } = trpc.cotacoesCrm.contexto.useQuery()
  const { data: lista, isLoading, error } = trpc.cotacoesCrm.listar.useQuery()
  const [filtro, setFiltro] = useState('abertas')
  const [configurando, setConfigurando] = useState(false)
  const utils = trpc.useUtils()
  const atualizar = trpc.cotacoesCrm.atualizarCatalogo.useMutation({
    onSuccess: (r) => {
      toast.success(r ? `Catálogo atualizado: ${r.itens} itens` : 'Catálogo já estava em dia')
      utils.cotacoesCrm.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const linhas = (lista ?? []) as (NonNullable<typeof lista>[number] & { status: Status })[]
  const visiveis = linhas.filter(FILTROS.find((f) => f.chave === filtro)!.teste)
  const aguardandoMim = ctx?.podeAprovar ? linhas.filter((c) => c.status === 'aguardando_aprovacao').length : 0
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark-50 flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-gold-400" /> Cotações
          </h1>
          <p className="text-sm text-dark-400">
            Catálogo e preços do SAP {ctx?.atualizadoEm ? `· atualizado ${timeAgo(`${ctx.atualizadoEm.replace(' ', 'T')}Z`)}` : '· ainda não copiado'}
            {ctx && ` · desconto livre até ${fmtQtd(ctx.descontoLivre)}%${ctx.gerente ? ` · acima disso aprova: ${ctx.gerente.name}` : ' · gerente não configurado'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ctx?.podeConfigurar && (
            <>
              <Button variant="secondary" onClick={() => setConfigurando(true)}>
                <Settings2 className="h-4 w-4 mr-1.5" /> Regras
              </Button>
              <Button variant="secondary" loading={atualizar.isPending} onClick={() => atualizar.mutate()}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar catálogo
              </Button>
            </>
          )}
          <Button onClick={() => onAbrir('nova')}>
            <Plus className="h-4 w-4 mr-1.5" /> Nova cotação
          </Button>
        </div>
      </div>

      <ResumoCotacoes linhas={linhas} />

      {aguardandoMim > 0 && (
        <button type="button" onClick={() => setFiltro('aprovacao')} className="w-full text-left rounded-2xl border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-200 hover:bg-amber-900/30">
          <Clock className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          {aguardandoMim === 1 ? '1 cotação está esperando sua aprovação de desconto.' : `${aguardandoMim} cotações estão esperando sua aprovação de desconto.`} Clique para ver.
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => {
          const n = linhas.filter(f.teste).length
          return (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${filtro === f.chave ? 'border-gold-500 bg-gold-900/30 text-gold-200' : 'border-dark-600 text-dark-300 hover:bg-dark-800'}`}
            >
              {f.rotulo} <span className="opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {error ? (
        <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{error.message}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
      ) : !linhas.length ? (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-10 text-center space-y-3">
          <ShoppingCart className="h-10 w-10 mx-auto text-dark-500" />
          <p className="text-dark-200">Nenhuma cotação ainda.</p>
          <Button onClick={() => onAbrir('nova')}>Montar a primeira</Button>
        </div>
      ) : !visiveis.length ? (
        <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-6 text-center">Nenhuma cotação nesse filtro.</p>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden">
          {visiveis.map((c) => (
            <button key={c.id} type="button" onClick={() => onAbrir(c.id)} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-dark-700/40 transition-colors">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-semibold text-dark-100 break-words">
                  <span className="text-dark-500 font-normal">nº {c.id} · </span>
                  {c.clienteNome}
                </p>
                <p className="text-xs text-dark-400">
                  {c.clienteCodigo} · {c.itens} {c.itens === 1 ? 'item' : 'itens'}
                  {c.maiorDescontoPct > 0 && ` · desc. até ${fmtQtd(c.maiorDescontoPct)}%`}
                  {c.status === 'enviada' && c.validaAte && ` · vale até ${dataBr(c.validaAte)}`}
                  {ctx?.veTudo && ` · ${c.vendedorNome}`}
                </p>
              </div>
              {c.sapPedidoNum ? (
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-green-900/40 text-green-200">Pedido SAP {c.sapPedidoNum}</span>
              ) : c.sapDocNum ? (
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-teal-900/40 text-teal-200">SAP {c.sapDocNum}</span>
              ) : null}
              <ChipStatus status={c.status} vencida={c.vencida} />
              <span className="text-sm font-bold text-gold-300 w-32 text-right">{formatarMoeda(c.total)}</span>
              <span className="text-xs text-dark-500 w-24 text-right">{timeAgo(`${c.updatedAt.replace(' ', 'T')}Z`)}</span>
            </button>
          ))}
        </div>
      )}
      {configurando && ctx && <ModalRegras ctx={ctx} onFechar={() => setConfigurando(false)} />}
    </div>
  )
}

// Cards de resumo do mês (BR): em aberto, aguardando aprovação, enviadas,
// aprovadas pelo cliente e conversão (aprovadas ÷ encerradas no mês).
function ResumoCotacoes({ linhas }: { linhas: { status: Status; total: number; vencida: boolean; enviadaClienteEm: string | null; encerradaEm: string | null }[] }) {
  const mes = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
  const doMes = (d: string | null) => !!d && d.slice(0, 7) === mes
  const abertas = linhas.filter((c) => ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada'].includes(c.status) && !c.vencida)
  const aguardando = linhas.filter((c) => c.status === 'aguardando_aprovacao')
  const enviadasMes = linhas.filter((c) => doMes(c.enviadaClienteEm))
  const ganhasMes = linhas.filter((c) => c.status === 'ganha' && doMes(c.encerradaEm))
  const perdidasMes = linhas.filter((c) => c.status === 'perdida' && doMes(c.encerradaEm))
  const soma = (l: { total: number }[]) => l.reduce((s, c) => s + c.total, 0)
  const encerradas = ganhasMes.length + perdidasMes.length
  const cards = [
    { rotulo: 'Em aberto', valor: formatarMoeda(soma(abertas)), sub: `${abertas.length} cotação(ões)`, cor: 'text-dark-50' },
    { rotulo: 'Aguardando aprovação', valor: String(aguardando.length), sub: formatarMoeda(soma(aguardando)), cor: aguardando.length ? 'text-amber-300' : 'text-dark-50' },
    { rotulo: 'Enviadas no mês', valor: formatarMoeda(soma(enviadasMes)), sub: `${enviadasMes.length} cotação(ões)`, cor: 'text-indigo-300' },
    { rotulo: 'Cliente aprovou no mês', valor: formatarMoeda(soma(ganhasMes)), sub: `${ganhasMes.length} cotação(ões)`, cor: 'text-green-300' },
    { rotulo: 'Conversão no mês', valor: encerradas ? `${Math.round((ganhasMes.length / encerradas) * 100)}%` : '—', sub: `${ganhasMes.length} aprovadas · ${perdidasMes.length} perdidas`, cor: 'text-gold-300' },
  ]
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <div key={c.rotulo} className="rounded-2xl border border-dark-600 bg-dark-800 px-4 py-3">
          <p className="text-xs text-dark-400">{c.rotulo}</p>
          <p className={`mt-1 text-xl font-bold ${c.cor}`}>{c.valor}</p>
          <p className="text-[11px] text-dark-500">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}

function ModalRegras({ ctx, onFechar }: { ctx: Saidas['contexto']; onFechar: () => void }) {
  const utils = trpc.useUtils()
  const [gerenteId, setGerenteId] = useState<number | null>(ctx.gerente?.id ?? null)
  const [livre, setLivre] = useState(String(ctx.descontoLivre).replace('.', ','))
  const salvar = trpc.cotacoesCrm.configurar.useMutation({
    onSuccess: () => {
      toast.success('Regras salvas')
      utils.cotacoesCrm.contexto.invalidate()
      utils.cotacoesCrm.listar.invalidate()
      onFechar()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onFechar} title="Regras das cotações desta empresa">
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-dark-200">Gerente que aprova desconto</span>
          <select className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100" value={gerenteId ?? ''} onChange={(e) => setGerenteId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Ninguém (desconto acima do livre fica bloqueado)</option>
            {ctx.usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
          <span className="block text-xs text-dark-400">Recebe o aviso e aprova ou reprova. Também passa a ver todas as cotações da empresa.</span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-dark-200">Desconto que o vendedor dá sozinho (%)</span>
          <input inputMode="decimal" className="w-32 rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100" value={livre} onChange={(e) => setLivre(e.target.value)} />
          <span className="block text-xs text-dark-400">Qualquer item com desconto acima disso manda a cotação para o gerente aprovar.</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            loading={salvar.isPending}
            onClick={() => {
              const n = numero(livre)
              if (Number.isNaN(n) || n < 0 || n > 100) return toast.error('Desconto entre 0 e 100%')
              salvar.mutate({ gerenteId, descontoLivre: n })
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function EditorCotacao({ id, onVoltar, onSalva }: { id: number | null; onVoltar: () => void; onSalva: (id: number) => void }) {
  const utils = trpc.useUtils()
  const { data: ctx } = trpc.cotacoesCrm.contexto.useQuery()
  const { data: existente } = trpc.cotacoesCrm.obter.useQuery({ id: id ?? 0 }, { enabled: id != null })

  const [cliente, setCliente] = useState<{ id: number; codigo: string; nome: string; cidade?: string | null; estado?: string | null } | null>(null)
  const [lista, setLista] = useState<number | null>(null)
  const [prazo, setPrazo] = useState<number | null>(null)
  const [observacao, setObservacao] = useState('')
  const [dataEntrega, setDataEntrega] = useState('')
  const [contato, setContato] = useState('')
  const [numeroReferencia, setNumeroReferencia] = useState('')
  const [transportadora, setTransportadora] = useState('')
  const [tipoEnvio, setTipoEnvio] = useState<'CIF' | 'FOB' | ''>('CIF')
  const [frete, setFrete] = useState(0)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [alterado, setAlterado] = useState(false)

  // Carrega a cotação salva uma vez.
  const carregou = useRef(false)
  useEffect(() => {
    if (!existente || carregou.current) return
    carregou.current = true
    if (existente.cliente) setCliente({ id: existente.cliente.id, codigo: existente.cliente.codigo, nome: existente.cliente.razaoSocial, cidade: existente.cliente.cidade, estado: existente.cliente.estado })
    setLista(existente.listaPreco)
    setPrazo(existente.prazoCodigo)
    setObservacao(existente.observacao ?? '')
    setDataEntrega(existente.dataEntrega ?? '')
    setContato(existente.contato ?? '')
    setNumeroReferencia(existente.numeroReferencia ?? '')
    setTransportadora(existente.transportadora ?? '')
    setTipoEnvio(existente.tipoEnvio ?? '')
    setFrete(existente.valorFrete ?? 0)
    setLinhas(existente.itens.map((i) => ({ itemCodigo: i.itemCodigo, quantidade: i.quantidade, descontoPct: Math.max(0, i.descontoPct), preco: i.precoManual ? i.precoUnitario : null })))
  }, [existente])

  const listaEfetiva = lista ?? ctx?.listaBase ?? 1
  const { data: catalogo, isLoading: carregandoCatalogo } = trpc.cotacoesCrm.catalogo.useQuery({ lista: listaEfetiva }, { staleTime: 5 * 60_000 })
  const porCodigo = useMemo(() => new Map((catalogo ?? []).map((i) => [i.codigo, i])), [catalogo])
  const status = (existente?.status ?? 'rascunho') as Status
  const somenteLeitura = existente != null && status !== 'rascunho'
  const podeMexer = !existente || existente.souDono || !!ctx?.veTudo
  const [modal, setModal] = useState<null | 'perder' | 'ganhar' | 'reprovar'>(null)
  const depoisDeAcao = (msg: string) => () => {
    toast.success(msg)
    utils.cotacoesCrm.listar.invalidate()
    utils.cotacoesCrm.obter.invalidate()
    setModal(null)
  }
  const erro = (e: { message: string }) => toast.error(e.message)
  const concluir = trpc.cotacoesCrm.concluir.useMutation({
    onSuccess: (r) => depoisDeAcao(r.status === 'aguardando_aprovacao' ? 'Enviada para o gerente aprovar o desconto' : 'Cotação pronta para enviar ao cliente')(),
    onError: erro,
  })
  const aprovar = trpc.cotacoesCrm.aprovar.useMutation({ onSuccess: depoisDeAcao('Desconto aprovado'), onError: erro })
  const reprovar = trpc.cotacoesCrm.reprovar.useMutation({ onSuccess: depoisDeAcao('Desconto reprovado — voltou para o vendedor'), onError: erro })
  const marcarEnviada = trpc.cotacoesCrm.marcarEnviada.useMutation({ onSuccess: (r) => depoisDeAcao(`Marcada como enviada — vale até ${dataBr(r.validaAte)}`)(), onError: erro })
  const reabrir = trpc.cotacoesCrm.reabrir.useMutation({ onSuccess: depoisDeAcao('Reaberta para negociar'), onError: erro })
  const ganhar = trpc.cotacoesCrm.ganhar.useMutation({ onSuccess: depoisDeAcao('Registrado: cliente aprovou'), onError: erro })
  const perder = trpc.cotacoesCrm.perder.useMutation({ onSuccess: depoisDeAcao('Marcada como perdida'), onError: erro })
  // Trava no mesmo instante do clique (o estado "enviando" só chega no
  // próximo desenho da tela — um clique duplo passava e gerava em dobro).
  const travaSap = useRef(false)
  const enviarSap = trpc.cotacoesCrm.enviarAoSap.useMutation({
    onSuccess: (r) => depoisDeAcao(`Cotação criada no SAP — nº ${r.docNum} (${formatarMoeda(r.total)} com impostos)`)(),
    onError: (e) => toast.error(e.message, { duration: 10000 }),
    onSettled: () => (travaSap.current = false),
  })
  const gerarPedido = trpc.cotacoesCrm.gerarPedido.useMutation({
    onSuccess: (r) => depoisDeAcao(`Pedido de venda criado no SAP — nº ${r.docNum} (${formatarMoeda(r.total)} com impostos)`)(),
    onError: (e) => toast.error(e.message, { duration: 10000 }),
    onSettled: () => (travaSap.current = false),
  })
  // O servidor confere o estoque no SAP na hora e bloqueia se faltar.
  const onEnviarSap = () => {
    if (travaSap.current || id == null) return
    travaSap.current = true
    if (confirm(`Criar a cotação nº ${id} no SAP?`)) enviarSap.mutate({ id })
    else travaSap.current = false
  }
  const onGerarPedido = () => {
    if (travaSap.current || id == null || !existente) return
    travaSap.current = true
    const aceitos = existente.itens.filter((i) => i.aceito)
    if (confirm(`Gerar o pedido de venda no SAP com ${aceitos.length} item(ns) aprovados pelo cliente?`)) gerarPedido.mutate({ id })
    else travaSap.current = false
  }
  const duplicar = trpc.cotacoesCrm.duplicar.useMutation({
    onSuccess: (r) => {
      toast.success(`Cotação duplicada — nova nº ${r.id}`)
      utils.cotacoesCrm.listar.invalidate()
      onSalva(r.id)
    },
    onError: erro,
  })

  const salvar = trpc.cotacoesCrm.salvar.useMutation({
    onSuccess: (r) => {
      toast.success('Cotação salva')
      setAlterado(false)
      utils.cotacoesCrm.listar.invalidate()
      utils.cotacoesCrm.obter.invalidate()
      if (id == null) onSalva(r.id)
    },
    onError: (e) => toast.error(e.message),
  })
  const excluir = trpc.cotacoesCrm.excluir.useMutation({
    onSuccess: () => {
      toast.success('Cotação excluída')
      utils.cotacoesCrm.listar.invalidate()
      onVoltar()
    },
    onError: (e) => toast.error(e.message),
  })

  const mexer = (f: (l: Linha[]) => Linha[]) => {
    setLinhas(f)
    setAlterado(true)
  }
  // Soma na linha que já existe, ou cria a linha. Aceita vários de uma vez
  // (seleção múltipla do catálogo, como no Portal One).
  // Item sem estoque é proibido (João, 2026-11-10): nunca passa do disponível.
  const adicionar = (novos: { codigo: string; qtd: number }[]) =>
    mexer((ls) => {
      let r = ls
      for (const { codigo, qtd } of novos) {
        const disp = porCodigo.get(codigo)?.estoque ?? 0
        const atual = r.find((l) => l.itemCodigo === codigo)?.quantidade ?? 0
        const nova = Math.min(atual + qtd, disp)
        if (nova <= atual) {
          toast.error(`${porCodigo.get(codigo)?.nome ?? codigo}: só ${fmtQtd(disp)} disponível`)
          continue
        }
        if (nova < atual + qtd) toast(`${porCodigo.get(codigo)?.nome ?? codigo}: limitado ao disponível (${fmtQtd(disp)})`, { icon: '⚠️' })
        r = atual ? r.map((l) => (l.itemCodigo === codigo ? { ...l, quantidade: nova } : l)) : [...r, { itemCodigo: codigo, quantidade: nova, descontoPct: 0 }]
      }
      return r
    })

  const recusados = new Set((existente?.status === 'ganha' ? existente.itens.filter((i) => !i.aceito) : []).map((i) => i.itemCodigo))
  const calc = linhas.map((l) => {
    const item = porCodigo.get(l.itemCodigo)
    const tabela = item?.preco ?? null
    const unit = l.preco != null ? l.preco : tabela != null ? tabela * (1 - l.descontoPct / 100) : null
    // Desconto efetivo (negativo = acréscimo sobre a tabela).
    const descEfetivo = l.preco != null && tabela ? (1 - l.preco / tabela) * 100 : l.descontoPct
    return { ...l, item, tabela, unit, descEfetivo, subtotal: unit != null ? unit * l.quantidade : null }
  })
  const total = calc.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const semPreco = calc.some((l) => l.tabela == null)

  const escolherCliente = (c: ClienteBusca) => {
    setCliente({ id: c.id, codigo: c.codigo, nome: c.nome, cidade: c.cidade, estado: c.estado })
    if (c.listaPreco) setLista(c.listaPreco)
    if (c.prazoCodigo != null) setPrazo(c.prazoCodigo)
    if (c.nomeContato && !contato) setContato(c.nomeContato)
    if (c.bloqueado) toast('Atenção: esse cliente está bloqueado/inativo no SAP', { icon: '⚠️' })
    setAlterado(true)
  }

  const dadosParaSalvar = () => ({
    id: id ?? undefined,
    clienteId: cliente!.id,
    listaPreco: listaEfetiva,
    prazoCodigo: prazo,
    observacao: observacao || null,
    dataEntrega: dataEntrega || null,
    contato: contato.trim() || null,
    numeroReferencia: numeroReferencia.trim() || null,
    transportadora: transportadora.trim() || null,
    tipoEnvio: tipoEnvio || null,
    valorFrete: frete,
    itens: linhas.map((l) => ({ itemCodigo: l.itemCodigo, quantidade: l.quantidade, descontoPct: l.preco != null ? 0 : l.descontoPct, ...(l.preco != null ? { precoUnitario: l.preco } : {}) })),
  })
  const onSalvar = () => {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!linhas.length) return toast.error('Adicione pelo menos um item')
    salvar.mutate(dadosParaSalvar())
  }
  // Concluir salva antes (se mudou algo) e depois manda concluir.
  const onConcluir = async () => {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!linhas.length) return toast.error('Adicione pelo menos um item')
    if (prazo == null) return toast.error('Escolha o prazo de pagamento')
    try {
      let alvo = id
      if (alterado || alvo == null) {
        const r = await salvar.mutateAsync(dadosParaSalvar())
        alvo = r.id
      }
      await concluir.mutateAsync({ id: alvo! })
      if (id == null) onSalva(alvo!)
    } catch {
      /* o toast de erro já saiu no onError */
    }
  }

  const nomeLista = ctx?.listas.find((l) => l.numero === listaEfetiva)?.nome
  const nomePrazo = ctx?.prazos.find((p) => p.codigo === prazo)?.nome

  // Imprime sempre o que está salvo (salva antes, se mudou algo), no mesmo
  // padrão da Cotação de Venda do SAP. A aba abre já no clique (senão o
  // navegador bloqueia a janela aberta depois de esperar o servidor).
  const imprimir = async () => {
    if (!cliente || !linhas.length) return toast.error('Monte a cotação antes de imprimir')
    const w = window.open('', '_blank')
    if (!w) return toast.error('O navegador bloqueou a janela — libere pop-ups para o CRM')
    w.document.write('<p style="font-family:sans-serif;padding:24px">Montando a cotação…</p>')
    try {
      let alvo = id
      if (!somenteLeitura && (alterado || alvo == null)) {
        const r = await salvar.mutateAsync(dadosParaSalvar())
        alvo = r.id
      }
      const dados = await utils.cotacoesCrm.obter.fetch({ id: alvo! })
      if (!dados.clienteSap) dados.clienteSap = await utils.cotacoesCrm.dadosClienteSap.fetch({ id: alvo! })
      w.document.open()
      w.document.write(htmlCotacao(dados, ctx!, porCodigo))
      w.document.close()
      if (id == null) onSalva(alvo!)
    } catch (e) {
      w.close()
      toast.error((e as Error).message)
    }
  }
  const valorTotal = total + frete

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => (!alterado || confirm('Sair sem salvar as mudanças?')) && onVoltar()} className="inline-flex items-center gap-1.5 text-sm text-dark-300 hover:text-dark-100">
          <ArrowLeft className="h-4 w-4" /> Cotações
        </button>
        <div className="flex flex-wrap gap-2">
          {id != null && existente && (
            <Button variant="secondary" loading={duplicar.isPending} onClick={() => (!alterado || confirm('Duplicar sem salvar as mudanças desta?')) && duplicar.mutate({ id })}>
              <Copy className="h-4 w-4 mr-1.5" /> Duplicar
            </Button>
          )}
          <Button variant="secondary" onClick={imprimir}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
          </Button>
          {status === 'rascunho' && podeMexer && (
            <>
              {id != null && (
                <Button variant="secondary" loading={excluir.isPending} onClick={() => confirm('Excluir esta cotação?') && excluir.mutate({ id })}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
                </Button>
              )}
              <Button variant="secondary" loading={salvar.isPending && !concluir.isPending} onClick={onSalvar}>
                Salvar rascunho{alterado ? ' *' : ''}
              </Button>
              <Button loading={concluir.isPending} onClick={onConcluir}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Concluir cotação
              </Button>
            </>
          )}
          {status === 'aguardando_aprovacao' && ctx?.podeAprovar && id != null && (
            <>
              <Button variant="secondary" onClick={() => setModal('reprovar')}>
                <XCircle className="h-4 w-4 mr-1.5" /> Reprovar
              </Button>
              <Button loading={aprovar.isPending} onClick={() => aprovar.mutate({ id })}>
                <BadgeCheck className="h-4 w-4 mr-1.5" /> Aprovar desconto
              </Button>
            </>
          )}
          {(status === 'aprovada' || status === 'enviada') && podeMexer && id != null && (
            <>
              <Button variant="secondary" loading={marcarEnviada.isPending} onClick={() => marcarEnviada.mutate({ id })}>
                <Send className="h-4 w-4 mr-1.5" /> {status === 'enviada' ? 'Reenviei (renova validade)' : 'Marquei como enviada ao cliente'}
              </Button>
              <Button onClick={() => setModal('ganhar')}>
                <ThumbsUp className="h-4 w-4 mr-1.5" /> Cliente aprovou
              </Button>
            </>
          )}
          {(['aguardando_aprovacao', 'aprovada', 'enviada', 'perdida'].includes(status) || (status === 'ganha' && !existente?.sapPedidoNum)) && podeMexer && id != null && (
            <Button variant="secondary" loading={reabrir.isPending} onClick={() => confirm(`Voltar para rascunho e editar?${existente?.sapDocNum ? `\n\nA cotação SAP nº ${existente.sapDocNum} será fechada no SAP (ao reenviar, nasce uma nova).` : ''}\n\nSe o desconto passar do livre, vai precisar de aprovação de novo.`) && reabrir.mutate({ id })}>
              <Undo2 className="h-4 w-4 mr-1.5" /> {status === 'ganha' || status === 'perdida' ? 'Voltar e editar' : 'Reabrir p/ negociar'}
            </Button>
          )}
          {['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada'].includes(status) && podeMexer && id != null && (
            <Button variant="secondary" onClick={() => setModal('perder')}>
              Perdida
            </Button>
          )}
          {existente && ['aprovada', 'enviada'].includes(status) && !existente.sapDocNum && podeMexer && (
            <Button variant="secondary" loading={enviarSap.isPending} disabled={enviarSap.isPending || gerarPedido.isPending} onClick={onEnviarSap}>
              <Send className="h-4 w-4 mr-1.5" /> Enviar ao SAP
            </Button>
          )}
          {existente && status === 'ganha' && !existente.sapPedidoNum && podeMexer && (
            <Button loading={gerarPedido.isPending} disabled={gerarPedido.isPending || enviarSap.isPending} onClick={onGerarPedido}>
              <Send className="h-4 w-4 mr-1.5" /> {gerarPedido.isPending ? 'Enviando ao SAP… (pode levar até 1 minuto)' : 'Gerar pedido no SAP'}
            </Button>
          )}
        </div>
      </div>

      {existente && <FaixaSituacao c={existente} status={status} descontoLivre={ctx?.descontoLivre ?? 0} gerente={ctx?.gerente?.name ?? null} />}

      {/* Faixa de cima: cliente e condições, na largura toda. */}
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <div className="grid gap-5 xl:grid-cols-[minmax(260px,1fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-2">
            {cliente ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-dark-400">Cliente</p>
                  <p className="font-semibold text-dark-50 break-words">{cliente.nome}</p>
                  <p className="text-xs text-dark-400">
                    {cliente.codigo}
                    {cliente.cidade && ` · ${cliente.cidade}${cliente.estado ? `/${cliente.estado}` : ''}`}
                  </p>
                </div>
                {!somenteLeitura && (
                  <button type="button" className="text-xs text-gold-400 hover:underline shrink-0" onClick={() => setCliente(null)}>
                    Trocar
                  </button>
                )}
              </div>
            ) : (
              <BuscaCliente onEscolher={escolherCliente} />
            )}
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Campo rotulo="Tabela de preço">
              <select disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={listaEfetiva} onChange={(e) => (setLista(Number(e.target.value)), setAlterado(true))}>
                {(ctx?.listas ?? []).map((l) => (
                  <option key={l.numero} value={l.numero}>
                    {l.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Prazo de pagamento">
              <select disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={prazo ?? ''} onChange={(e) => (setPrazo(e.target.value === '' ? null : Number(e.target.value)), setAlterado(true))}>
                <option value="">Escolha…</option>
                {(ctx?.prazos ?? []).map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Data de entrega">
              <input type="date" disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={dataEntrega} onChange={(e) => (setDataEntrega(e.target.value), setAlterado(true))} />
            </Campo>
            <Campo rotulo="Nº pedido do cliente">
              <input disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={numeroReferencia} onChange={(e) => (setNumeroReferencia(e.target.value), setAlterado(true))} placeholder="Opcional" />
            </Campo>
            <Campo rotulo="Contato no cliente">
              <input disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={contato} onChange={(e) => (setContato(e.target.value), setAlterado(true))} placeholder="Quem pediu" />
            </Campo>
            <Campo rotulo="Transportadora">
              <input disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={transportadora} onChange={(e) => (setTransportadora(e.target.value), setAlterado(true))} placeholder="Ex.: Kamer Cargo" />
            </Campo>
            <Campo rotulo="Tipo de envio">
              <select disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70" value={tipoEnvio} onChange={(e) => (setTipoEnvio(e.target.value as 'CIF' | 'FOB' | ''), setAlterado(true))}>
                <option value="">—</option>
                <option value="CIF">CIF — nós pagamos</option>
                <option value="FOB">FOB — cliente paga</option>
              </select>
            </Campo>
            <Campo rotulo="Frete cobrado (R$)">
              <CampoNumero
                disabled={somenteLeitura}
                className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70"
                valor={frete}
                vazioVale={0}
                placeholder="0,00"
                valido={(n) => n >= 0}
                onValor={(n) => (setFrete(n), setAlterado(true))}
              />
            </Campo>
          </div>
        </div>
      </div>

      {/* Embaixo: catálogo à esquerda, itens e total à direita. */}
      <div className={`grid gap-4 ${somenteLeitura ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]'}`}>
        {!somenteLeitura && (
          <div className="min-w-0">
            <Catalogo catalogo={catalogo} carregando={carregandoCatalogo} naCotacao={new Set(linhas.map((l) => l.itemCodigo))} onAdicionar={adicionar} />
          </div>
        )}
        <div className="space-y-4 min-w-0">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
              <p className="text-sm font-semibold text-dark-100">Itens da cotação</p>
              <p className="text-xs text-dark-400">{nomeLista ? `Tabela ${nomeLista}` : ''}</p>
            </div>
            {!calc.length ? (
              <p className="px-4 py-8 text-center text-sm text-dark-400">Busque um produto no catálogo e clique em + (ou marque vários e clique em Adicionar).</p>
            ) : (
              <div className="divide-y divide-dark-700">
                {calc.map((l) => (
                  <div key={l.itemCodigo} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <FotoProduto codigo={l.itemCodigo} nome={l.item?.nome ?? l.itemCodigo} foto={l.item?.foto ?? null} tamanho="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm break-words ${recusados.has(l.itemCodigo) ? 'text-dark-500 line-through' : 'text-dark-100'}`}>{l.item?.nome ?? l.itemCodigo}</p>
                        {recusados.has(l.itemCodigo) && <p className="text-[11px] font-semibold text-red-300">Cliente não quis este item</p>}
                        <p className="text-[11px] text-dark-500">
                          {l.itemCodigo}
                          {l.tabela != null ? ` · tabela ${formatarMoeda(l.tabela)}` : ' · sem preço nesta tabela'}
                        </p>
                      </div>
                      {!somenteLeitura && (
                        <button type="button" aria-label="Tirar item" className="text-dark-500 hover:text-red-400" onClick={() => mexer((ls) => ls.filter((x) => x.itemCodigo !== l.itemCodigo))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center rounded-lg border border-dark-600 bg-dark-900">
                        <button type="button" disabled={somenteLeitura} className="px-2 py-1.5 text-dark-300 hover:text-dark-100" onClick={() => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, quantidade: Math.max(1, x.quantidade - 1) } : x)))}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <CampoNumero
                          disabled={somenteLeitura}
                          className="w-16 bg-transparent text-center text-sm text-dark-100 outline-none"
                          valor={l.quantidade}
                          valido={(n) => n > 0 && (somenteLeitura || n <= (l.item?.estoque ?? 0))}
                          onValor={(n) => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, quantidade: n } : x)))}
                        />
                        <button type="button" disabled={somenteLeitura} className="px-2 py-1.5 text-dark-300 hover:text-dark-100" onClick={() => adicionar([{ codigo: l.itemCodigo, qtd: 1 }])}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-dark-400">
                        Desc.
                        <CampoNumero
                          disabled={somenteLeitura}
                          className="w-14 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-right text-sm text-dark-100 outline-none"
                          valor={Math.round(Math.max(0, l.descEfetivo) * 100) / 100}
                          vazioVale={0}
                          placeholder="0"
                          valido={(n) => n >= 0 && n <= 100}
                          onValor={(n) => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, descontoPct: n, preco: null } : x)))}
                        />
                        %
                      </label>
                      <label className="flex items-center gap-1 text-xs text-dark-400">
                        Preço R$
                        <CampoNumero
                          disabled={somenteLeitura}
                          className="w-24 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-right text-sm text-dark-100 outline-none"
                          valor={Math.round((l.unit ?? 0) * 10000) / 10000}
                          valido={(n) => n > 0}
                          onValor={(n) => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, preco: n, descontoPct: 0 } : x)))}
                        />
                      </label>
                      {l.descEfetivo < -0.005 && <span className="text-[10px] font-semibold rounded bg-sky-900/40 text-sky-300 px-1.5 py-0.5">+{fmtQtd(Math.round(-l.descEfetivo * 100) / 100)}% sobre a tabela</span>}
                      {ctx && l.descEfetivo > ctx.descontoLivre && (
                        <span className="text-[10px] font-semibold rounded bg-amber-900/40 text-amber-300 px-1.5 py-0.5" title={`Acima de ${fmtQtd(ctx.descontoLivre)}% precisa do gerente aprovar`}>
                          precisa aprovação
                        </span>
                      )}
                      {l.item && l.item.estoque < l.quantidade && (
                        <span className="text-[10px] font-semibold rounded bg-red-900/40 text-red-300 px-1.5 py-0.5" title="Item sem estoque não pode ser cotado">
                          {l.item.estoque > 0 ? `só ${fmtQtd(l.item.estoque)} disponível — diminua a quantidade` : 'sem estoque — tire da cotação'}
                        </span>
                      )}
                      <span className="ml-auto text-right">
                        <span className="block text-[11px] text-dark-500">por {l.item?.unidade ?? 'un'}</span>
                        <span className="block text-sm font-semibold text-dark-50">{formatarMoeda(l.subtotal)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-4 py-3 border-t border-dark-700 bg-dark-900/40 space-y-1">
              {frete > 0 && (
                <>
                  <div className="flex justify-between text-xs text-dark-400">
                    <span>Itens (sem IPI)</span>
                    <span>{formatarMoeda(total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-dark-400">
                    <span>Frete (despesas adicionais)</span>
                    <span>{formatarMoeda(frete)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-dark-300">
                  Total {semPreco && <span className="text-amber-400">(há item sem preço)</span>}
                </span>
                <span className="text-xl font-bold text-gold-300">{formatarMoeda(valorTotal)}</span>
              </div>
              {calc.some((l) => l.item?.pesoKg) && (
                <p className="text-right text-[11px] text-dark-500">Peso total {fmtQtd(calc.reduce((s, l) => s + (l.item?.pesoKg ?? 0) * l.quantidade, 0))} kg</p>
              )}
            </div>
          </div>

          <div className={`grid gap-4 ${somenteLeitura ? 'lg:grid-cols-2' : ''}`}>
            <div className="space-y-1">
              <Campo rotulo="Observação">
                <textarea
                  disabled={somenteLeitura}
                  rows={3}
                  className="w-full rounded-lg bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600 disabled:opacity-70"
                  value={observacao}
                  onChange={(e) => (setObservacao(e.target.value), setAlterado(true))}
                  placeholder="Frete, entrega, condição combinada…"
                />
              </Campo>
              <p className="text-[11px] text-dark-500">Valores sem impostos — IPI/ICMS o SAP calcula na emissão.</p>
            </div>
          {existente && existente.historico.length > 0 && (
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-dark-100 flex items-center gap-1.5">
                <History className="h-4 w-4 text-dark-400" /> Histórico
              </p>
              <ol className="space-y-2 border-l border-dark-600 pl-3">
                {existente.historico.map((h) => (
                  <li key={h.id} className="text-xs">
                    <p className="text-dark-100">
                      <b>{h.acao}</b>
                      {h.detalhe && <span className="text-dark-300"> — {h.detalhe}</span>}
                    </p>
                    <p className="text-dark-500">
                      {h.quem ?? '—'} · {new Date(`${h.createdAt.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          </div>
        </div>
      </div>
      {modal === 'perder' && id != null && ctx && (
        <ModalPerder motivos={ctx.motivosPerda} carregando={perder.isPending} onFechar={() => setModal(null)} onConfirmar={(motivo, observacao) => perder.mutate({ id, motivo: motivo as Saidas['contexto']['motivosPerda'][number], observacao })} />
      )}
      {modal === 'reprovar' && id != null && (
        <ModalTexto
          titulo="Reprovar desconto"
          rotulo="Por que reprovou? O vendedor vai ver esse motivo."
          botao="Reprovar"
          carregando={reprovar.isPending}
          onFechar={() => setModal(null)}
          onConfirmar={(motivo) => reprovar.mutate({ id, motivo })}
        />
      )}
      {modal === 'ganhar' && id != null && existente && (
        <ModalGanhar itens={existente.itens} carregando={ganhar.isPending} onFechar={() => setModal(null)} onConfirmar={(itensAceitos) => ganhar.mutate({ id, itensAceitos })} />
      )}
    </div>
  )
}

type Cotacao = Saidas['obter']

const LOGO_EMPRESA: Record<string, string> = {
  joitec: '/logos/joitec.png',
  'joitec-automacao': '/logos/joitec.png',
  'odin-tubos': '/logos/odin-tubos.png',
  'odin-compressores': '/logos/odin-compressores.png',
}

// Cotação impressa no mesmo padrão da "Cotação de Venda" do SAP (modelo que
// o João mandou, 2026-11-10): logo + título, emitente, datas/transportadora/
// envio/vendedor, cliente completo, itens com NCM/UN/%desc/preço/IPI/ICMS,
// totais (peso, sem IPI, IPI, despesas adicionais, desconto, valor total),
// Benefício/Utilização/Observações. IPI e ICMS só o SAP calcula (por item e
// por UF) — aqui saem como "na NF" até a cotação ir pro SAP (etapa 2).
function htmlCotacao(c: Cotacao, ctx: Saidas['contexto'], catalogo: Map<string, ItemCatalogo>): string {
  const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]!)
  const din = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const din4 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  // Dados do SAP têm prioridade (o cadastro do CRM costuma estar sem endereço/IE).
  const sap = c.clienteSap
  const crm = c.cliente
  const cl = {
    codigo: crm?.codigo ?? '',
    razaoSocial: crm?.razaoSocial ?? '',
    endereco: sap?.endereco ?? ([crm?.endereco, crm?.numero].filter(Boolean).join(', ') || null),
    complemento: sap?.complemento ?? crm?.complemento ?? null,
    bairro: sap?.bairro ?? crm?.bairro ?? null,
    cep: sap?.cep ?? crm?.cep ?? null,
    cidade: sap?.cidade ?? crm?.cidade ?? null,
    estado: sap?.uf ?? crm?.estado ?? null,
    doc: sap?.cnpj ?? sap?.cpf ?? crm?.cnpj ?? crm?.cpf ?? '',
    ie: sap?.ie ?? crm?.inscricaoEstadual ?? null,
    telefone: sap?.telefone ?? crm?.telefoneWhatsapp ?? null,
    email: sap?.email ?? crm?.email ?? null,
  }
  const e = ctx.emitente
  const prazo = ctx.prazos.find((p) => p.codigo === c.prazoCodigo)?.nome ?? ''
  const itens = c.status === 'ganha' ? c.itens.filter((i) => i.aceito) : c.itens
  const totalItens = itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0)
  const peso = itens.reduce((s, i) => s + (catalogo.get(i.itemCodigo)?.pesoKg ?? 0) * i.quantidade, 0)
  const logo = `${window.location.origin}${LOGO_EMPRESA[ctx.empresaSlug] ?? '/logos/grupo-odin.png'}`
  const dataDoc = dataBr(c.createdAt) || new Date().toLocaleDateString('pt-BR')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cotação de Venda nº ${c.id} - ${esc(cl.razaoSocial)}</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Verdana,Arial,sans-serif;color:#111;font-size:10.5px;margin:0}
.topo{display:grid;grid-template-columns:170px 1fr 170px;align-items:center;gap:8px;border-bottom:2px solid #f08a24;padding-bottom:8px}
.topo img{max-width:160px;max-height:70px}.titulo{text-align:center;font:bold 22px Arial,sans-serif}
.bloco{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:8px 0;border-bottom:2px solid #f08a24}
.bloco b{font-weight:bold}.lin{border-bottom:1px dotted #9aa;padding:3px 0;min-height:18px}.duas{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#1f5f99;color:#fff;font-size:9.5px;padding:6px 4px;border-right:1px solid #fff}
td{padding:4px;border-bottom:1px dotted #9aa;vertical-align:top}.n{text-align:right;white-space:nowrap}.c{text-align:center}
.rodape{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:6px;border-top:2px solid #1f5f99;padding-top:6px}
.tot div{display:flex;justify-content:space-between;border-bottom:1px dotted #9aa;padding:4px 0}.tot .final{font-weight:bold;font-size:12px;border:0;padding-top:8px}
.peso{border-left:6px solid #e0102b;padding-left:6px;font-weight:bold;display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:3px}
.obs{white-space:pre-wrap;margin-top:4px}.pe{margin-top:18px;color:#777;font-size:9px;display:flex;justify-content:space-between}
</style></head><body>
<div class="topo"><img src="${logo}" alt=""><div class="titulo">COTAÇÃO DE VENDA Nº<br>${c.sapDocNum ?? c.id}${c.sapDocNum ? `<div style="font:normal 10px Verdana">CRM nº ${c.id}</div>` : ''}</div><div></div></div>
<div class="bloco">
  <div><b>${esc(e?.nome ?? '')}</b><br>${esc(e?.endereco ?? '')}<br>${e?.bairro ? `Bairro: ${esc(e.bairro)} ` : ''}${e?.cep ? `CEP: ${esc(e.cep)}` : ''}<br>${esc([e?.cidade, e?.uf].filter(Boolean).join(' - '))}<br>${e?.cnpj ? `CNPJ - ${esc(e.cnpj)}` : ''}</div>
  <div>
    <div class="duas"><div><b>Data do documento</b><div class="lin">${dataDoc}</div></div><div><b>Data de Entrega</b><div class="lin">${dataBr(c.dataEntrega)}</div></div><div><b>Válida até</b><div class="lin">${dataBr(c.validaAte) || '—'}</div></div></div>
    <div class="lin"><b>Transportadora:</b> ${esc(c.transportadora)}</div>
    <div class="lin"><b>Tipo de envio:</b> ${esc(c.tipoEnvio)}</div>
    <div class="lin"><b>Vendedor:</b> ${esc(c.vendedorNome)}</div>
  </div>
</div>
<div class="bloco">
  <div><b>${esc(cl.razaoSocial)}</b><br>${esc(cl.endereco)}${cl.complemento ? ` Complemento: ${esc(cl.complemento)}` : ''}<br>${cl.bairro ? `Bairro: ${esc(cl.bairro)} ` : ''}${cl.cep ? `CEP: ${esc(cl.cep)}` : ''}<br>Cidade: ${esc([cl.cidade, cl.estado].filter(Boolean).join(' - '))}<br>CPF/CNPJ: ${esc(cl.doc)}<br>${cl.ie ? `Insc. Estadual: ${esc(cl.ie)}<br>` : ''}${cl.telefone ? `Telefone: ${esc(cl.telefone)}` : ''}</div>
  <div>
    <div class="lin"><b>Código Cliente:</b> ${esc(cl.codigo)}${c.numeroReferencia ? ` &nbsp; <b>Nº Referência:</b> ${esc(c.numeroReferencia)}` : ''}</div>
    <div class="lin"><b>E-mail:</b> ${esc(cl.email)}</div>
    <div class="lin"><b>Contato:</b> ${esc(c.contato ?? sap?.contato)}</div>
    <div class="lin"><b>Condição de Pagamento:</b> ${esc(prazo)}</div>
  </div>
</div>
<table><thead><tr><th>Nº</th><th></th><th>Código</th><th>Descrição do item</th><th>NCM</th><th>UN</th><th>Quantidade</th><th>% Desc</th><th>Preço</th><th>IPI %</th><th>ICMS %</th><th>TOTAL s/ IPI</th></tr></thead><tbody>
${itens
  .map((i, n) => {
    const cat = catalogo.get(i.itemCodigo)
    const foto = cat?.foto ? `<img src="${window.location.origin}${cat.foto}" style="width:34px;height:34px;object-fit:contain">` : ''
    return `<tr><td>${n + 1}</td><td class="c">${foto}</td><td>${esc(i.itemCodigo)}</td><td>${esc(i.nome)}</td><td class="c">${esc(cat?.ncm)}</td><td class="c">${esc(cat?.unidade)}</td><td class="n">${din(i.quantidade)}</td><td class="n">${din(Math.max(0, i.descontoPct))}</td><td class="n">R$ ${din4(i.precoUnitario)}</td><td class="c">na NF</td><td class="c">na NF</td><td class="n">R$ ${din(i.precoUnitario * i.quantidade)}</td></tr>`
  })
  .join('')}
</tbody></table>
<div class="rodape">
  <div><div class="peso"><span>PESO TOTAL:</span><span>${din(peso)} kG</span></div>
    <p><b>Benefício:</b><br><b>Utilização:</b> Venda de Mercadoria Comercio</p>
    <p><b style="font-size:12px">OBSERVAÇÕES :</b></p><div class="obs">${esc(c.observacao)}</div></div>
  <div class="tot">
    <div><b>TOTAL SEM IPI:</b><span>R$ ${din(totalItens)}</span></div>
    <div><b>VALOR DO IPI:</b><span>calculado na NF</span></div>
    <div><b>DESPESAS ADICIONAIS:</b><span>R$ ${din(c.valorFrete)}</span></div>
    <div><b>DESCONTO (-):</b><span>R$ 0,00</span></div>
    <div class="final"><span>VALOR TOTAL:</span><span>R$ ${din(totalItens + c.valorFrete)}</span></div>
  </div>
</div>
<div class="pe"><span>Gerado pelo CRM Grupo Odin</span><span>Valores sujeitos a disponibilidade de estoque. IPI/ICMS calculados na emissão da nota.</span></div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`
}

// Faixa abaixo dos botões: em que pé está a cotação e o que fazer agora.
function FaixaSituacao({ c, status, descontoLivre, gerente }: { c: Cotacao; status: Status; descontoLivre: number; gerente: string | null }) {
  const linhas: { cor: string; texto: React.ReactNode }[] = []
  if (status === 'rascunho' && c.reprovacaoMotivo) linhas.push({ cor: 'border-red-700/50 bg-red-900/20 text-red-200', texto: <>Desconto reprovado: <b>{c.reprovacaoMotivo}</b>. Ajuste e conclua de novo.</> })
  if (status === 'rascunho' && !c.reprovacaoMotivo) linhas.push({ cor: 'border-dark-600 bg-dark-800 text-dark-300', texto: <>Rascunho — quando terminar, clique em <b>Concluir cotação</b>. Desconto acima de {fmtQtd(descontoLivre)}% vai para {gerente ?? 'o gerente'} aprovar.</> })
  if (status === 'aguardando_aprovacao') linhas.push({ cor: 'border-amber-700/50 bg-amber-900/20 text-amber-200', texto: <>Aguardando {gerente ?? 'o gerente'} aprovar {fmtQtd(c.maiorDescontoPct)}% de desconto.</> })
  if (status === 'aprovada') linhas.push({ cor: 'border-sky-700/50 bg-sky-900/20 text-sky-200', texto: <>Pronta para enviar ao cliente{c.aprovadorNome ? <> — desconto aprovado por <b>{c.aprovadorNome}</b></> : ''}. Mande o PDF e clique em <b>Marquei como enviada</b>.</> })
  if (status === 'enviada')
    linhas.push({
      cor: c.vencida ? 'border-orange-700/50 bg-orange-900/20 text-orange-200' : 'border-indigo-700/50 bg-indigo-900/20 text-indigo-200',
      texto: c.vencida ? <>Venceu em {dataBr(c.validaAte)}. Reabra para atualizar preços ou clique em <b>Reenviei</b> para renovar até o fim deste mês.</> : <>Enviada ao cliente em {dataBr(c.enviadaClienteEm)} — vale até <b>{dataBr(c.validaAte)}</b>.</>,
    })
  if (status === 'ganha') {
    const aceitos = c.itens.filter((i) => i.aceito)
    const valor = aceitos.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0)
    linhas.push({
      cor: 'border-green-700/50 bg-green-900/20 text-green-200',
      texto: (
        <>
          Cliente aprovou {aceitos.length === c.itens.length ? 'todos os itens' : `${aceitos.length} de ${c.itens.length} itens`} — <b>{formatarMoeda(valor)}</b>.{' '}
          {c.sapPedidoNum ? (
            <>Pedido de venda <b>nº {c.sapPedidoNum}</b> criado no SAP — a venda entra no card (Fechado) sozinha e o picking pode ser gerado na Expedição.</>
          ) : (
            <>Clique em <b>Gerar pedido no SAP</b>.</>
          )}
        </>
      ),
    })
  }
  if (status === 'perdida') linhas.push({ cor: 'border-red-700/50 bg-red-900/20 text-red-200', texto: <>Perdida — <b>{c.motivoPerda}</b>{c.motivoPerdaObs ? `: ${c.motivoPerdaObs}` : ''}.</> })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-dark-300">
        <span className="font-semibold text-dark-100">Cotação nº {c.id}</span>
        <ChipStatus status={status} vencida={c.vencida} />
        <span className="text-xs text-dark-500">vendedor: {c.vendedorNome}</span>
        {c.sapDocNum && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-teal-900/40 text-teal-200">Cotação SAP nº {c.sapDocNum}</span>}
        {c.sapPedidoNum && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-green-900/40 text-green-200">Pedido SAP nº {c.sapPedidoNum}</span>}
      </div>
      {linhas.map((l, n) => (
        <div key={n} className={`rounded-xl border px-4 py-2.5 text-sm ${l.cor}`}>
          {l.texto}
        </div>
      ))}
    </div>
  )
}

function ModalPerder({ motivos, carregando, onFechar, onConfirmar }: { motivos: readonly string[]; carregando: boolean; onFechar: () => void; onConfirmar: (motivo: string, obs: string | null) => void }) {
  const [motivo, setMotivo] = useState<string>('')
  const [obs, setObs] = useState('')
  return (
    <Modal open onClose={onFechar} title="Marcar como perdida">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {motivos.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMotivo(m)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${motivo === m ? 'border-red-500 bg-red-900/30 text-red-200' : 'border-dark-600 text-dark-200 hover:bg-dark-800'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <textarea rows={2} className="w-full rounded-xl bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100" placeholder={motivo === 'Outro' ? 'Conte o motivo (obrigatório)' : 'Detalhe (opcional): ex. concorrente e preço que ele ofereceu'} value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={carregando} disabled={!motivo || (motivo === 'Outro' && !obs.trim())} onClick={() => onConfirmar(motivo, obs.trim() || null)}>
            Marcar perdida
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ModalTexto({ titulo, rotulo, botao, carregando, onFechar, onConfirmar }: { titulo: string; rotulo: string; botao: string; carregando: boolean; onFechar: () => void; onConfirmar: (texto: string) => void }) {
  const [texto, setTexto] = useState('')
  return (
    <Modal open onClose={onFechar} title={titulo}>
      <div className="space-y-3">
        <p className="text-sm text-dark-300">{rotulo}</p>
        <textarea autoFocus rows={3} className="w-full rounded-xl bg-dark-900 border border-dark-600 px-3 py-2 text-sm text-dark-100" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={carregando} disabled={texto.trim().length < 3} onClick={() => onConfirmar(texto.trim())}>
            {botao}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Pedido parcial: o vendedor desmarca o que o cliente não quis.
function ModalGanhar({ itens, carregando, onFechar, onConfirmar }: { itens: Cotacao['itens']; carregando: boolean; onFechar: () => void; onConfirmar: (ids: number[]) => void }) {
  const [marcados, setMarcados] = useState<Set<number>>(() => new Set(itens.map((i) => i.id)))
  const valor = itens.filter((i) => marcados.has(i.id)).reduce((s, i) => s + i.precoUnitario * i.quantidade, 0)
  return (
    <Modal open onClose={onFechar} title="Cliente aprovou — quais itens?">
      <div className="space-y-3">
        <p className="text-sm text-dark-300">Desmarque o que o cliente não quis. Só os marcados vão para o pedido.</p>
        <div className="max-h-80 overflow-y-auto rounded-xl border border-dark-600 divide-y divide-dark-700">
          {itens.map((i) => (
            <label key={i.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-dark-800">
              <input
                type="checkbox"
                checked={marcados.has(i.id)}
                onChange={(e) => setMarcados((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n })}
              />
              <span className="flex-1 min-w-0 text-sm text-dark-100 break-words">{i.nome}</span>
              <span className="text-xs text-dark-400 whitespace-nowrap">
                {fmtQtd(i.quantidade)} × {formatarMoeda(i.precoUnitario)}
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-dark-300">
            {marcados.size} de {itens.length} itens · <b className="text-gold-300">{formatarMoeda(valor)}</b>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onFechar}>
              Cancelar
            </Button>
            <Button loading={carregando} disabled={!marcados.size} onClick={() => onConfirmar([...marcados])}>
              Confirmar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Foto do produto (módulo Fotos dos produtos). Clique abre grande; admin com
// Cotações troca a foto ali mesmo (substitui a do catálogo).
function FotoProduto({ codigo, nome, foto, tamanho }: { codigo: string; nome: string; foto: string | null; tamanho: string }) {
  const [aberta, setAberta] = useState(false)
  const [falhou, setFalhou] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        title="Ver foto"
        className={`${tamanho} shrink-0 overflow-hidden rounded-lg bg-white/95 ring-1 ring-dark-600 flex items-center justify-center hover:ring-gold-500`}
      >
        {foto && !falhou ? (
          <img src={foto} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setFalhou(true)} />
        ) : (
          <Package className="h-5 w-5 text-dark-500" />
        )}
      </button>
      {aberta && <ModalFoto codigo={codigo} nome={nome} foto={falhou ? null : foto} onFechar={() => setAberta(false)} />}
    </>
  )
}

function ModalFoto({ codigo, nome, foto, onFechar }: { codigo: string; nome: string; foto: string | null; onFechar: () => void }) {
  const utils = trpc.useUtils()
  const { data: ctx } = trpc.cotacoesCrm.contexto.useQuery()
  const [enviando, setEnviando] = useState(false)
  const trocar = async (arquivo: File) => {
    setEnviando(true)
    try {
      const form = new FormData()
      form.append('file', arquivo)
      const r = await fetch(`/upload/foto-produto/${encodeURIComponent(codigo)}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('odin_token')}` }, body: form })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `erro ${r.status}`)
      toast.success('Foto trocada')
      utils.cotacoesCrm.catalogo.invalidate()
      onFechar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Modal open onClose={onFechar} title={nome}>
      <div className="space-y-3">
        <div className="flex h-72 items-center justify-center rounded-xl bg-white">
          {foto ? <img src={foto} alt={nome} className="max-h-full max-w-full object-contain" /> : <p className="text-sm text-dark-600">Sem foto ainda</p>}
        </div>
        <p className="text-xs text-dark-400">{codigo}</p>
        {ctx?.podeConfigurar && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dark-600 px-3 py-2 text-sm text-dark-100 hover:bg-dark-800">
            {enviando ? 'Enviando…' : foto ? 'Trocar foto' : 'Colocar foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={enviando} onChange={(e) => e.target.files?.[0] && trocar(e.target.files[0])} />
          </label>
        )}
      </div>
    </Modal>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-dark-400">{rotulo}</span>
      {children}
    </label>
  )
}

// Campo numérico em formato BR ("1,5"): aplica enquanto digita (sem esperar
// sair do campo), deixa apagar pra digitar de novo, e volta pro valor certo
// quando ele muda por fora (botões + e −).
function CampoNumero({ valor, onValor, valido, vazioVale, className, placeholder, disabled }: { valor: number; onValor: (n: number) => void; valido: (n: number) => boolean; vazioVale?: number; className?: string; placeholder?: string; disabled?: boolean }) {
  const mostrar = (n: number) => (vazioVale !== undefined && n === vazioVale ? '' : fmtQtd(n))
  const [texto, setTexto] = useState(mostrar(valor))
  useEffect(() => {
    const atual = texto.trim() === '' ? vazioVale : numero(texto)
    if (atual !== valor) setTexto(mostrar(valor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])
  return (
    <input
      disabled={disabled}
      inputMode="decimal"
      placeholder={placeholder}
      className={`${className ?? ''} ${(() => { const n = texto.trim() === '' ? vazioVale : numero(texto); return n === undefined || Number.isNaN(n) || !valido(n) ? 'text-red-400' : '' })()}`}
      value={texto}
      onChange={(e) => {
        const bruto = e.target.value.replace(/[^\d.,]/g, '')
        setTexto(bruto)
        const n = bruto.trim() === '' ? vazioVale : numero(bruto)
        if (n !== undefined && !Number.isNaN(n) && valido(n)) onValor(n)
      }}
      onBlur={() => setTexto(mostrar(valor))}
    />
  )
}

function Catalogo({ catalogo, carregando, naCotacao, onAdicionar }: { catalogo?: ItemCatalogo[]; carregando: boolean; naCotacao: Set<string>; onAdicionar?: (novos: { codigo: string; qtd: number }[]) => void }) {
  const [busca, setBusca] = useState('')
  // Seleção múltipla: código → quantidade digitada (como no Portal One).
  const [selecao, setSelecao] = useState<Map<string, number>>(new Map())
  const [qtds, setQtds] = useState<Map<string, number>>(new Map())
  const qtdDe = (codigo: string) => qtds.get(codigo) ?? 1
  const marcar = (codigo: string, sim: boolean) =>
    setSelecao((s) => {
      const n = new Map(s)
      if (sim) n.set(codigo, qtdDe(codigo))
      else n.delete(codigo)
      return n
    })
  const adicionarSelecionados = () => {
    onAdicionar?.([...selecao].map(([codigo, qtd]) => ({ codigo, qtd })))
    setSelecao(new Map())
    setQtds(new Map())
  }
  const [soComEstoque, setSoComEstoque] = useState(true)
  // Cada termo precisa ser o COMEÇO de alguma palavra do nome/grupo ("ar"
  // acha "AR", não "pARa"), ou estar dentro de um código. Nome que começa
  // com o 1º termo vem primeiro.
  const indice = useMemo(
    () =>
      (catalogo ?? []).map((i) => ({
        i,
        palavras: normalizar(`${i.nome} ${i.grupo ?? ''}`).split(/[^a-z0-9]+/).filter(Boolean),
        codigos: normalizar(`${i.codigo} ${i.codigoAntigo ?? ''}`),
        nome: normalizar(i.nome),
      })),
    [catalogo]
  )
  const resultados = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean)
    const achados = indice.filter(
      ({ i, palavras, codigos }) => (!soComEstoque || i.estoque > 0) && termos.every((t) => codigos.includes(t) || palavras.some((p) => p.startsWith(t)))
    )
    if (termos.length) achados.sort((a, b) => Number(b.nome.startsWith(termos[0])) - Number(a.nome.startsWith(termos[0])))
    return achados.slice(0, 80).map((x) => x.i)
  }, [indice, busca, soComEstoque])

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden flex flex-col lg:max-h-[calc(100vh-9rem)] lg:sticky lg:top-4">
      <div className="p-3 border-b border-dark-700 space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-dark-600 bg-dark-900 px-3 focus-within:border-gold-600">
          <Search className="h-4 w-4 text-dark-400 shrink-0" />
          <input
            autoFocus
            className="w-full bg-transparent py-2.5 text-sm text-dark-100 outline-none"
            placeholder="Buscar produto: nome, código, código antigo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => { const r = resultados.find((x) => x.preco != null && x.estoque > 0); if (e.key === 'Enter' && r) onAdicionar?.([{ codigo: r.codigo, qtd: 1 }]) }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-dark-400">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={soComEstoque} onChange={(e) => setSoComEstoque(e.target.checked)} /> Só com estoque
          </label>
          <span>{carregando ? 'Carregando catálogo…' : `${catalogo?.length ?? 0} produtos`}</span>
        </div>
      </div>
      <div className="overflow-y-auto divide-y divide-dark-700">
        {carregando ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="h-14 rounded-xl bg-dark-700/50 animate-pulse" />
            ))}
          </div>
        ) : !resultados.length ? (
          <p className="p-6 text-center text-sm text-dark-400">{catalogo?.length ? 'Nada encontrado com essa busca.' : 'Catálogo ainda não copiado do SAP — peça a um admin para clicar em “Atualizar catálogo”.'}</p>
        ) : (
          resultados.map((i) => {
            const dentro = naCotacao.has(i.codigo)
            return (
              <div key={i.codigo} className={`flex items-center gap-3 px-3 py-2.5 ${selecao.has(i.codigo) ? 'bg-gold-900/20' : dentro ? 'bg-gold-900/10' : 'hover:bg-dark-700/30'}`}>
                {onAdicionar && (
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${i.nome}`}
                    disabled={i.preco == null || i.estoque <= 0}
                    checked={selecao.has(i.codigo)}
                    onChange={(e) => marcar(i.codigo, e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-sky-500"
                  />
                )}
                <FotoProduto codigo={i.codigo} nome={i.nome} foto={i.foto} tamanho="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-dark-100 leading-snug break-words">{i.nome}</p>
                  <p className="text-[11px] text-dark-500">
                    {i.codigo}
                    {i.codigoAntigo && ` · ${i.codigoAntigo}`}
                    {i.grupo && ` · ${i.grupo}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-dark-50">{i.preco != null ? formatarMoeda(i.preco) : '—'}</p>
                  <p className={`text-[11px] ${i.estoque > 10 ? 'text-green-400' : i.estoque > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {i.estoque > 0 ? `${fmtQtd(i.estoque)} ${i.unidade ?? ''} disponível` : 'sem estoque'}
                  </p>
                </div>
                {onAdicionar && i.preco != null && i.estoque > 0 && (
                  <CampoNumero
                    className="w-14 shrink-0 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-center text-sm text-dark-100 outline-none"
                    valor={qtdDe(i.codigo)}
                    valido={(n) => n > 0 && n <= i.estoque}
                    onValor={(n) => {
                      setQtds((m) => new Map(m).set(i.codigo, n))
                      setSelecao((s) => (s.has(i.codigo) ? new Map(s).set(i.codigo, n) : s))
                    }}
                  />
                )}
                {onAdicionar && (
                  <button
                    type="button"
                    aria-label={`Adicionar ${i.nome}`}
                    title={i.preco == null ? 'Sem preço no SAP — não dá pra cotar' : i.estoque <= 0 ? 'Sem estoque — não dá pra cotar' : undefined}
                    disabled={i.preco == null || i.estoque <= 0}
                    onClick={() => {
                      onAdicionar([{ codigo: i.codigo, qtd: qtdDe(i.codigo) }])
                      setQtds((m) => { const n = new Map(m); n.delete(i.codigo); return n })
                      marcar(i.codigo, false)
                    }}
                    className="h-9 w-9 shrink-0 rounded-lg bg-gold-600 hover:bg-gold-500 text-white flex items-center justify-center transition-transform active:scale-95 disabled:bg-dark-700 disabled:text-dark-500 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      {selecao.size > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-dark-700 bg-dark-900 px-3 py-2.5">
          <span className="text-sm text-dark-200">
            {selecao.size} {selecao.size === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSelecao(new Map())}>
              Limpar
            </Button>
            <Button size="sm" onClick={adicionarSelecionados}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar à cotação
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function BuscaCliente({ onEscolher }: { onEscolher: (c: ClienteBusca) => void }) {
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 250)
    return () => clearTimeout(t)
  }, [busca])
  const { data, isFetching } = trpc.cotacoesCrm.clientes.useQuery({ busca: termo }, { enabled: termo.length >= 2 })
  return (
    <div className="space-y-2">
      <p className="text-xs text-dark-400">Cliente</p>
      <div className="flex items-center gap-2 rounded-xl border border-dark-600 bg-dark-900 px-3 focus-within:border-gold-600">
        <User className="h-4 w-4 text-dark-400 shrink-0" />
        <input className="w-full bg-transparent py-2.5 text-sm text-dark-100 outline-none" placeholder="Nome, fantasia, código (novo ou antigo), CNPJ ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {termo.length >= 2 && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-dark-600 divide-y divide-dark-700">
          {isFetching && !data ? (
            <p className="p-3 text-xs text-dark-400">Buscando…</p>
          ) : !data?.length ? (
            <p className="p-3 text-xs text-dark-400">Nenhum cliente da sua carteira com essa busca.</p>
          ) : (
            data.map((c) => (
              <button key={c.id} type="button" onClick={() => onEscolher(c)} className="w-full text-left px-3 py-2 hover:bg-dark-700/40">
                <p className="text-sm text-dark-100 break-words">
                  {c.nome}
                  {c.bloqueado && <span className="ml-2 text-[10px] font-semibold rounded bg-red-900/40 text-red-300 px-1.5 py-0.5">bloqueado no SAP</span>}
                </p>
                <p className="text-[11px] text-dark-500">
                  {c.codigo}
                  {c.codigoAntigo && ` · antigo ${c.codigoAntigo}`}
                  {c.nomeFantasia && c.nomeFantasia !== c.nome && ` · ${c.nomeFantasia}`}
                  {c.cidade && ` · ${c.cidade}${c.estado ? `/${c.estado}` : ''}`}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
