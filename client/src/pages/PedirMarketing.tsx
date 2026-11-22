// "Pedir ao marketing" — qualquer setor pede uma demanda (arte, vídeo, post,
// impresso, evento, site) e acompanha a etapa. Pedido do João, 2026-11-22.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../lib/trpc'
import Button from '../components/ui/Button'

const inp = 'bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-dark-100 focus:outline-none focus:border-gold-500 w-full'
const rot = 'text-[11px] font-semibold uppercase tracking-wider text-dark-400'
const corStatus: Record<string, string> = { Novo: 'bg-dark-700 text-dark-200', 'Em produção': 'bg-blue-900/50 text-blue-200', Aprovação: 'bg-yellow-900/50 text-yellow-200', Entregue: 'bg-green-900/50 text-green-200', Recusado: 'bg-red-900/50 text-red-200' }

export default function PedirMarketing() {
  const utils = trpc.useUtils()
  const op = trpc.marketingFluxo.opcoesPedido.useQuery()
  const meus = trpc.marketingFluxo.meusPedidos.useQuery()
  const vazio = { titulo: '', descricao: '', tipo: 'Arte', prioridade: 'Normal', prazo: '', empresaId: '' }
  const [f, setF] = useState(vazio)
  const pedir = trpc.marketingFluxo.pedir.useMutation({
    onSuccess: () => { toast.success('Pedido enviado ao marketing'); setF(vazio); utils.marketingFluxo.meusPedidos.invalidate() },
    onError: (e) => toast.error(e.message),
  })
  const enviar = () => pedir.mutate({ titulo: f.titulo, descricao: f.descricao, tipo: f.tipo as any, prioridade: f.prioridade as any, prazo: f.prazo || null, empresaId: f.empresaId ? Number(f.empresaId) : null })

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-dark-100">Pedir ao marketing</h1>
        <p className="text-sm text-dark-400">Peça uma arte, vídeo, post, material impresso, apoio em evento ou mudança no site. Você acompanha aqui embaixo. Para arte de oferta ou comunicado de vendedor continua valendo o <Link className="text-gold-400 hover:underline" to="../solicitar-design" relative="path">Solicitar Arte</Link>.</p>
      </div>
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-4 space-y-3">
        <label className="block space-y-1"><span className={rot}>O que você precisa (título curto)</span><input className={inp} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Banner da feira de março" /></label>
        <label className="block space-y-1"><span className={rot}>Explique com detalhes</span><textarea rows={5} className={inp} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Para quem é, onde vai ser usado, tamanho, textos, produto, preço, referência…" /></label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block space-y-1"><span className={rot}>Tipo</span><select className={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{(op.data?.tipos || ['Arte']).map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="block space-y-1"><span className={rot}>Marca</span><select className={inp} value={f.empresaId} onChange={(e) => setF({ ...f, empresaId: e.target.value })}><option value="">Não sei / várias</option>{(op.data?.marcas || []).map((m) => <option key={m.empresaId} value={m.empresaId}>{m.nome}</option>)}</select></label>
          <label className="block space-y-1"><span className={rot}>Prazo</span><input type="date" className={inp} value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} /></label>
          <label className="block space-y-1"><span className={rot}>Prioridade</span><select className={inp} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}>{(op.data?.prioridades || ['Normal']).map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <Button onClick={enviar} loading={pedir.isPending} disabled={f.titulo.trim().length < 3 || f.descricao.trim().length < 5}>Enviar pedido</Button>
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-dark-100">Meus pedidos</h2>
        {!meus.data?.length && <p className="text-sm text-dark-400">Nenhum pedido ainda.</p>}
        {(meus.data || []).map((d) => (
          <div key={d.id} className="bg-dark-800 border border-dark-700 rounded-xl p-3 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-dark-100">{d.titulo}</b><span className={`text-xs px-2 py-0.5 rounded ${corStatus[d.status] || ''}`}>{d.status}</span></div>
            <div className="text-xs text-dark-400">{d.tipo}{d.marca && ` · ${d.marca}`}{d.prazo && ` · prazo ${d.prazo.split('-').reverse().join('/')}`}</div>
            {d.resposta && <div className="text-sm text-dark-200"><b>Marketing:</b> {d.resposta}</div>}
            {d.linkEntrega && <a className="text-sm text-gold-400 hover:underline break-all" href={d.linkEntrega} target="_blank" rel="noreferrer">Ver entrega</a>}
          </div>
        ))}
      </div>
    </div>
  )
}
