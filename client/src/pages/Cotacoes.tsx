import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, Plus, Minus, Trash2, Package, RefreshCw, Printer, Send, ArrowLeft, ShoppingCart, User } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'
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
type Linha = { itemCodigo: string; quantidade: number; descontoPct: number }

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Aceita "1,5" e "1.5" (lib/valorBr — já evitou o bug do ponto virar milhar).
const numero = (s: string) => parseValorBr(s)
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function Cotacoes() {
  const [aberta, setAberta] = useState<number | 'nova' | null>(null)
  return aberta === null ? <ListaCotacoes onAbrir={setAberta} /> : <EditorCotacao id={aberta === 'nova' ? null : aberta} onVoltar={() => setAberta(null)} onSalva={setAberta} />
}

function ListaCotacoes({ onAbrir }: { onAbrir: (id: number | 'nova') => void }) {
  const { data: ctx } = trpc.cotacoesCrm.contexto.useQuery()
  const { data: lista, isLoading, error } = trpc.cotacoesCrm.listar.useQuery()
  const utils = trpc.useUtils()
  const atualizar = trpc.cotacoesCrm.atualizarCatalogo.useMutation({
    onSuccess: (r) => {
      toast.success(r ? `Catálogo atualizado: ${r.itens} itens` : 'Catálogo já estava em dia')
      utils.cotacoesCrm.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark-50 flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-gold-400" /> Cotações
          </h1>
          <p className="text-sm text-dark-400">
            Catálogo e preços do SAP {ctx?.atualizadoEm ? `· atualizado ${timeAgo(`${ctx.atualizadoEm.replace(' ', 'T')}Z`)}` : '· ainda não copiado'}
          </p>
        </div>
        <div className="flex gap-2">
          {ctx?.veTudo && (
            <Button variant="secondary" loading={atualizar.isPending} onClick={() => atualizar.mutate()}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar catálogo
            </Button>
          )}
          <Button onClick={() => onAbrir('nova')}>
            <Plus className="h-4 w-4 mr-1.5" /> Nova cotação
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-300 bg-dark-800 border border-dark-600 rounded-2xl p-5">{error.message}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
      ) : !lista?.length ? (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-10 text-center space-y-3">
          <ShoppingCart className="h-10 w-10 mx-auto text-dark-500" />
          <p className="text-dark-200">Nenhuma cotação ainda.</p>
          <Button onClick={() => onAbrir('nova')}>Montar a primeira</Button>
        </div>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl divide-y divide-dark-700 overflow-hidden">
          {lista.map((c) => (
            <button key={c.id} type="button" onClick={() => onAbrir(c.id)} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-dark-700/40 transition-colors">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-semibold text-dark-100 break-words">{c.clienteNome}</p>
                <p className="text-xs text-dark-400">
                  {c.clienteCodigo} · {c.itens} {c.itens === 1 ? 'item' : 'itens'}
                  {ctx?.veTudo && ` · ${c.vendedorNome}`}
                </p>
              </div>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${c.status === 'enviada' ? 'bg-green-900/40 text-green-300' : 'bg-dark-700 text-dark-300'}`}>
                {c.status === 'enviada' ? `SAP nº ${c.sapDocNum}` : 'Rascunho'}
              </span>
              <span className="text-sm font-bold text-gold-300 w-32 text-right">{formatarMoeda(c.total)}</span>
              <span className="text-xs text-dark-500 w-24 text-right">{timeAgo(`${c.updatedAt.replace(' ', 'T')}Z`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    setLinhas(existente.itens.map((i) => ({ itemCodigo: i.itemCodigo, quantidade: i.quantidade, descontoPct: i.descontoPct })))
  }, [existente])

  const listaEfetiva = lista ?? ctx?.listaBase ?? 1
  const { data: catalogo, isLoading: carregandoCatalogo } = trpc.cotacoesCrm.catalogo.useQuery({ lista: listaEfetiva }, { staleTime: 5 * 60_000 })
  const porCodigo = useMemo(() => new Map((catalogo ?? []).map((i) => [i.codigo, i])), [catalogo])
  const somenteLeitura = existente != null && existente.status !== 'rascunho'

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
  const adicionar = (codigo: string) =>
    mexer((ls) => (ls.some((l) => l.itemCodigo === codigo) ? ls.map((l) => (l.itemCodigo === codigo ? { ...l, quantidade: l.quantidade + 1 } : l)) : [...ls, { itemCodigo: codigo, quantidade: 1, descontoPct: 0 }]))

  const calc = linhas.map((l) => {
    const item = porCodigo.get(l.itemCodigo)
    const tabela = item?.preco ?? null
    const unit = tabela != null ? tabela * (1 - l.descontoPct / 100) : null
    return { ...l, item, tabela, unit, subtotal: unit != null ? unit * l.quantidade : null }
  })
  const total = calc.reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const semPreco = calc.some((l) => l.tabela == null)

  const escolherCliente = (c: ClienteBusca) => {
    setCliente({ id: c.id, codigo: c.codigo, nome: c.nome, cidade: c.cidade, estado: c.estado })
    if (c.listaPreco) setLista(c.listaPreco)
    if (c.prazoCodigo != null) setPrazo(c.prazoCodigo)
    if (c.bloqueado) toast('Atenção: esse cliente está bloqueado/inativo no SAP', { icon: '⚠️' })
    setAlterado(true)
  }

  const onSalvar = () => {
    if (!cliente) return toast.error('Escolha o cliente')
    if (!linhas.length) return toast.error('Adicione pelo menos um item')
    salvar.mutate({ id: id ?? undefined, clienteId: cliente.id, listaPreco: listaEfetiva, prazoCodigo: prazo, observacao: observacao || null, itens: linhas })
  }

  const nomeLista = ctx?.listas.find((l) => l.numero === listaEfetiva)?.nome
  const nomePrazo = ctx?.prazos.find((p) => p.codigo === prazo)?.nome

  const imprimir = () => {
    if (!cliente || !linhas.length) return toast.error('Monte a cotação antes de imprimir')
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cotação - ${esc(cliente.nome)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}th{background:#f3f3f3}
.n{text-align:right;white-space:nowrap}.t{font-size:16px;font-weight:700;text-align:right;margin-top:12px}</style></head><body>
<h1>Cotação${id ? ` nº ${id}` : ''}</h1><p><b>Cliente:</b> ${esc(cliente.codigo)} - ${esc(cliente.nome)}</p>
<p><b>Prazo de pagamento:</b> ${esc(nomePrazo ?? '—')}</p><p><b>Data:</b> ${new Date().toLocaleDateString('pt-BR')}</p>
<table><thead><tr><th>Código</th><th>Produto</th><th class="n">Qtd</th><th class="n">Unitário</th><th class="n">Desc.</th><th class="n">Total</th></tr></thead><tbody>
${calc.map((l) => `<tr><td>${esc(l.itemCodigo)}</td><td>${esc(l.item?.nome ?? '')}</td><td class="n">${fmtQtd(l.quantidade)} ${esc(l.item?.unidade ?? '')}</td><td class="n">${formatarMoeda(l.unit)}</td><td class="n">${l.descontoPct ? `${l.descontoPct}%` : '—'}</td><td class="n">${formatarMoeda(l.subtotal)}</td></tr>`).join('')}
</tbody></table><p class="t">Total: ${formatarMoeda(total)}</p>${observacao ? `<p style="margin-top:12px"><b>Observação:</b> ${esc(observacao)}</p>` : ''}
<p style="margin-top:24px;color:#666;font-size:11px">Valores sem impostos (IPI/ST calculados na emissão). Sujeito a disponibilidade de estoque.</p>
<script>window.onload=()=>window.print()</script></body></html>`)
    w.document.close()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => (!alterado || confirm('Sair sem salvar as mudanças?')) && onVoltar()} className="inline-flex items-center gap-1.5 text-sm text-dark-300 hover:text-dark-100">
          <ArrowLeft className="h-4 w-4" /> Cotações
        </button>
        <div className="flex flex-wrap gap-2">
          {id != null && !somenteLeitura && (
            <Button variant="secondary" loading={excluir.isPending} onClick={() => confirm('Excluir esta cotação?') && excluir.mutate({ id })}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={imprimir}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
          </Button>
          <span title="Etapa 2: aguardando o usuário próprio do CRM e a base de teste do SAP">
            <Button variant="secondary" disabled>
              <Send className="h-4 w-4 mr-1.5" /> Enviar ao SAP (em breve)
            </Button>
          </span>
          {!somenteLeitura && (
            <Button loading={salvar.isPending} onClick={onSalvar}>
              Salvar{alterado ? ' *' : ''}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="order-2 lg:order-1 min-w-0">
        <Catalogo catalogo={catalogo} carregando={carregandoCatalogo} naCotacao={new Set(linhas.map((l) => l.itemCodigo))} onAdicionar={somenteLeitura ? undefined : adicionar} />
        </div>

        <div className="space-y-4 order-1 lg:order-2 min-w-0">
          <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4 space-y-3">
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
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-dark-400">Tabela de preço</span>
                <select disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-2 py-2 text-sm text-dark-100" value={listaEfetiva} onChange={(e) => (setLista(Number(e.target.value)), setAlterado(true))}>
                  {(ctx?.listas ?? []).map((l) => (
                    <option key={l.numero} value={l.numero}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-dark-400">Prazo de pagamento</span>
                <select disabled={somenteLeitura} className="w-full rounded-lg bg-dark-900 border border-dark-600 px-2 py-2 text-sm text-dark-100" value={prazo ?? ''} onChange={(e) => (setPrazo(e.target.value === '' ? null : Number(e.target.value)), setAlterado(true))}>
                  <option value="">Escolha…</option>
                  {(ctx?.prazos ?? []).map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
              <p className="text-sm font-semibold text-dark-100">Itens da cotação</p>
              <p className="text-xs text-dark-400">{nomeLista ? `Tabela ${nomeLista}` : ''}</p>
            </div>
            {!calc.length ? (
              <p className="px-4 py-8 text-center text-sm text-dark-400">Busque um produto ao lado e clique em + para adicionar.</p>
            ) : (
              <div className="divide-y divide-dark-700">
                {calc.map((l) => (
                  <div key={l.itemCodigo} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-dark-100 break-words">{l.item?.nome ?? l.itemCodigo}</p>
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
                          valido={(n) => n > 0}
                          onValor={(n) => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, quantidade: n } : x)))}
                        />
                        <button type="button" disabled={somenteLeitura} className="px-2 py-1.5 text-dark-300 hover:text-dark-100" onClick={() => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, quantidade: x.quantidade + 1 } : x)))}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-dark-400">
                        Desc.
                        <CampoNumero
                          disabled={somenteLeitura}
                          className="w-14 rounded-lg border border-dark-600 bg-dark-900 px-2 py-1.5 text-right text-sm text-dark-100 outline-none"
                          valor={l.descontoPct}
                          vazioVale={0}
                          placeholder="0"
                          valido={(n) => n >= 0 && n <= 100}
                          onValor={(n) => mexer((ls) => ls.map((x) => (x.itemCodigo === l.itemCodigo ? { ...x, descontoPct: n } : x)))}
                        />
                        %
                      </label>
                      <span className="ml-auto text-right">
                        <span className="block text-[11px] text-dark-500">{formatarMoeda(l.unit)} / {l.item?.unidade ?? 'un'}</span>
                        <span className="block text-sm font-semibold text-dark-50">{formatarMoeda(l.subtotal)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700 bg-dark-900/40">
              <span className="text-sm text-dark-300">
                Total {semPreco && <span className="text-amber-400">(há item sem preço)</span>}
              </span>
              <span className="text-xl font-bold text-gold-300">{formatarMoeda(total)}</span>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-dark-400">Observação</span>
            <textarea
              disabled={somenteLeitura}
              rows={3}
              className="w-full rounded-xl bg-dark-800 border border-dark-600 px-3 py-2 text-sm text-dark-100 outline-none focus:border-gold-600"
              value={observacao}
              onChange={(e) => (setObservacao(e.target.value), setAlterado(true))}
              placeholder="Frete, entrega, condição combinada…"
            />
          </label>
          <p className="text-[11px] text-dark-500">Valores sem impostos — IPI/ST o SAP calcula na emissão.</p>
        </div>
      </div>
    </div>
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

function Catalogo({ catalogo, carregando, naCotacao, onAdicionar }: { catalogo?: ItemCatalogo[]; carregando: boolean; naCotacao: Set<string>; onAdicionar?: (codigo: string) => void }) {
  const [busca, setBusca] = useState('')
  const [soComEstoque, setSoComEstoque] = useState(false)
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
            onKeyDown={(e) => { const r = resultados.find((x) => x.preco != null); if (e.key === 'Enter' && r) onAdicionar?.(r.codigo) }}
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
              <div key={i.codigo} className={`flex items-center gap-3 px-3 py-2.5 ${dentro ? 'bg-gold-900/10' : 'hover:bg-dark-700/30'}`}>
                {/* Foto do produto entra aqui (etapa das imagens). */}
                <div className="h-11 w-11 shrink-0 rounded-lg bg-dark-700 flex items-center justify-center">
                  <Package className="h-5 w-5 text-dark-500" />
                </div>
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
                    {i.estoque > 0 ? `${fmtQtd(i.estoque)} ${i.unidade ?? ''} em estoque` : 'sem estoque'}
                  </p>
                </div>
                {onAdicionar && (
                  <button
                    type="button"
                    aria-label={`Adicionar ${i.nome}`}
                    title={i.preco == null ? 'Sem preço no SAP — não dá pra cotar' : undefined}
                    disabled={i.preco == null}
                    onClick={() => onAdicionar(i.codigo)}
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
        <input className="w-full bg-transparent py-2.5 text-sm text-dark-100 outline-none" placeholder="Nome, código, CNPJ ou CPF do cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
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
