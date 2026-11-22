// Fila de pedidos de outros setores ao marketing (estilo Operand/Ummense):
// quadro Novo → Em produção → Aprovação → Entregue, com responsável e prazo.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { STATUS_DEMANDA, cls, dataHora, diaLabel, hojeBR, iniciais } from './comum'

type Demanda = {
  id: number; titulo: string; descricao: string; tipo: string; prioridade: string; prazo: string | null; status: string; responsavelId: number | null
  linkEntrega: string; resposta: string; solicitante: string; marca: string; createdAt: string
}
const corPrio: Record<string, string> = { Urgente: 'text-red-400', Normal: 'text-dark-300', Baixa: 'text-dark-500' }

function DemandaModal({ d, onClose }: { d: Demanda | null; onClose: () => void }) {
  const utils = trpc.useUtils()
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  const [f, setF] = useState<Demanda | null>(d)
  const salvar = trpc.marketingFluxo.salvarDemanda.useMutation({ onSuccess: () => { utils.marketingFluxo.demandas.invalidate(); toast.success('Salvo'); onClose() }, onError: (e) => toast.error(e.message) })
  if (!d || !f) return null
  return (
    <Modal open={!!d} onClose={onClose} title={`Pedido #${d.id}`} size="lg">
      <div className="space-y-3 text-sm">
        <div><div className="text-lg font-bold text-dark-100">{d.titulo}</div><div className="text-xs text-dark-400">{d.tipo}{d.marca && ` · ${d.marca}`} · pedido por {d.solicitante} em {dataHora(d.createdAt)}</div></div>
        <p className="whitespace-pre-wrap text-dark-200 bg-dark-900 rounded-lg p-3">{d.descricao}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block space-y-1"><span className={cls.rotulo}>Etapa</span><select className={cls.input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUS_DEMANDA.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="block space-y-1"><span className={cls.rotulo}>Responsável</span><select className={cls.input} value={f.responsavelId ?? ''} onChange={(e) => setF({ ...f, responsavelId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{(equipe.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="block space-y-1"><span className={cls.rotulo}>Prazo</span><input type="date" className={cls.input} value={f.prazo || ''} onChange={(e) => setF({ ...f, prazo: e.target.value || null })} /></label>
          <label className="block space-y-1"><span className={cls.rotulo}>Prioridade</span><select className={cls.input} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}>{['Baixa', 'Normal', 'Urgente'].map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="block space-y-1"><span className={cls.rotulo}>Link da entrega (Drive, Mídia…)</span><input className={cls.input} value={f.linkEntrega} onChange={(e) => setF({ ...f, linkEntrega: e.target.value })} /></label>
        <label className="block space-y-1"><span className={cls.rotulo}>Resposta para quem pediu</span><textarea rows={3} className={cls.input} value={f.resposta} onChange={(e) => setF({ ...f, resposta: e.target.value })} /></label>
        <Button onClick={() => salvar.mutate({ id: f.id, status: f.status as any, responsavelId: f.responsavelId, prazo: f.prazo, prioridade: f.prioridade as any, linkEntrega: f.linkEntrega, resposta: f.resposta })} loading={salvar.isPending}>Salvar</Button>
      </div>
    </Modal>
  )
}

export default function AbaPedidos() {
  const utils = trpc.useUtils()
  const lista = trpc.marketingFluxo.demandas.useQuery()
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  const artes = trpc.marketingFluxo.artesVendedores.useQuery()
  const mover = trpc.marketingFluxo.salvarDemanda.useMutation({ onSuccess: () => utils.marketingFluxo.demandas.invalidate(), onError: (e) => toast.error(e.message) })
  const [aberta, setAberta] = useState<Demanda | null>(null)
  const [verRecusados, setVerRecusados] = useState(false)
  const nome = (id: number | null) => equipe.data?.find((u) => u.id === id)?.name || ''
  const hoje = hojeBR()
  const cols = STATUS_DEMANDA.filter((s) => s !== 'Recusado' || verRecusados)
  const ds = (lista.data || []) as Demanda[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-dark-100">Pedidos ao marketing</h2>
          <p className="text-sm text-dark-400">O que os outros setores pedem. Quem pede acompanha em <b>Pedir ao marketing</b>, no menu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!!artes.data?.pendentes && <Link to="/admin/aprovacoes" className="text-sm text-yellow-300 hover:underline">{artes.data.pendentes} pedido(s) de arte dos vendedores esperando aprovação →</Link>}
          <label className="text-xs text-dark-400 flex items-center gap-1"><input type="checkbox" checked={verRecusados} onChange={(e) => setVerRecusados(e.target.checked)} />ver recusados</label>
          <Link to="/admin/pedir-marketing"><Button size="sm" variant="secondary">+ Novo pedido</Button></Link>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {cols.map((st) => {
          const col = ds.filter((d) => d.status === st)
          return (
            <div key={st} className="min-w-[260px] w-[260px] flex-shrink-0 rounded-xl border border-dark-700 bg-dark-900/40" onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = Number(e.dataTransfer.getData('text/plain')); const d = ds.find((x) => x.id === id); if (d && d.status !== st) mover.mutate({ id, status: st }) }}>
              <div className="px-3 py-2 border-b border-dark-700 flex justify-between text-sm"><b className="text-dark-100">{st}</b><span className="text-dark-400">{col.length}</span></div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {col.map((d) => {
                  const atr = !!d.prazo && d.prazo < hoje && !['Entregue', 'Recusado'].includes(d.status)
                  const resp = nome(d.responsavelId)
                  return (
                    <div key={d.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(d.id))} onClick={() => setAberta(d)}
                      className={`cursor-pointer rounded-lg p-2.5 space-y-1.5 border bg-dark-800 hover:border-dark-500 ${atr ? 'border-red-600' : 'border-dark-700'}`}>
                      <div className="flex justify-between text-[11px] text-dark-400"><span>{d.tipo}</span><span className={corPrio[d.prioridade]}>{d.prioridade}</span></div>
                      <div className="text-sm font-semibold text-dark-100 leading-snug">{d.titulo}</div>
                      <div className="text-[11px] text-dark-400">{d.solicitante}{d.marca && ` · ${d.marca}`}</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        {resp ? <span title={resp} className="w-6 h-6 rounded-full bg-gold-900/50 text-gold-200 flex items-center justify-center font-bold">{iniciais(resp)}</span> : <span className="text-dark-500">sem responsável</span>}
                        {d.prazo && <span className={atr ? 'text-red-400 font-semibold' : 'text-dark-300'}>prazo {diaLabel(d.prazo)}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <DemandaModal key={aberta?.id} d={aberta} onClose={() => setAberta(null)} />
    </div>
  )
}
