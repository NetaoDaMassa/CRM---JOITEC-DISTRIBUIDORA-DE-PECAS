import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, Undo2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/utils'
import { formatarMoeda } from '../../lib/moeda'

// Adiantamento PIX (financeiro, 2026-11-13): todas as vendas à vista e
// entrada + boleto da Joitec, Odin Tubos e Odin Automação. O vendedor anexa o
// comprovante no card do cliente; aqui o financeiro confere.

const TIPO_LABEL: Record<string, string> = { avista: 'À vista / PIX', entrada_boleto: 'Entrada + boleto' }

function urlArquivo(path: string) {
  return path.startsWith('/') || path.startsWith('http') ? path : `/uploads/${path}`
}

function Lista({ aba }: { aba: 'conferir' | 'conferido' }) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.adiantamentoPix.listar.useQuery({ aba })
  const [busca, setBusca] = useState('')
  const recarregar = () => {
    utils.adiantamentoPix.listar.invalidate()
    utils.adiantamentoPix.contagem.invalidate()
  }
  const conferir = trpc.adiantamentoPix.conferir.useMutation({ onSuccess: () => (toast.success('Conferido'), recarregar()), onError: (e) => toast.error(e.message) })
  const desfazer = trpc.adiantamentoPix.desfazerConferencia.useMutation({ onSuccess: () => (toast.success('Voltou para À conferir'), recarregar()), onError: (e) => toast.error(e.message) })

  const q = busca.trim().toLowerCase()
  const lista = (data ?? []).filter(
    (l) => !q || [l.clienteNome, l.clienteCodigo, l.vendedorNome, l.numeroPedido, l.empresaNome].some((x) => (x ?? '').toLowerCase().includes(q))
  )

  return (
    <div className="space-y-3">
      <Input placeholder="Buscar cliente, pedido, vendedor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {isLoading && <p className="text-sm text-dark-400">Carregando…</p>}
      {!isLoading && lista.length === 0 && (
        <p className="text-sm text-dark-400">{aba === 'conferir' ? 'Nada para conferir.' : 'Nenhum comprovante conferido ainda.'}</p>
      )}
      <div className="space-y-2">
        {lista.map((l) => (
          <div
            key={l.vendaId}
            className={`rounded-xl border p-3 bg-dark-800 ${l.status === 'aguardando' ? 'border-amber-700/50' : l.status === 'anexado' ? 'border-sky-700/50' : 'border-dark-600'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark-100">
                  {l.clienteNome}
                  {l.numeroPedido && <span className="text-dark-400"> · pedido {l.numeroPedido}</span>}
                </p>
                <p className="text-xs text-dark-400">
                  {l.empresaNome} · 👤 {l.vendedorNome} · venda em {formatDateTime(l.dataFechamento)}
                </p>
                <p className="text-xs text-dark-300 mt-0.5">
                  <span className="font-semibold text-dark-100">{formatarMoeda(l.valor)}</span> · {l.condicaoPagamento} ·{' '}
                  <span className="text-gold-400">{TIPO_LABEL[l.tipo ?? ''] ?? l.tipo}</span>
                  {l.numeroNotaFiscal && <> · NF {l.numeroNotaFiscal}</>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {l.status === 'aguardando' && (
                  <span className="text-[11px] font-bold rounded-lg px-2 py-1 border text-amber-200 bg-amber-900/30 border-amber-600/60">⏳ AGUARDANDO COMPROVANTE DO VENDEDOR</span>
                )}
                {l.status === 'anexado' && l.comprovantePath && (
                  <>
                    <a href={urlArquivo(l.comprovantePath)} target="_blank" rel="noreferrer" className="text-sm text-sky-300 hover:underline">
                      📎 Ver comprovante
                    </a>
                    <span className="text-[11px] text-dark-500">anexado {l.anexadoEm ? formatDateTime(l.anexadoEm) : ''}</span>
                    <Button size="sm" onClick={() => conferir.mutate({ vendaId: l.vendaId })} disabled={conferir.isPending}>
                      <Check size={14} className="mr-1" /> Conferido
                    </Button>
                  </>
                )}
                {l.status === 'conferido' && (
                  <>
                    {l.comprovantePath && (
                      <a href={urlArquivo(l.comprovantePath)} target="_blank" rel="noreferrer" className="text-sm text-sky-300 hover:underline">
                        📎 Ver comprovante
                      </a>
                    )}
                    <span className="text-[11px] text-green-400">
                      ✓ conferido {l.conferidoEm ? formatDateTime(l.conferidoEm) : ''} {l.conferidoPor ? `por ${l.conferidoPor}` : ''}
                    </span>
                    <button className="text-[11px] text-dark-500 hover:text-dark-200 inline-flex items-center gap-1" onClick={() => desfazer.mutate({ vendaId: l.vendaId })}>
                      <Undo2 size={12} /> desfazer
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Palavras({ titulo, valores, onMudar }: { titulo: string; valores: string[]; onMudar: (v: string[]) => void }) {
  const [nova, setNova] = useState('')
  const adicionar = () => {
    const v = nova.trim()
    if (v && !valores.includes(v)) onMudar([...valores, v])
    setNova('')
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-dark-100">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {valores.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-dark-700 px-2.5 py-1 text-xs text-dark-100">
            {v}
            <button aria-label={`Tirar ${v}`} onClick={() => onMudar(valores.filter((x) => x !== v))} className="text-dark-400 hover:text-red-400">
              <X size={12} />
            </button>
          </span>
        ))}
        {valores.length === 0 && <span className="text-xs text-dark-500">nenhuma</span>}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Palavra (ex.: vista)" value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
        <Button size="sm" variant="secondary" onClick={adicionar}>
          Adicionar
        </Button>
      </div>
    </div>
  )
}

function Configuracao() {
  const utils = trpc.useUtils()
  const { data } = trpc.adiantamentoPix.configuracao.useQuery()
  const [avista, setAvista] = useState<string[]>([])
  const [entrada, setEntrada] = useState<string[]>([])
  const [desde, setDesde] = useState('')
  useEffect(() => {
    if (!data) return
    setAvista(data.regra.avista)
    setEntrada(data.regra.entrada)
    setDesde(data.desde)
  }, [data])
  const salvar = trpc.adiantamentoPix.salvarConfiguracao.useMutation({
    onSuccess: () => {
      toast.success('Configuração salva')
      utils.adiantamentoPix.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  if (!data) return <p className="text-sm text-dark-400">Carregando…</p>
  return (
    <div className="space-y-5">
      <p className="text-sm text-dark-400">
        A venda entra no PIX quando a <b>condição de pagamento</b> dela tem uma destas palavras. Vale para Joitec, Odin Tubos e Odin Automação.
      </p>
      <Palavras titulo="À vista / PIX" valores={avista} onMudar={setAvista} />
      <Palavras titulo="Entrada + boleto" valores={entrada} onMudar={setEntrada} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-dark-100">Vale para vendas a partir de</p>
        <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="max-w-[12rem]" />
        <p className="text-xs text-dark-500">Vendas antes desse dia não pedem comprovante nem travam a expedição.</p>
      </div>
      <Button onClick={() => salvar.mutate({ avista, entrada, desde })} disabled={salvar.isPending || !desde}>
        Salvar
      </Button>
      {data.condicoesSap.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-dark-100">Condições do SAP — como ficam com a regra salva</p>
          <div className="rounded-xl border border-dark-700 divide-y divide-dark-700 max-h-80 overflow-y-auto">
            {data.condicoesSap.map((c) => (
              <div key={c.nome} className="flex justify-between px-3 py-1.5 text-sm">
                <span className="text-dark-200">{c.nome}</span>
                <span className={c.tipo ? 'text-gold-400' : 'text-dark-500'}>{c.tipo ? TIPO_LABEL[c.tipo] : 'não pede comprovante'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdiantamentoPix() {
  const [tab, setTab] = useState<'conferir' | 'conferido' | 'config'>('conferir')
  const { data: cont } = trpc.adiantamentoPix.contagem.useQuery()
  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="font-heading text-xl text-dark-50">Adiantamento PIX</h1>
        <p className="text-sm text-dark-400 mt-1">
          Vendas à vista e entrada + boleto da Joitec, Odin Tubos e Odin Automação. O vendedor anexa o comprovante do PIX no card do cliente. Sem ele, a NF e a expedição
          ficam travadas. Aqui o financeiro confere.
        </p>
      </div>
      <div className="flex gap-1 border-b border-dark-700">
        {(['conferir', 'conferido', 'config'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? 'border-gold-500 text-gold-400 font-medium' : 'border-transparent text-dark-400 hover:text-dark-200'}`}
          >
            {t === 'conferir' ? 'À conferir' : t === 'conferido' ? 'Conferido' : 'Configuração'}
            {t === 'conferir' && cont && (cont.aConferir > 0 || cont.aguardandoVendedor > 0) && (
              <span className="ml-1.5 text-[11px] text-dark-400">
                ({cont.aConferir} com comprovante · {cont.aguardandoVendedor} esperando vendedor)
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === 'conferir' && <Lista aba="conferir" />}
      {tab === 'conferido' && <Lista aba="conferido" />}
      {tab === 'config' && <Configuracao />}
    </div>
  )
}
