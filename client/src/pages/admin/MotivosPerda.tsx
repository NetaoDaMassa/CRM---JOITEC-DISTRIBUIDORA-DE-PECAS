import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Check, MessageSquare, Clock, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { ROTULO_CATEGORIA_PERDA, SETOR_DA_CATEGORIA } from '../../lib/motivosPerda'

// Tela Motivos de perda (João, 2026-11-25): cada setor vê as perdas que são
// com ele (Financeiro: crédito; Compras: falta de peça e prazo) e o gerente
// da empresa vê todas. Marca "visto" e comenta — o vendedor recebe o
// comentário como notificação.

const COR_CATEGORIA: Record<string, string> = {
  preco_concorrente: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  falta_peca: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  prazo_entrega: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  restricao_credito: 'bg-red-500/15 text-red-300 border-red-500/30',
  sem_retorno: 'bg-dark-600/40 text-dark-200 border-dark-500',
  cliente_final: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  adiou: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  cadastro_errado: 'bg-dark-700 text-dark-400 border-dark-600',
}

function mesAtual() {
  const d = new Date(Date.now() - 3 * 3600e3)
  return d.toISOString().slice(0, 7)
}

const brl = (v: number | null) => (v ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : null)

export default function MotivosPerda() {
  const utils = trpc.useUtils()
  const [mes, setMes] = useState(mesAtual())
  const [filtro, setFiltro] = useState<'nao_vistos' | 'todos' | 'reclassificar'>('nao_vistos')
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const { data, isLoading } = trpc.motivosPerda.listar.useQuery({ mes })

  const invalidar = () => {
    utils.motivosPerda.listar.invalidate()
    utils.motivosPerda.meuAcesso.invalidate()
  }
  const vistoMut = trpc.motivosPerda.marcarVisto.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })

  const perdas = data?.perdas ?? []
  const multiEmpresa = new Set(perdas.map((p) => p.empresaId)).size > 1

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return perdas.filter((p) => {
      if (filtro === 'nao_vistos' && (p.vistoEm || p.reclassificar || !p.podeMarcarVisto || p.categoria === 'cadastro_errado')) return false
      if (filtro === 'reclassificar' && !p.reclassificar) return false
      if (categoria && p.categoria !== categoria) return false
      if (b && !`${p.razaoSocial} ${p.vendedorNome} ${p.observacao ?? ''} ${p.item ?? ''} ${p.concorrente ?? ''}`.toLowerCase().includes(b)) return false
      return true
    })
  }, [perdas, filtro, categoria, busca])

  // Resumo (só perdas já com a categoria nova — as pendentes ainda estão na antiga).
  const resumo = useMemo(() => {
    const validas = perdas.filter((p) => !p.reclassificar && p.categoria !== 'cadastro_errado')
    const contar = (chave: (p: (typeof perdas)[number]) => string | null) => {
      const m = new Map<string, number>()
      for (const p of validas) {
        const k = chave(p)?.trim()
        if (k) m.set(k, (m.get(k) ?? 0) + 1)
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    const pendentesPorVendedor = new Map<string, number>()
    for (const p of perdas) if (p.reclassificar) pendentesPorVendedor.set(p.vendedorNome, (pendentesPorVendedor.get(p.vendedorNome) ?? 0) + 1)
    return {
      total: validas.length,
      valor: validas.reduce((s, p) => s + (p.valorOrcado ?? 0), 0),
      porCategoria: contar((p) => p.categoria),
      concorrentes: contar((p) => p.concorrente),
      itens: contar((p) => p.item),
      pendentes: [...pendentesPorVendedor.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [perdas])

  const acesso = data?.acesso
  const quemVe = acesso
    ? [acesso.tudo && 'todos os perdidos da empresa', acesso.financeiro && 'perdas por crédito (todas as empresas)', acesso.compras && 'falta de peça e prazo (todas as empresas)'].filter(Boolean).join(' + ')
    : ''

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl text-dark-50">Motivos de perda</h1>
          {quemVe && <p className="text-xs text-dark-400 mt-1">Você vê: {quemVe}.</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/painel-perdas" className="px-3 py-1.5 rounded-lg text-sm border border-gold-600/50 text-gold-300 hover:bg-gold-600/10">📊 Painel de perdas</Link>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-1.5" />
        </div>
      </div>

      {isLoading && <p className="text-dark-400 text-sm">Carregando...</p>}

      {data && (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-dark-600 bg-dark-800/60 p-4">
              <p className="text-xs text-dark-400">Perdas no mês (já classificadas)</p>
              <p className="text-2xl font-semibold text-dark-50 mt-1">{resumo.total}</p>
              {resumo.valor > 0 && <p className="text-xs text-dark-400 mt-1">{brl(resumo.valor)} orçados</p>}
            </div>
            <Ranking titulo="Por motivo" itens={resumo.porCategoria.map(([k, n]) => [ROTULO_CATEGORIA_PERDA[k] ?? k, n])} />
            <Ranking titulo="Perdemos pra quem" itens={resumo.concorrentes} vazio="Nenhum concorrente informado ainda." />
            <Ranking titulo="Itens que fizeram perder" itens={resumo.itens} vazio="Nenhum item informado ainda." />
          </div>

          {resumo.pendentes.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <p className="text-amber-300 font-medium flex items-center gap-2">
                <Clock size={16} /> Ainda não reclassificaram os perdidos de novembro:
              </p>
              <p className="text-amber-200/90 mt-1">{resumo.pendentes.map(([nome, n]) => `${nome} (${n})`).join(' · ')}</p>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                ['nao_vistos', 'Pra eu ver'],
                ['todos', 'Todos'],
                ['reclassificar', 'Aguardando vendedor'],
              ] as const
            ).map(([k, rot]) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${filtro === k ? 'bg-gold-600/20 border-gold-600/50 text-gold-300' : 'border-dark-600 text-dark-300 hover:text-dark-100'}`}
              >
                {rot}
              </button>
            ))}
            <div className="w-56">
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Todos os motivos" options={Object.entries(ROTULO_CATEGORIA_PERDA).map(([value, label]) => ({ value, label }))} />
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente, vendedor, item, concorrente ou texto..."
                className="w-full bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 pl-8 pr-3 py-2"
              />
            </div>
            <span className="text-xs text-dark-400">{lista.length} perdido(s)</span>
          </div>

          {lista.length === 0 && <p className="text-sm text-dark-400 py-6 text-center">{filtro === 'nao_vistos' ? 'Nada pendente pra você ver neste mês. 👍' : 'Nenhum perdido com esse filtro.'}</p>}

          <div className="space-y-3">
            {lista.map((p) => (
              <div key={p.id} className="rounded-xl border border-dark-600 bg-dark-800/60 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-dark-50 font-medium">{p.razaoSocial}</p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {p.vendedorNome}
                      {multiEmpresa && p.empresaNome ? ` · ${p.empresaNome}` : ''} · {new Date(p.data.replace(' ', 'T')).toLocaleDateString('pt-BR')}
                      {p.valorOrcado ? ` · ${brl(p.valorOrcado)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.reclassificar ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10">Aguardando vendedor reclassificar</span>
                    ) : (
                      p.categoria && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${COR_CATEGORIA[p.categoria] ?? 'border-dark-600 text-dark-300'}`}>
                          {ROTULO_CATEGORIA_PERDA[p.categoria] ?? p.categoria}
                          {SETOR_DA_CATEGORIA[p.categoria] ? ` → ${SETOR_DA_CATEGORIA[p.categoria] === 'financeiro' ? 'Financeiro' : 'Compras'}` : ''}
                        </span>
                      )
                    )}
                    {!p.reclassificar &&
                      (p.vistoEm ? (
                        <button
                          disabled={!p.podeMarcarVisto}
                          onClick={() => vistoMut.mutate({ id: p.id, visto: false })}
                          title={p.podeMarcarVisto ? 'Desmarcar visto' : undefined}
                          className="text-xs text-green-400 flex items-center gap-1 disabled:cursor-default"
                        >
                          <Check size={14} /> Visto por {p.vistoPorNome ?? '—'} em {new Date(p.vistoEm.replace(' ', 'T')).toLocaleDateString('pt-BR')}
                        </button>
                      ) : (
                        p.podeMarcarVisto && (
                          <Button size="sm" variant="secondary" title="Só registra que você viu — o vendedor não recebe nada" loading={vistoMut.isPending && vistoMut.variables?.id === p.id} onClick={() => vistoMut.mutate({ id: p.id, visto: true })}>
                            <Check size={14} className="mr-1" /> Marcar visto
                          </Button>
                        )
                      ))}
                  </div>
                </div>

                {(p.concorrente || p.item) && (
                  <p className="text-xs text-dark-300 mt-2">
                    {p.concorrente && (
                      <>
                        Perdeu pra: <b className="text-dark-100">{p.concorrente}</b>
                      </>
                    )}
                    {p.concorrente && p.item && ' · '}
                    {p.item && (
                      <>
                        Item: <b className="text-dark-100">{p.item}</b>
                      </>
                    )}
                  </p>
                )}
                <p className="text-sm text-dark-200 mt-2 whitespace-pre-line">{p.observacao || '—'}</p>
                {p.reclassificar && p.categoriaAntiga && <p className="text-[11px] text-dark-500 mt-1">Categoria antiga: {ROTULO_CATEGORIA_PERDA[p.categoriaAntiga] ?? p.categoriaAntiga}</p>}
                {!p.reclassificar && p.textoAntigo && p.textoAntigo !== p.observacao && (
                  <p className="text-[11px] text-dark-500 mt-1">Texto antes da reclassificação: “{p.textoAntigo}”</p>
                )}

                {p.historico.length > 0 && (
                  <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-1">
                    <p className="text-[11px] font-medium text-red-300">⚠ O motivo desta perda foi trocado {p.historico.length}x:</p>
                    {p.historico.map((h, i) => (
                      <p key={i} className="text-[11px] text-dark-300">
                        {new Date(h.em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por <b className="text-dark-100">{h.por}</b> — antes era
                        {h.categoriaAnterior ? ` (${ROTULO_CATEGORIA_PERDA[h.categoriaAnterior] ?? h.categoriaAnterior})` : ''}: “{h.textoAnterior ?? '—'}”
                      </p>
                    ))}
                  </div>
                )}

                <Comentarios id={p.id} comentarios={p.comentarios} onSalvo={invalidar} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Ranking({ titulo, itens, vazio }: { titulo: string; itens: [string, number][]; vazio?: string }) {
  const max = itens[0]?.[1] ?? 1
  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800/60 p-4">
      <p className="text-xs text-dark-400 mb-2">{titulo}</p>
      {itens.length === 0 && <p className="text-xs text-dark-500">{vazio ?? '—'}</p>}
      <div className="space-y-1.5">
        {itens.slice(0, 6).map(([rot, n]) => (
          <div key={rot}>
            <div className="flex justify-between text-xs text-dark-200">
              <span className="truncate pr-2">{rot}</span>
              <span className="font-medium">{n}</span>
            </div>
            <div className="h-1 rounded bg-dark-700 mt-0.5">
              <div className="h-1 rounded bg-gold-500" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Comentarios({ id, comentarios, onSalvo }: { id: number; comentarios: { id: number; texto: string; tipo: string; autor: string; createdAt: string }[]; onSalvo: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const mut = trpc.motivosPerda.comentar.useMutation({
    onSuccess() {
      setTexto('')
      toast.success('Comentário enviado — o vendedor recebe uma notificação.')
      onSalvo()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="mt-3 border-t border-dark-700 pt-2">
      {comentarios.map((c) => (
        <p key={c.id} className="text-xs text-dark-300 mt-1">
          <b className={c.tipo === 'complemento' ? 'text-sky-300' : 'text-dark-100'}>{c.tipo === 'complemento' ? `➕ ${c.autor} (vendedor) acrescentou` : c.autor}</b> <span className="text-dark-500">{new Date(c.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>: {c.texto}
        </p>
      ))}
      {aberto ? (
        <div className="flex gap-2 mt-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && texto.trim().length >= 3 && mut.mutate({ id, texto })}
            placeholder="Ex: o filtro chega dia 05/12, avise o cliente / liberamos 2x pra esse cliente..."
            className="flex-1 bg-dark-900 border border-dark-600 rounded-lg text-sm text-dark-100 px-3 py-1.5"
            autoFocus
          />
          <Button size="sm" loading={mut.isPending} disabled={texto.trim().length < 3} onClick={() => mut.mutate({ id, texto })}>
            Enviar
          </Button>
        </div>
      ) : (
        <button onClick={() => setAberto(true)} className="text-xs text-dark-400 hover:text-gold-300 flex items-center gap-1 mt-1">
          <MessageSquare size={12} /> Comentar pro vendedor
        </button>
      )}
    </div>
  )
}
