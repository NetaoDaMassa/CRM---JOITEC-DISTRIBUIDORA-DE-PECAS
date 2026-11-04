import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import {
  ArrowLeft, Plus, Pencil, Trash2, Paperclip, Trophy, CheckCircle2, XCircle, Undo2, Send, Handshake, PackageCheck, FileText, MessageSquare, Ban, Search, ShoppingCart,
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import { Input, Textarea } from '../../components/ui/Input'
import FormSolicitacao from '../../components/compras/FormSolicitacao'
import ModalFornecedor from '../../components/compras/ModalFornecedor'
import { EtapaBadge, PrioridadeBadge, TipoBadge, TrilhaEtapas } from '../../components/compras/ui'
import { ETAPA_INFO, dataBr, dataHoraBr, uploadAnexoCompra, useBaseCompras } from '../../lib/comprasShared'
import { formatarMoeda } from '../../lib/moeda'
import { parseValorBr, formatarValorInput } from '../../lib/valorBr'
import { hojeBrString } from '../../lib/utils'

type Compra = inferRouterOutputs<AppRouter>['comprasProcesso']['detalhe']
type Cotacao = Compra['cotacoes'][number]

const num = (v: string) => (v.trim() ? parseValorBr(v) : null)

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-dark-500">{rotulo}</p>
      <div className="text-sm text-dark-100 break-words">{children || '—'}</div>
    </div>
  )
}

function Bloco({ titulo, icone: Icone, acoes, children }: { titulo: string; icone?: typeof FileText; acoes?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-dark-800 border border-dark-600 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="font-heading text-dark-50 flex items-center gap-2">
          {Icone && <Icone size={16} className="text-gold-400" />}
          {titulo}
        </p>
        {acoes}
      </div>
      {children}
    </section>
  )
}

export default function CompraDetalhe() {
  const { id } = useParams()
  const base = useBaseCompras()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const compraId = Number(id)
  const { data: c, isLoading, error } = trpc.comprasProcesso.detalhe.useQuery({ id: compraId }, { enabled: Number.isFinite(compraId) })

  const [editando, setEditando] = useState(false)
  const [cotacaoAberta, setCotacaoAberta] = useState<Cotacao | 'nova' | null>(null)
  const [negociando, setNegociando] = useState<Cotacao | null>(null)
  const [motivo, setMotivo] = useState<null | { acao: 'reprovar' | 'devolver' | 'voltar' | 'cancelar'; titulo: string }>(null)

  const ok = (msg: string) => () => {
    toast.success(msg)
    utils.comprasProcesso.invalidate()
  }
  const erro = (e: { message: string }) => toast.error(e.message)
  const iniciarMut = trpc.comprasProcesso.iniciarCotacao.useMutation({ onSuccess: ok('Compra em cotação'), onError: erro })
  const negociacaoMut = trpc.comprasProcesso.irParaNegociacao.useMutation({ onSuccess: ok('Compra em negociação'), onError: erro })
  const escolherMut = trpc.comprasProcesso.escolherCotacao.useMutation({ onSuccess: ok('Cotação escolhida'), onError: erro })
  const removerCotMut = trpc.comprasProcesso.removerCotacao.useMutation({ onSuccess: ok('Cotação removida'), onError: erro })
  const enviarAprovMut = trpc.comprasProcesso.enviarAprovacao.useMutation({ onSuccess: ok('Enviada pra aprovação'), onError: erro })
  const excluirMut = trpc.comprasProcesso.excluir.useMutation({
    onSuccess: () => {
      toast.success('Compra excluída')
      utils.comprasProcesso.invalidate()
      navigate(-1)
    },
    onError: erro,
  })

  if (isLoading) return <div className="p-6 text-dark-400">Carregando...</div>
  if (error || !c) return <div className="p-6 text-dark-400">{error?.message ?? 'Compra não encontrada.'}</div>

  const pode = c.pode
  const escolhida = c.cotacoes.find((x) => x.id === c.cotacaoEscolhidaId) ?? null
  const temPrecosPorItem = c.cotacoes.some((x) => Object.keys(x.precos).length > 0)
  const cotacaoEditavel = pode.gerir && ['solicitacao', 'cotacao', 'negociacao'].includes(c.etapa)
  const economia = c.valorInicial != null && c.valorFinal != null ? c.valorInicial - c.valorFinal : 0

  return (
    <div className="p-4 sm:p-6 max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button type="button" onClick={() => navigate(-1)} className="text-xs text-dark-400 hover:text-dark-200 flex items-center gap-1 mb-1">
            <ArrowLeft size={13} /> Voltar
          </button>
          <h1 className="font-heading text-xl text-dark-50">
            <span className="text-dark-500 mr-2">#{c.id}</span>
            {c.titulo}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <EtapaBadge etapa={c.etapa} />
            <TipoBadge tipo={c.tipo} />
            <PrioridadeBadge prioridade={c.prioridade} />
            <span className="text-xs text-dark-400">{c.empresaNome}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pode.editar && !editando && (
            <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>
              <Pencil size={14} /> Editar
            </Button>
          )}
          {pode.cancelar && (
            <Button size="sm" variant="ghost" onClick={() => setMotivo({ acao: 'cancelar', titulo: 'Cancelar compra' })}>
              <Ban size={14} /> Cancelar compra
            </Button>
          )}
          {pode.excluir && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(`Excluir a compra #${c.id} de vez? (prefira Cancelar, que guarda o histórico)`)) excluirMut.mutate({ id: c.id })
              }}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-4">
        <TrilhaEtapas etapa={c.etapa} />
      </div>

      <ProximoPasso
        c={c}
        escolhida={escolhida}
        onIniciar={() => iniciarMut.mutate({ id: c.id })}
        onNovaCotacao={() => setCotacaoAberta('nova')}
        onNegociacao={() => negociacaoMut.mutate({ id: c.id })}
        onEnviarAprovacao={() => enviarAprovMut.mutate({ id: c.id })}
        onMotivo={setMotivo}
        carregando={iniciarMut.isPending || negociacaoMut.isPending || enviarAprovMut.isPending}
      />

      {editando ? (
        <Bloco titulo="Editar solicitação" icone={Pencil}>
          <FormSolicitacao
            inicial={{ ...c, itens: c.itens }}
            onPronto={() => setEditando(false)}
            onCancelar={() => setEditando(false)}
          />
        </Bloco>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Bloco titulo="Solicitação" icone={FileText}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Campo rotulo="Pedido por">{c.solicitanteNome}</Campo>
                <Campo rotulo="Aberta em">{dataHoraBr(c.createdAt)}</Campo>
                <Campo rotulo="Precisa até">{c.dataNecessidade ? dataBr(c.dataNecessidade) : null}</Campo>
                <Campo rotulo="Categoria">{c.categoriaNome}</Campo>
                <Campo rotulo="Setor">{c.setor}</Campo>
                <Campo rotulo="Valor estimado">{c.valorEstimado != null ? formatarMoeda(c.valorEstimado) : null}</Campo>
                <Campo rotulo="Comprador">{c.compradorNome}</Campo>
              </div>
              {c.justificativa && (
                <div className="mt-3">
                  <Campo rotulo="Justificativa">
                    <span className="whitespace-pre-wrap">{c.justificativa}</span>
                  </Campo>
                </div>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-dark-500 border-b border-dark-700">
                      <th className="py-1.5 pr-2 font-normal">Item</th>
                      <th className="py-1.5 px-2 font-normal text-right">Qtd</th>
                      {c.itens.some((i) => i.quantidadeRecebida != null) && <th className="py-1.5 px-2 font-normal text-right">Recebido</th>}
                      {temPrecosPorItem &&
                        c.cotacoes.map((cot) => (
                          <th key={cot.id} className="py-1.5 px-2 font-normal text-right whitespace-nowrap">
                            {cot.fornecedorNome}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.itens.map((i) => {
                      const precos = c.cotacoes.map((cot) => cot.precos[i.id]).filter((p) => p != null) as number[]
                      const menor = precos.length ? Math.min(...precos) : null
                      return (
                        <tr key={i.id} className="border-b border-dark-700/60 last:border-0 align-top">
                          <td className="py-2 pr-2">
                            <p className="text-dark-100">
                              {i.codigo && <span className="text-dark-500 mr-1">{i.codigo}</span>}
                              {i.descricao}
                            </p>
                            {i.observacao && <p className="text-xs text-dark-400">{i.observacao}</p>}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap text-dark-200">
                            {i.quantidade.toLocaleString('pt-BR')} {i.unidade}
                          </td>
                          {c.itens.some((x) => x.quantidadeRecebida != null) && (
                            <td className={`py-2 px-2 text-right whitespace-nowrap ${i.quantidadeRecebida != null && i.quantidadeRecebida < i.quantidade ? 'text-amber-400' : 'text-dark-200'}`}>
                              {i.quantidadeRecebida != null ? i.quantidadeRecebida.toLocaleString('pt-BR') : '—'}
                            </td>
                          )}
                          {temPrecosPorItem &&
                            c.cotacoes.map((cot) => {
                              const p = cot.precos[i.id]
                              return (
                                <td key={cot.id} className={`py-2 px-2 text-right whitespace-nowrap ${p != null && p === menor && precos.length > 1 ? 'text-green-400 font-medium' : 'text-dark-300'}`}>
                                  {p != null ? formatarMoeda(p) : '—'}
                                </td>
                              )
                            })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {temPrecosPorItem && <p className="text-[11px] text-dark-500 mt-1">Preço unitário de cada fornecedor — o menor de cada item em verde.</p>}
              </div>
            </Bloco>

            <Bloco
              titulo={`Cotações (${c.cotacoes.length})`}
              icone={Search}
              acoes={
                cotacaoEditavel && (
                  <Button size="sm" onClick={() => setCotacaoAberta('nova')}>
                    <Plus size={14} /> Lançar cotação
                  </Button>
                )
              }
            >
              {!c.cotacoes.length ? (
                <p className="text-sm text-dark-400">Nenhuma cotação lançada ainda.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {c.cotacoes.map((cot) => {
                    const ehEscolhida = cot.id === c.cotacaoEscolhidaId
                    return (
                      <div key={cot.id} className={`rounded-xl border p-3 ${ehEscolhida ? 'border-green-500/60 bg-green-500/5' : 'border-dark-600 bg-dark-900/40'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-dark-50">{cot.fornecedorNome}</p>
                          <div className="flex gap-1 shrink-0">
                            {ehEscolhida && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-300 bg-green-500/15 rounded-full px-2 py-0.5">
                                <Trophy size={11} /> Escolhida
                              </span>
                            )}
                            {cot.maisBarata && c.cotacoes.length > 1 && <span className="text-[11px] font-semibold text-sky-300 bg-sky-500/15 rounded-full px-2 py-0.5">Mais barata</span>}
                          </div>
                        </div>
                        <div className="mt-1">
                          {cot.valorNegociado != null ? (
                            <p>
                              <span className="text-xs text-dark-500 line-through mr-2">{formatarMoeda(cot.valorTotal)}</span>
                              <span className="text-lg font-bold text-dark-50">{formatarMoeda(cot.valorNegociado)}</span>
                              <span className="text-xs text-green-400 ml-2">-{formatarMoeda(cot.valorTotal - cot.valorNegociado)}</span>
                            </p>
                          ) : (
                            <p className="text-lg font-bold text-dark-50">{formatarMoeda(cot.valorTotal)}</p>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-dark-400 space-y-0.5">
                          {cot.frete != null && <p>Frete: {formatarMoeda(cot.frete)} (já no total)</p>}
                          {cot.prazoEntregaDias != null && <p>Entrega em {cot.prazoEntregaDias} dia(s)</p>}
                          {cot.condicaoPagamento && <p>Pagamento: {cot.condicaoPagamento}</p>}
                          {cot.validade && <p>Válida até {dataBr(cot.validade)}</p>}
                          {cot.observacoes && <p className="text-dark-300 whitespace-pre-wrap">{cot.observacoes}</p>}
                          {cot.anexoUrl && (
                            <a href={cot.anexoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold-400 hover:underline">
                              <Paperclip size={12} /> {cot.anexoNome ?? 'Orçamento'}
                            </a>
                          )}
                        </div>
                        {cotacaoEditavel && (
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {!ehEscolhida && (
                              <Button size="sm" variant="outline" onClick={() => escolherMut.mutate({ cotacaoId: cot.id })}>
                                <Trophy size={13} /> Escolher
                              </Button>
                            )}
                            {c.etapa !== 'solicitacao' && (
                              <Button size="sm" variant="secondary" onClick={() => setNegociando(cot)}>
                                <Handshake size={13} /> Negociar
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setCotacaoAberta(cot)}>
                              <Pencil size={13} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (window.confirm(`Remover a cotação de ${cot.fornecedorNome}?`)) removerCotMut.mutate({ id: cot.id })
                              }}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </Bloco>

            {(c.numeroPedido || c.dataRecebimento || c.aprovadoEm) && (
              <Bloco titulo="Aprovação, pedido e recebimento" icone={PackageCheck}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {c.aprovadoEm && (
                    <>
                      <Campo rotulo={c.etapa === 'reprovado' ? 'Reprovada por' : 'Aprovada por'}>{c.aprovadoPorNome}</Campo>
                      <Campo rotulo="Em">{dataHoraBr(c.aprovadoEm)}</Campo>
                      <Campo rotulo="Observação">{c.observacaoAprovacao}</Campo>
                    </>
                  )}
                  {c.numeroPedido && (
                    <>
                      <Campo rotulo="Nº do pedido">{c.numeroPedido}</Campo>
                      <Campo rotulo="Data do pedido">{dataBr(c.dataPedido)}</Campo>
                      <Campo rotulo="Previsão de entrega">{c.previsaoEntrega ? dataBr(c.previsaoEntrega) : null}</Campo>
                      <Campo rotulo="Condição de pagamento">{c.condicaoPagamento}</Campo>
                      <Campo rotulo="Forma de pagamento">{c.formaPagamento}</Campo>
                    </>
                  )}
                  {c.dataRecebimento && (
                    <>
                      <Campo rotulo="Recebido em">{dataBr(c.dataRecebimento)}</Campo>
                      <Campo rotulo="Nota fiscal">{c.notaFiscal}</Campo>
                      <Campo rotulo="Situação">{c.recebimentoSituacao === 'completo' ? 'Completo' : c.recebimentoSituacao === 'parcial' ? 'Parcial' : 'Com problema'}</Campo>
                      <Campo rotulo="Recebido por">{c.recebidoPorNome}</Campo>
                      <Campo rotulo="Obs. do recebimento">{c.recebimentoObs}</Campo>
                    </>
                  )}
                  {c.motivoEncerramento && <Campo rotulo="Motivo">{c.motivoEncerramento}</Campo>}
                </div>
              </Bloco>
            )}
          </div>

          <div className="space-y-4">
            <Bloco titulo="Valores" icone={ShoppingCart}>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-dark-400">Fornecedor</span>
                  <span className="text-dark-100 text-right">{c.fornecedorNome ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-400">Preço cotado</span>
                  <span className="text-dark-100">{c.valorInicial != null ? formatarMoeda(c.valorInicial) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-400">Valor final</span>
                  <span className="text-dark-50 font-bold">{c.valorFinal != null ? formatarMoeda(c.valorFinal) : '—'}</span>
                </div>
                {economia > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dark-400">Economia na negociação</span>
                    <span className="text-green-400 font-medium">{formatarMoeda(economia)}</span>
                  </div>
                )}
              </div>
            </Bloco>
            <Historico c={c} />
          </div>
        </div>
      )}

      {cotacaoAberta && <ModalCotacao compra={c} cotacao={cotacaoAberta === 'nova' ? null : cotacaoAberta} onClose={() => setCotacaoAberta(null)} />}
      {negociando && <ModalNegociar cotacao={negociando} onClose={() => setNegociando(null)} />}
      {motivo && <ModalMotivo compraId={c.id} acao={motivo.acao} titulo={motivo.titulo} onClose={() => setMotivo(null)} />}
      <p className="text-xs text-dark-500">
        <Link to={`${base}/compras-quadro`} className="hover:text-dark-300">
          Ver todas as compras
        </Link>
      </p>
    </div>
  )
}

// Caixa de destaque com o que precisa ser feito agora nesta compra.
function ProximoPasso({
  c,
  escolhida,
  onIniciar,
  onNovaCotacao,
  onNegociacao,
  onEnviarAprovacao,
  onMotivo,
  carregando,
}: {
  c: Compra
  escolhida: Cotacao | null
  onIniciar: () => void
  onNovaCotacao: () => void
  onNegociacao: () => void
  onEnviarAprovacao: () => void
  onMotivo: (m: { acao: 'reprovar' | 'devolver' | 'voltar' | 'cancelar'; titulo: string }) => void
  carregando: boolean
}) {
  const { pode } = c
  const info = ETAPA_INFO[c.etapa]
  const voltar = pode.gerir && ['cotacao', 'negociacao', 'recebimento'].includes(c.etapa) && (
    <Button size="sm" variant="ghost" onClick={() => onMotivo({ acao: 'voltar', titulo: 'Voltar uma etapa' })}>
      <Undo2 size={14} /> Voltar etapa
    </Button>
  )

  let conteudo: React.ReactNode = null
  if (c.etapa === 'solicitacao') {
    conteudo = pode.gerir ? (
      <>
        <p className="text-sm text-dark-200">Solicitação nova. Comece a cotar com os fornecedores.</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={onIniciar} loading={carregando}>
            <Search size={14} /> Começar cotação
          </Button>
          <Button size="sm" variant="secondary" onClick={onNovaCotacao}>
            <Plus size={14} /> Já lançar uma cotação
          </Button>
        </div>
      </>
    ) : (
      <p className="text-sm text-dark-200">Esperando o Compras começar a cotar.</p>
    )
  } else if (c.etapa === 'cotacao') {
    conteudo = pode.gerir ? (
      <>
        <p className="text-sm text-dark-200">
          Lance o preço de cada fornecedor ({c.cotacoes.length} até agora). Quando tiver as cotações, passe pra negociação.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onClick={onNovaCotacao}>
            <Plus size={14} /> Lançar cotação
          </Button>
          <Button size="sm" onClick={onNegociacao} loading={carregando} disabled={!c.cotacoes.length}>
            <Handshake size={14} /> Ir pra negociação
          </Button>
          {voltar}
        </div>
      </>
    ) : (
      <p className="text-sm text-dark-200">O Compras está cotando com os fornecedores ({c.cotacoes.length} cotação(ões) até agora).</p>
    )
  } else if (c.etapa === 'negociacao') {
    conteudo = pode.gerir ? (
      <>
        <p className="text-sm text-dark-200">
          {escolhida
            ? `Escolhida: ${escolhida.fornecedorNome} — ${formatarMoeda(escolhida.valorEfetivo)}. Se estiver tudo certo, mande pra aprovação.`
            : 'Negocie com os fornecedores (botão "Negociar" na cotação) e clique em "Escolher" na vencedora.'}
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={onEnviarAprovacao} loading={carregando} disabled={!escolhida}>
            <Send size={14} /> Mandar pra aprovação
          </Button>
          {voltar}
        </div>
      </>
    ) : (
      <p className="text-sm text-dark-200">O Compras está negociando preço e prazo.</p>
    )
  } else if (c.etapa === 'aprovacao') {
    conteudo = pode.aprovar ? <PainelAprovar c={c} escolhida={escolhida} onMotivo={onMotivo} /> : <p className="text-sm text-dark-200">Aguardando aprovação.</p>
  } else if (c.etapa === 'pedido') {
    conteudo = pode.gerir ? <FormPedido c={c} escolhida={escolhida} /> : <p className="text-sm text-dark-200">Aprovada! O Compras vai emitir o pedido pro fornecedor.</p>
  } else if (c.etapa === 'recebimento') {
    conteudo = pode.gerir ? (
      <>
        <FormRecebimento c={c} />
        <div>{voltar}</div>
      </>
    ) : (
      <p className="text-sm text-dark-200">
        Pedido {c.numeroPedido} feito. {c.previsaoEntrega ? `Entrega prevista para ${dataBr(c.previsaoEntrega)}.` : 'Esperando a entrega.'}
      </p>
    )
  } else if (c.etapa === 'finalizado') {
    conteudo = <p className="text-sm text-dark-200">Compra recebida e finalizada em {dataBr(c.dataRecebimento)}.</p>
  } else {
    conteudo = (
      <p className="text-sm text-dark-200">
        {info.label}
        {c.motivoEncerramento ? `: ${c.motivoEncerramento}` : '.'}
      </p>
    )
  }

  return (
    <section className="rounded-2xl p-4 sm:p-5 space-y-3" style={{ background: `${info.cor}14`, boxShadow: `inset 0 0 0 1px ${info.cor}55` }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: info.cor }}>
        Etapa atual: {info.label}
      </p>
      {conteudo}
    </section>
  )
}

function PainelAprovar({ c, escolhida, onMotivo }: { c: Compra; escolhida: Cotacao | null; onMotivo: (m: { acao: 'reprovar' | 'devolver'; titulo: string }) => void }) {
  const utils = trpc.useUtils()
  const [obs, setObs] = useState('')
  const aprovarMut = trpc.comprasProcesso.aprovar.useMutation({
    onSuccess: () => {
      toast.success('Compra aprovada')
      utils.comprasProcesso.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const outras = c.cotacoes.filter((x) => x.id !== escolhida?.id)
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Fornecedor escolhido</p>
          <p className="text-dark-50 font-medium">{escolhida?.fornecedorNome ?? '—'}</p>
          {escolhida?.prazoEntregaDias != null && <p className="text-xs text-dark-400">Entrega em {escolhida.prazoEntregaDias} dia(s)</p>}
        </div>
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Valor a aprovar</p>
          <p className="text-xl font-bold text-dark-50">{formatarMoeda(c.valorFinal)}</p>
          {c.valorInicial != null && c.valorFinal != null && c.valorInicial > c.valorFinal && <p className="text-xs text-green-400">Negociou {formatarMoeda(c.valorInicial - c.valorFinal)} a menos</p>}
        </div>
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Outras cotações</p>
          {outras.length ? (
            outras.map((o) => (
              <p key={o.id} className="text-xs text-dark-200">
                {o.fornecedorNome}: {formatarMoeda(o.valorEfetivo)}
              </p>
            ))
          ) : (
            <p className="text-xs text-amber-400">Só 1 cotação</p>
          )}
        </div>
      </div>
      <Input placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => aprovarMut.mutate({ id: c.id, observacao: obs || null })} loading={aprovarMut.isPending} className="!bg-green-600 !border-green-500 hover:!bg-green-500 !text-white">
          <CheckCircle2 size={15} /> Aprovar
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onMotivo({ acao: 'devolver', titulo: 'Devolver pra negociar' })}>
          <Handshake size={15} /> Negocia mais
        </Button>
        <Button size="sm" variant="danger" onClick={() => onMotivo({ acao: 'reprovar', titulo: 'Reprovar compra' })}>
          <XCircle size={15} /> Reprovar
        </Button>
      </div>
    </div>
  )
}

function FormPedido({ c, escolhida }: { c: Compra; escolhida: Cotacao | null }) {
  const utils = trpc.useUtils()
  const sugestaoEntrega = (() => {
    if (escolhida?.prazoEntregaDias == null) return ''
    const d = new Date(hojeBrString() + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + escolhida.prazoEntregaDias)
    return d.toISOString().slice(0, 10)
  })()
  const [numeroPedido, setNumeroPedido] = useState('')
  const [dataPedido, setDataPedido] = useState(hojeBrString())
  const [previsaoEntrega, setPrevisaoEntrega] = useState(sugestaoEntrega)
  const [condicaoPagamento, setCondicao] = useState(c.condicaoPagamento ?? escolhida?.condicaoPagamento ?? '')
  const [formaPagamento, setForma] = useState('')
  const [valor, setValor] = useState(formatarValorInput(c.valorFinal))
  const mut = trpc.comprasProcesso.registrarPedido.useMutation({
    onSuccess: () => {
      toast.success('Pedido registrado — agora é esperar a entrega')
      utils.comprasProcesso.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      <p className="text-sm text-dark-200">Aprovada! Emita o pedido pro fornecedor ({c.fornecedorNome}) e registre aqui.</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Input label="Nº do pedido de compra" value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} />
        <Input label="Data do pedido" type="date" value={dataPedido} onChange={(e) => setDataPedido(e.target.value)} />
        <Input label="Previsão de entrega" type="date" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
        <Input label="Condição de pagamento" placeholder="ex: 28 dias" value={condicaoPagamento} onChange={(e) => setCondicao(e.target.value)} />
        <Select
          label="Forma de pagamento"
          value={formaPagamento}
          onChange={(e) => setForma(e.target.value)}
          placeholder="Escolha..."
          options={['Boleto', 'PIX', 'Cartão de crédito', 'Transferência', 'Dinheiro', 'Outro'].map((v) => ({ value: v, label: v }))}
        />
        <Input label="Valor do pedido" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <Button
        size="sm"
        loading={mut.isPending}
        onClick={() => {
          if (!numeroPedido.trim()) return toast.error('Informe o número do pedido')
          mut.mutate({ id: c.id, numeroPedido, dataPedido, previsaoEntrega: previsaoEntrega || null, condicaoPagamento, formaPagamento, valorFinal: num(valor) ?? undefined })
        }}
      >
        <Send size={14} /> Pedido emitido
      </Button>
    </div>
  )
}

function FormRecebimento({ c }: { c: Compra }) {
  const utils = trpc.useUtils()
  const [data, setData] = useState(hojeBrString())
  const [nf, setNf] = useState(c.notaFiscal ?? '')
  const [situacao, setSituacao] = useState<'completo' | 'parcial' | 'com_problema'>('completo')
  const [obs, setObs] = useState('')
  const [valor, setValor] = useState(formatarValorInput(c.valorFinal))
  const [qtds, setQtds] = useState<Record<number, string>>(() => Object.fromEntries(c.itens.map((i) => [i.id, String(i.quantidadeRecebida ?? i.quantidade).replace('.', ',')])))
  const mut = trpc.comprasProcesso.registrarRecebimento.useMutation({
    onSuccess: (_, v) => {
      toast.success(v.situacao === 'completo' ? 'Recebido — compra finalizada' : 'Recebimento registrado — continua pendente')
      utils.comprasProcesso.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      <p className="text-sm text-dark-200">
        Pedido {c.numeroPedido} · {c.fornecedorNome}
        {c.previsaoEntrega ? ` · entrega prevista ${dataBr(c.previsaoEntrega)}` : ''}. Quando chegar, confira e registre:
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Input label="Data que chegou" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Input label="Nota fiscal" value={nf} onChange={(e) => setNf(e.target.value)} />
        <Input label="Valor da nota" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <div className="rounded-xl bg-dark-900/50 p-3">
        <p className="text-xs text-dark-400 mb-2">Quantidade que chegou de cada item</p>
        <div className="space-y-1.5">
          {c.itens.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-dark-200 truncate">{i.descricao}</span>
              <span className="text-xs text-dark-500 whitespace-nowrap">
                pedido {i.quantidade.toLocaleString('pt-BR')} {i.unidade}
              </span>
              <input
                className="w-20 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1 text-sm text-dark-100 text-right"
                inputMode="decimal"
                value={qtds[i.id] ?? ''}
                onChange={(e) => setQtds((a) => ({ ...a, [i.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['completo', 'Chegou tudo certo'],
            ['parcial', 'Chegou só uma parte'],
            ['com_problema', 'Chegou com problema'],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            type="button"
            onClick={() => setSituacao(v)}
            className={`text-sm rounded-lg border px-3 py-1.5 ${
              situacao === v ? (v === 'completo' ? 'border-green-500 bg-green-500/15 text-green-300' : 'border-amber-500 bg-amber-500/15 text-amber-300') : 'border-dark-600 text-dark-400'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      {situacao !== 'completo' && <Textarea rows={2} placeholder="O que faltou / qual o problema?" value={obs} onChange={(e) => setObs(e.target.value)} />}
      <Button
        size="sm"
        loading={mut.isPending}
        onClick={() => {
          const quantidades = c.itens.map((i) => ({ itemId: i.id, quantidadeRecebida: num(qtds[i.id] ?? '') ?? 0 }))
          mut.mutate({ id: c.id, dataRecebimento: data, notaFiscal: nf, situacao, observacao: obs || null, valorFinal: num(valor) ?? undefined, quantidades })
        }}
      >
        <PackageCheck size={14} /> {situacao === 'completo' ? 'Registrar e finalizar' : 'Registrar (continua pendente)'}
      </Button>
    </div>
  )
}

function ModalCotacao({ compra, cotacao, onClose }: { compra: Compra; cotacao: Cotacao | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: aux } = trpc.comprasProcesso.auxiliares.useQuery()
  const [novoFornecedor, setNovoFornecedor] = useState(false)
  const [fornecedorId, setFornecedorId] = useState<number | ''>(cotacao?.fornecedorId ?? '')
  const [valorTotal, setValorTotal] = useState(formatarValorInput(cotacao?.valorTotal))
  const [frete, setFrete] = useState(formatarValorInput(cotacao?.frete))
  const [prazo, setPrazo] = useState(cotacao?.prazoEntregaDias != null ? String(cotacao.prazoEntregaDias) : '')
  const [condicao, setCondicao] = useState(cotacao?.condicaoPagamento ?? '')
  const [validade, setValidade] = useState(cotacao?.validade ?? '')
  const [obs, setObs] = useState(cotacao?.observacoes ?? '')
  const [anexo, setAnexo] = useState<{ url: string; nome: string } | null>(cotacao?.anexoUrl ? { url: cotacao.anexoUrl, nome: cotacao.anexoNome ?? 'Orçamento' } : null)
  const [enviando, setEnviando] = useState(false)
  const [precos, setPrecos] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(cotacao?.precos ?? {}).map(([k, v]) => [Number(k), formatarValorInput(v as number)])))
  const fileRef = useRef<HTMLInputElement>(null)

  const somaItens = compra.itens.reduce((t, i) => {
    const p = num(precos[i.id] ?? '')
    return p != null ? t + p * i.quantidade : t
  }, 0)

  const mut = trpc.comprasProcesso.salvarCotacao.useMutation({
    onSuccess: () => {
      toast.success('Cotação salva')
      utils.comprasProcesso.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  function escolherFornecedor(id: number) {
    setFornecedorId(id)
    const f = aux?.fornecedores.find((x) => x.id === id)
    if (f && !cotacao) {
      if (!condicao && f.condicaoPagamento) setCondicao(f.condicaoPagamento)
      if (!prazo && f.prazoEntregaDias != null) setPrazo(String(f.prazoEntregaDias))
    }
  }

  return (
    <Modal open onClose={onClose} title={cotacao ? 'Editar cotação' : 'Lançar cotação'} size="lg">
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              label="Fornecedor"
              value={fornecedorId}
              onChange={(e) => e.target.value && escolherFornecedor(Number(e.target.value))}
              options={(aux?.fornecedores ?? []).filter((f) => f.ativo || f.id === cotacao?.fornecedorId).map((f) => ({ value: f.id, label: f.nome }))}
              placeholder="Escolha..."
            />
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={() => setNovoFornecedor(true)}>
            <Plus size={14} /> Novo
          </Button>
        </div>

        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400 mb-2">Preço unitário de cada item (opcional — ajuda a comparar item a item)</p>
          <div className="space-y-1.5">
            {compra.itens.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-dark-200 truncate">{i.descricao}</span>
                <span className="text-xs text-dark-500 whitespace-nowrap">
                  {i.quantidade.toLocaleString('pt-BR')} {i.unidade} ×
                </span>
                <input
                  className="w-28 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1 text-sm text-dark-100 text-right"
                  inputMode="decimal"
                  placeholder="R$ unit."
                  value={precos[i.id] ?? ''}
                  onChange={(e) => setPrecos((a) => ({ ...a, [i.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          {somaItens > 0 && (
            <button type="button" className="text-xs text-gold-400 hover:underline mt-2" onClick={() => setValorTotal(formatarValorInput(somaItens + (num(frete) ?? 0)))}>
              Usar soma dos itens{num(frete) ? ' + frete' : ''} como total ({formatarMoeda(somaItens + (num(frete) ?? 0))})
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Input label="Valor total (com frete)" inputMode="decimal" placeholder="R$" value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} />
          <Input label="Frete (se cobrado à parte)" inputMode="decimal" placeholder="R$" value={frete} onChange={(e) => setFrete(e.target.value)} />
          <Input label="Prazo de entrega (dias)" inputMode="numeric" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          <Input label="Condição de pagamento" placeholder="ex: 28/56 dias" value={condicao} onChange={(e) => setCondicao(e.target.value)} />
          <Input label="Validade da proposta" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          <div className="flex flex-col gap-1">
            <span className="text-sm text-dark-200 font-medium">Orçamento (PDF/print)</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setEnviando(true)
                try {
                  setAnexo(await uploadAnexoCompra(file))
                } catch (err) {
                  toast.error((err as Error).message)
                } finally {
                  setEnviando(false)
                  e.target.value = ''
                }
              }}
            />
            <Button variant="secondary" size="sm" className="h-9" loading={enviando} onClick={() => fileRef.current?.click()}>
              <Paperclip size={14} /> {anexo ? 'Trocar' : 'Anexar'}
            </Button>
            {anexo && <span className="text-xs text-dark-400 truncate">{anexo.nome}</span>}
          </div>
        </div>
        <Textarea label="Observações" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={mut.isPending}
            onClick={() => {
              if (!fornecedorId) return toast.error('Escolha o fornecedor')
              const total = num(valorTotal)
              if (total == null) return toast.error('Informe o valor total')
              mut.mutate({
                id: cotacao?.id,
                solicitacaoId: compra.id,
                fornecedorId: Number(fornecedorId),
                valorTotal: total,
                frete: num(frete),
                prazoEntregaDias: prazo.trim() ? Number(prazo.replace(/\D/g, '')) : null,
                condicaoPagamento: condicao || null,
                validade: validade || null,
                observacoes: obs || null,
                anexoUrl: anexo?.url ?? null,
                anexoNome: anexo?.nome ?? null,
                precos: compra.itens.map((i) => ({ itemId: i.id, valorUnitario: num(precos[i.id] ?? '') })).filter((p): p is { itemId: number; valorUnitario: number } => p.valorUnitario != null),
              })
            }}
          >
            Salvar cotação
          </Button>
        </div>
      </div>
      {novoFornecedor && <ModalFornecedor onClose={() => setNovoFornecedor(false)} onSalvo={(id) => setFornecedorId(id)} />}
    </Modal>
  )
}

function ModalNegociar({ cotacao, onClose }: { cotacao: Cotacao; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [valor, setValor] = useState(formatarValorInput(cotacao.valorNegociado ?? cotacao.valorTotal))
  const [obs, setObs] = useState(cotacao.observacoes ?? '')
  const mut = trpc.comprasProcesso.negociar.useMutation({
    onSuccess: () => {
      toast.success('Negociação registrada')
      utils.comprasProcesso.invalidate()
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  const v = num(valor)
  return (
    <Modal open onClose={onClose} title={`Negociar com ${cotacao.fornecedorNome}`} size="sm">
      <div className="space-y-3">
        <p className="text-sm text-dark-300">
          Preço cotado: <b className="text-dark-100">{formatarMoeda(cotacao.valorTotal)}</b>
        </p>
        <Input label="Preço depois da negociação" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        {v != null && v < cotacao.valorTotal && (
          <p className="text-xs text-green-400">
            Economia de {formatarMoeda(cotacao.valorTotal - v)} ({(((cotacao.valorTotal - v) / cotacao.valorTotal) * 100).toFixed(1).replace('.', ',')}%)
          </p>
        )}
        <Textarea label="O que foi combinado (prazo, frete, pagamento...)" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex justify-between gap-2">
          {cotacao.valorNegociado != null ? (
            <Button variant="ghost" size="sm" onClick={() => mut.mutate({ cotacaoId: cotacao.id, valorNegociado: null })}>
              Desfazer negociação
            </Button>
          ) : (
            <span />
          )}
          <Button loading={mut.isPending} onClick={() => (v == null ? toast.error('Informe o valor') : mut.mutate({ cotacaoId: cotacao.id, valorNegociado: v, observacoes: obs }))}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ModalMotivo({ compraId, acao, titulo, onClose }: { compraId: number; acao: 'reprovar' | 'devolver' | 'voltar' | 'cancelar'; titulo: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [motivo, setMotivo] = useState('')
  const opts = {
    onSuccess: () => {
      toast.success('Feito')
      utils.comprasProcesso.invalidate()
      onClose()
    },
    onError: (e: { message: string }) => toast.error(e.message),
  }
  const reprovar = trpc.comprasProcesso.reprovar.useMutation(opts)
  const devolver = trpc.comprasProcesso.devolverNegociacao.useMutation(opts)
  const voltar = trpc.comprasProcesso.voltarEtapa.useMutation(opts)
  const cancelar = trpc.comprasProcesso.cancelar.useMutation(opts)
  const mut = { reprovar, devolver, voltar, cancelar }[acao]
  const placeholder = {
    reprovar: 'Por que não vai comprar?',
    devolver: 'O que o Compras precisa melhorar? (ex: tentar baixar 10%, buscar mais 1 fornecedor)',
    voltar: 'Por que está voltando?',
    cancelar: 'Por que está cancelando?',
  }[acao]
  return (
    <Modal open onClose={onClose} title={titulo} size="sm">
      <div className="space-y-3">
        <Textarea rows={3} placeholder={placeholder} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={acao === 'reprovar' || acao === 'cancelar' ? 'danger' : 'primary'} loading={mut.isPending} onClick={() => mut.mutate({ id: compraId, motivo })}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Historico({ c }: { c: Compra }) {
  const utils = trpc.useUtils()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const mut = trpc.comprasProcesso.comentar.useMutation({
    onSuccess: () => {
      setTexto('')
      utils.comprasProcesso.detalhe.invalidate({ id: c.id })
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Bloco titulo="Histórico e conversa" icone={MessageSquare}>
      <div className="flex gap-2 mb-3">
        <input
          className="flex-1 min-w-0 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-500"
          placeholder="Escrever um comentário..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && texto.trim()) mut.mutate({ id: c.id, texto })
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setEnviando(true)
            try {
              const a = await uploadAnexoCompra(file)
              mut.mutate({ id: c.id, texto: texto || undefined, anexoUrl: a.url, anexoNome: a.nome })
            } catch (err) {
              toast.error((err as Error).message)
            } finally {
              setEnviando(false)
              e.target.value = ''
            }
          }}
        />
        <Button size="sm" variant="ghost" title="Anexar arquivo" loading={enviando} onClick={() => fileRef.current?.click()}>
          <Paperclip size={15} />
        </Button>
        <Button size="sm" variant="secondary" disabled={!texto.trim()} loading={mut.isPending} onClick={() => mut.mutate({ id: c.id, texto })}>
          <Send size={14} />
        </Button>
      </div>
      <ol className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {c.historico.map((h) => (
          <li key={h.id} className="text-sm border-l-2 pl-3" style={{ borderColor: h.paraEtapa ? ETAPA_INFO[h.paraEtapa as keyof typeof ETAPA_INFO]?.cor : 'var(--color-dark-600)' }}>
            <p className="text-[11px] text-dark-500">
              {dataHoraBr(h.createdAt)} · {h.userNome}
            </p>
            {h.tipo === 'etapa' && h.paraEtapa && (
              <p className="text-dark-200">
                → <b>{ETAPA_INFO[h.paraEtapa as keyof typeof ETAPA_INFO]?.label ?? h.paraEtapa}</b>
              </p>
            )}
            {h.texto && <p className={`whitespace-pre-wrap ${h.tipo === 'comentario' ? 'text-dark-100' : 'text-dark-300'}`}>{h.texto}</p>}
            {h.anexoUrl && (
              <a href={h.anexoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold-400 hover:underline text-xs">
                <Paperclip size={12} /> {h.anexoNome ?? 'Anexo'}
              </a>
            )}
          </li>
        ))}
      </ol>
    </Bloco>
  )
}
