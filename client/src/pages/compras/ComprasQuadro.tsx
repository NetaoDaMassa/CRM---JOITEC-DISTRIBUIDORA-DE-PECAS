import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { KanbanSquare, Search, AlertTriangle, Clock } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { textoContem } from '../../lib/utils'
import Select from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import ComoUsar from '../../components/ui/ComoUsar'
import { PrioridadeBadge, TipoBadge } from '../../components/compras/ui'
import { ETAPA_INFO, dataBr, useBaseCompras, type EtapaCompra } from '../../lib/comprasShared'
import { formatarMoeda } from '../../lib/moeda'
import { usePersistedState } from '../../lib/usePersistedState'

const COLUNAS: EtapaCompra[] = ['solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido', 'recebimento', 'finalizado']

// Quadro do Compras: todas as compras do grupo, uma coluna por etapa.
// Clicar no card abre a compra, onde ficam os botões de cada etapa.
export default function ComprasQuadro() {
  const base = useBaseCompras()
  const [empresaId, setEmpresaId] = usePersistedState<number | ''>('compras:quadro:empresa', '')
  const [tipo, setTipo] = usePersistedState<'' | 'revenda' | 'uso_consumo'>('compras:quadro:tipo', '')
  const [busca, setBusca] = useState('')
  const [verEncerradas, setVerEncerradas] = useState(false)
  const { data: aux } = trpc.comprasProcesso.auxiliares.useQuery()
  const { data: lista, isLoading } = trpc.comprasProcesso.listar.useQuery({ empresaId: empresaId || undefined, tipo: tipo || undefined })

  const filtradas = useMemo(
    () => (lista ?? []).filter((c) => !busca || textoContem(`${c.id} ${c.titulo} ${c.resumoItens} ${c.solicitanteNome} ${c.fornecedorNome ?? ''} ${c.numeroPedido ?? ''}`, busca)),
    [lista, busca]
  )
  const encerradas = filtradas.filter((c) => c.etapa === 'reprovado' || c.etapa === 'cancelado')

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <KanbanSquare size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Compras — quadro</h1>
          <p className="text-sm text-dark-400">Todas as compras do grupo, por etapa. Clique numa compra pra cotar, negociar, emitir pedido ou receber.</p>
        </div>
      </div>

      <ComoUsar
        chave="compras_quadro"
        titulo="Passo a passo do comprador"
        passos={[
          <><b>Solicitação</b>: abra a compra e clique em <b>Começar cotação</b> (ou já lance uma cotação).</>,
          <><b>Cotação</b>: lance o preço de cada fornecedor (dá pra anexar o PDF/print do orçamento).</>,
          <><b>Negociação</b>: registre o preço negociado, escolha o vencedor e <b>mande pra aprovação</b>.</>,
          <><b>Pedido de compra</b>: depois de aprovada, informe nº do pedido e previsão de entrega.</>,
          <><b>Recebimento</b>: quando chegar, confira os itens e informe a nota — se veio completo, a compra é <b>finalizada</b>.</>,
        ]}
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-64">
          <Input icon={<Search size={15} />} placeholder="Buscar compra, item, fornecedor..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="w-full sm:w-56">
          <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value ? Number(e.target.value) : '')} options={(aux?.empresas ?? []).map((e) => ({ value: e.id, label: e.nome }))} placeholder="Todas as empresas" />
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as '' | 'revenda' | 'uso_consumo')}
            options={[
              { value: 'revenda', label: 'Revenda' },
              { value: 'uso_consumo', label: 'Uso e Consumo' },
            ]}
            placeholder="Revenda e Uso/Consumo"
          />
        </div>
        {encerradas.length > 0 && (
          <button type="button" onClick={() => setVerEncerradas((v) => !v)} className="text-xs text-dark-400 hover:text-dark-200 underline underline-offset-2 h-9">
            {verEncerradas ? 'Esconder' : 'Ver'} reprovadas/canceladas ({encerradas.length})
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-dark-400 text-sm">Carregando...</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
          {[...COLUNAS, ...(verEncerradas ? (['reprovado', 'cancelado'] as EtapaCompra[]) : [])].map((etapa) => {
            const cards = filtradas.filter((c) => c.etapa === etapa)
            const info = ETAPA_INFO[etapa]
            const total = cards.reduce((t, c) => t + (c.valorFinal ?? c.menorCotacao ?? c.valorEstimado ?? 0), 0)
            return (
              <div key={etapa} className="w-72 shrink-0 bg-dark-900/50 border border-dark-700 rounded-2xl flex flex-col max-h-[calc(100vh-260px)] min-h-48">
                <div className="px-3 pt-3 pb-2 border-b border-dark-700">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold flex items-center gap-2" style={{ color: info.cor }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: info.cor }} />
                      {info.label}
                      <span className="text-dark-400 font-normal">{cards.length}</span>
                    </p>
                    {total > 0 && <span className="text-xs text-dark-400">{formatarMoeda(total, { casas: 0 })}</span>}
                  </div>
                  <p className="text-[11px] text-dark-500 mt-0.5">{etapa === 'finalizado' ? 'Últimos 30 dias' : info.ajuda}</p>
                </div>
                <div className="p-2 space-y-2 overflow-y-auto flex-1">
                  {cards.map((c) => (
                    <Link key={c.id} to={`${base}/compras/${c.id}`} className="block rounded-xl bg-dark-800 border border-dark-600 hover:border-dark-400 p-3 transition-colors" style={{ borderLeft: `3px solid ${info.cor}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-dark-50 font-medium leading-snug">
                          <span className="text-dark-500 font-normal">#{c.id} </span>
                          {c.titulo}
                        </p>
                      </div>
                      <p className="text-xs text-dark-400 mt-0.5 truncate">{c.empresaNome} · {c.solicitanteNome}</p>
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        <TipoBadge tipo={c.tipo} />
                        <PrioridadeBadge prioridade={c.prioridade} />
                        {c.entregaAtrasada && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-1.5 py-0.5">
                            <AlertTriangle size={11} /> Atrasada {c.diasAtraso}d
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                        <span className="text-dark-300 truncate">
                          {c.valorFinal != null
                            ? `${formatarMoeda(c.valorFinal)}${c.fornecedorNome ? ` · ${c.fornecedorNome}` : ''}`
                            : c.qtdCotacoes
                              ? `${c.qtdCotacoes} cotaç${c.qtdCotacoes === 1 ? 'ão' : 'ões'} · menor ${formatarMoeda(c.menorCotacao)}`
                              : `${c.qtdItens} ${c.qtdItens === 1 ? 'item' : 'itens'}`}
                        </span>
                        {!['finalizado', 'reprovado', 'cancelado'].includes(c.etapa) && (
                          <span className={`inline-flex items-center gap-0.5 shrink-0 ${c.diasNaEtapa >= 3 ? 'text-amber-400' : 'text-dark-500'}`} title="Dias nesta etapa">
                            <Clock size={11} /> {c.diasNaEtapa}d
                          </span>
                        )}
                      </div>
                      {c.etapa === 'recebimento' && c.previsaoEntrega && <p className="text-[11px] text-dark-500 mt-1">Pedido {c.numeroPedido} · entrega {dataBr(c.previsaoEntrega)}</p>}
                    </Link>
                  ))}
                  {!cards.length && <p className="text-xs text-dark-500 text-center py-4">Nada aqui</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
