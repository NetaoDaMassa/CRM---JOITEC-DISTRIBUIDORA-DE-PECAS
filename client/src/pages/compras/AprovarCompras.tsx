import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Handshake, ShieldCheck, ChevronRight, Clock } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Textarea } from '../../components/ui/Input'
import { PrioridadeBadge, TipoBadge } from '../../components/compras/ui'
import { dataBr, useBaseCompras } from '../../lib/comprasShared'
import { formatarMoeda } from '../../lib/moeda'

// Fila do aprovador: tudo que está esperando aprovação, com fornecedor
// escolhido, valor, economia e as outras cotações pra comparar. Aprovar é
// um clique; reprovar / "negocia mais" pedem o motivo.
export default function AprovarCompras() {
  const base = useBaseCompras()
  const { data, isLoading } = trpc.comprasProcesso.pendencias.useQuery()
  const lista = data?.aprovacoes ?? []
  const total = lista.reduce((t, l) => t + (l.valorFinal ?? 0), 0)

  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-gold-400" />
        <div>
          <h1 className="font-heading text-xl text-dark-50">Aprovar compras</h1>
          <p className="text-sm text-dark-400">
            {isLoading ? 'Carregando...' : lista.length ? `${lista.length} compra(s) esperando você · ${formatarMoeda(total)}` : 'Nada esperando aprovação agora.'}
          </p>
        </div>
      </div>

      {lista.map((l) => (
        <CartaoAprovacao key={l.id} id={l.id} base={base} />
      ))}

      {!isLoading && !lista.length && (
        <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 text-center">
          <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
          <p className="text-dark-200">Tudo em dia! Nenhuma compra esperando aprovação.</p>
        </div>
      )}
    </div>
  )
}

function CartaoAprovacao({ id, base }: { id: number; base: string }) {
  const utils = trpc.useUtils()
  const { data: c } = trpc.comprasProcesso.detalhe.useQuery({ id })
  const [motivo, setMotivo] = useState<null | 'reprovar' | 'devolver'>(null)
  const [texto, setTexto] = useState('')
  const pronto = (msg: string) => () => {
    toast.success(msg)
    setMotivo(null)
    setTexto('')
    utils.comprasProcesso.invalidate()
  }
  const erro = (e: { message: string }) => toast.error(e.message)
  const aprovar = trpc.comprasProcesso.aprovar.useMutation({ onSuccess: pronto(`Compra #${id} aprovada`), onError: erro })
  const reprovar = trpc.comprasProcesso.reprovar.useMutation({ onSuccess: pronto(`Compra #${id} reprovada`), onError: erro })
  const devolver = trpc.comprasProcesso.devolverNegociacao.useMutation({ onSuccess: pronto(`Compra #${id} voltou pra negociação`), onError: erro })

  if (!c) return <div className="h-40 rounded-2xl bg-dark-800 border border-dark-600 animate-pulse" />
  const escolhida = c.cotacoes.find((x) => x.id === c.cotacaoEscolhidaId)
  const economia = c.valorInicial != null && c.valorFinal != null ? c.valorInicial - c.valorFinal : 0

  return (
    <div className="bg-dark-800 border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link to={`${base}/compras/${c.id}`} className="text-dark-50 font-medium hover:text-gold-400 inline-flex items-center gap-1">
            <span className="text-dark-500">#{c.id}</span> {c.titulo} <ChevronRight size={15} className="text-dark-500" />
          </Link>
          <p className="text-xs text-dark-400">
            {c.empresaNome} · pedido por {c.solicitanteNome} · comprador {c.compradorNome ?? '—'}
            {c.categoriaNome ? ` · ${c.categoriaNome}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 items-center">
          <PrioridadeBadge prioridade={c.prioridade} />
          <TipoBadge tipo={c.tipo} />
          <span className="text-xs text-dark-500 inline-flex items-center gap-0.5">
            <Clock size={11} /> desde {dataBr(c.etapaDesde)}
          </span>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Itens</p>
          {c.itens.slice(0, 4).map((i) => (
            <p key={i.id} className="text-xs text-dark-200 truncate">
              {i.quantidade.toLocaleString('pt-BR')} {i.unidade} · {i.descricao}
            </p>
          ))}
          {c.itens.length > 4 && <p className="text-xs text-dark-500">+ {c.itens.length - 4} item(ns)</p>}
          {c.justificativa && <p className="text-xs text-dark-400 mt-1 italic line-clamp-2">“{c.justificativa}”</p>}
        </div>
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Escolhido: {escolhida?.fornecedorNome ?? c.fornecedorNome ?? '—'}</p>
          <p className="text-2xl font-bold text-dark-50">{formatarMoeda(c.valorFinal)}</p>
          {economia > 0 && <p className="text-xs text-green-400">Negociou {formatarMoeda(economia)} a menos</p>}
          {escolhida?.prazoEntregaDias != null && <p className="text-xs text-dark-400">Entrega em {escolhida.prazoEntregaDias} dia(s){escolhida.condicaoPagamento ? ` · ${escolhida.condicaoPagamento}` : ''}</p>}
        </div>
        <div className="rounded-xl bg-dark-900/50 p-3">
          <p className="text-xs text-dark-400">Cotações ({c.cotacoes.length})</p>
          {c.cotacoes.map((o) => (
            <p key={o.id} className={`text-xs flex justify-between gap-2 ${o.id === c.cotacaoEscolhidaId ? 'text-green-300 font-medium' : 'text-dark-200'}`}>
              <span className="truncate">{o.fornecedorNome}</span>
              <span className="whitespace-nowrap">{formatarMoeda(o.valorEfetivo)}</span>
            </p>
          ))}
          {c.cotacoes.length < 2 && <p className="text-xs text-amber-400 mt-1">Só 1 cotação</p>}
          {escolhida && !escolhida.maisBarata && <p className="text-xs text-amber-400 mt-1">Não é a mais barata — veja o motivo no histórico</p>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => aprovar.mutate({ id: c.id })} loading={aprovar.isPending} className="!bg-green-600 !border-green-500 hover:!bg-green-500 !text-white">
          <CheckCircle2 size={15} /> Aprovar
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMotivo('devolver')}>
          <Handshake size={15} /> Negocia mais
        </Button>
        <Button size="sm" variant="danger" onClick={() => setMotivo('reprovar')}>
          <XCircle size={15} /> Reprovar
        </Button>
      </div>

      {motivo && (
        <Modal open onClose={() => setMotivo(null)} title={motivo === 'reprovar' ? `Reprovar #${c.id}` : `Devolver #${c.id} pra negociar`} size="sm">
          <div className="space-y-3">
            <Textarea
              rows={3}
              autoFocus
              placeholder={motivo === 'reprovar' ? 'Por que não vai comprar?' : 'O que o Compras precisa melhorar?'}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMotivo(null)}>
                Voltar
              </Button>
              <Button
                variant={motivo === 'reprovar' ? 'danger' : 'primary'}
                loading={reprovar.isPending || devolver.isPending}
                onClick={() => (motivo === 'reprovar' ? reprovar.mutate({ id: c.id, motivo: texto }) : devolver.mutate({ id: c.id, motivo: texto }))}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
