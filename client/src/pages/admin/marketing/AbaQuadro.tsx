// Quadro por etapa (estilo Trello/ClickUp): arrasta a peça entre as etapas,
// mostra responsável, prazo (data de postar), atrasadas em vermelho e peças
// paradas. Também cria as peças da semana e as demandas complementares.
// Etapas (João, 2026-11-23): Ideia → Roteiro → Aprovação do roteiro →
// Produção → Aprovação final → Agendado na mLabs (exige o vídeo/arte anexado).
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { STATUS, atrasada, cls, diaLabel, diasParada, hojeBR, iniciais, nomeCurtoMarca, semanasDoMes, faixaSemana } from './comum'
import type { Peca } from './PecaModal'

type Marca = { empresaId: number; nome: string }
const DICA_COL: Record<string, string> = { Ideia: 'só a pauta', Roteiro: 'escrevendo', 'Aprovação do roteiro': 'esperando revisor', Produção: 'gravar, editar e anexar', 'Aprovação final': 'vídeo/arte pronto', 'Agendado na mLabs': 'pronto' }

// Demanda complementar: peça fora do plano (3V+2P), ex.: story, post de
// feedback, vídeo de evento. Não conta na meta e não passa pela aprovação do roteiro.
function NovaComplementar({ open, marcas, marcaPadrao, onClose }: { open: boolean; marcas: Marca[]; marcaPadrao: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  const [f, setF] = useState({ empresaId: marcaPadrao || marcas[0]?.empresaId || 4, tipo: 'Vídeo' as 'Vídeo' | 'Post', titulo: '', data: hojeBR(), responsavelId: null as number | null, obs: '', status: 'Produção' as (typeof STATUS)[number] })
  const criar = trpc.marketingFluxo.criarComplementar.useMutation({ onSuccess: () => { utils.marketingModulo.pecas.invalidate(); toast.success('Demanda complementar criada'); onClose() }, onError: (e) => toast.error(e.message) })
  const campo = (rot: string, el: React.ReactNode) => <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>{el}</label>
  return (
    <Modal open={open} onClose={onClose} title="Nova demanda complementar" size="lg">
      <div className="space-y-3">
        <p className="text-sm text-dark-400">Para o que está fora do plano do mês: story, post de feedback de cliente, vídeo de evento, arte avulsa. Não conta na meta de 3 vídeos + 2 posts e não passa pela aprovação do roteiro — mas também precisa do anexo e da aprovação final para ir para Agendado.</p>
        {campo('O que é', <input className={cls.input} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Story da feira, post de feedback da Metalúrgica X" />)}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {campo('Marca', <select className={cls.input} value={f.empresaId} onChange={(e) => setF({ ...f, empresaId: Number(e.target.value) })}>{marcas.map((m) => <option key={m.empresaId} value={m.empresaId}>{nomeCurtoMarca(m.nome)}</option>)}</select>)}
          {campo('Tipo', <select className={cls.input} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'Vídeo' | 'Post' })}><option>Vídeo</option><option>Post</option></select>)}
          {campo('Data', <input type="date" className={cls.input} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />)}
          {campo('Começa em', <select className={cls.input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as (typeof STATUS)[number] })}>{STATUS.slice(0, 4).map((s) => <option key={s}>{s}</option>)}</select>)}
        </div>
        {campo('Responsável', <select className={cls.input} value={f.responsavelId ?? ''} onChange={(e) => setF({ ...f, responsavelId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{(equipe.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>)}
        {campo('Detalhes', <textarea rows={3} className={cls.input} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} />)}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => criar.mutate(f)} loading={criar.isPending}>Criar</Button></div>
      </div>
    </Modal>
  )
}

export default function AbaQuadro({ mes, marcas, pecas, abrirPeca }: { mes: string; marcas: Marca[]; pecas: Peca[]; abrirPeca: (p: Peca) => void }) {
  const { user } = useAuth()
  const utils = trpc.useUtils()
  const [fMarca, setFMarca] = useState<number | 0>(0)
  const [fResp, setFResp] = useState<'todos' | 'meus' | 'sem'>('todos')
  const [fSemana, setFSemana] = useState(0)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [novaComp, setNovaComp] = useState(false)
  const equipe = trpc.marketingFluxo.equipe.useQuery()
  const auto = trpc.marketingFluxo.autoSemana.useQuery()
  const salvarAuto = trpc.marketingFluxo.salvarAutoSemana.useMutation({ onSuccess: () => utils.marketingFluxo.autoSemana.invalidate() })
  const retornos = trpc.marketingFluxo.ultimosRetornos.useQuery({ pecaIds: pecas.map((p) => p.id) }, { enabled: pecas.length > 0 })
  const mover = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => utils.marketingModulo.pecas.invalidate() })
  const gerar = trpc.marketingFluxo.gerarSemana.useMutation({
    onSuccess: (r) => {
      utils.marketingModulo.pecas.invalidate(); utils.marketingModulo.planos.invalidate()
      toast.success(r.total ? `${r.total} peças criadas (${r.marcas.filter((m) => m.videos + m.posts).map((m) => `${nomeCurtoMarca(m.nome)}: ${m.videos}V ${m.posts}P`).join(' · ')})` : 'Todas as marcas já têm as peças da semana.', { duration: 8000 })
    },
    onError: (e) => toast.error(e.message),
  })

  const semanas = semanasDoMes(mes)
  const nomeMarca = (id: number) => nomeCurtoMarca(marcas.find((m) => m.empresaId === id)?.nome || '')
  const nomePessoa = (id?: number | null) => equipe.data?.find((u) => u.id === id)?.name || ''
  const lista = useMemo(() => {
    let l = pecas
    if (fMarca) l = l.filter((p) => p.empresaId === fMarca)
    if (fResp === 'meus') l = l.filter((p) => p.responsavelId === user?.id)
    if (fResp === 'sem') l = l.filter((p) => !p.responsavelId)
    if (fSemana) { const [a, b] = faixaSemana(mes, semanas[fSemana - 1]); l = l.filter((p) => p.data && p.data >= a && p.data <= b) }
    return [...l].sort((a, b) => (a.data || '9').localeCompare(b.data || '9'))
  }, [pecas, fMarca, fResp, fSemana, user?.id])

  // Carga da semana atual por pessoa (peças ainda não agendadas).
  const carga = useMemo(() => {
    const h = hojeBR()
    const w = semanas.find((s) => { const [a, b] = faixaSemana(mes, s); return h >= a && h <= b })
    if (!w) return []
    const [a, b] = faixaSemana(mes, w)
    const abertas = pecas.filter((p) => p.data && p.data >= a && p.data <= b && p.status !== 'Agendado na mLabs')
    const m = new Map<string, number>()
    abertas.forEach((p) => { const k = nomePessoa(p.responsavelId) || 'Sem responsável'; m.set(k, (m.get(k) || 0) + 1) })
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [pecas, equipe.data])

  const atrasadas = lista.filter(atrasada).length
  const paradas = lista.filter((p) => diasParada(p) >= 3).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[{ empresaId: 0, nome: 'Todas' }, ...marcas].map((m) => (
            <button key={m.empresaId} onClick={() => setFMarca(m.empresaId)} className={`px-3 py-1 rounded-full text-xs border ${fMarca === m.empresaId ? 'bg-dark-100 text-dark-900 border-dark-100 font-semibold' : 'border-dark-600 text-dark-300'}`}>{nomeCurtoMarca(m.nome)}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={cls.input + ' w-auto'} value={fSemana} onChange={(e) => setFSemana(Number(e.target.value))}><option value={0}>Mês inteiro</option>{semanas.map((s) => <option key={s.n} value={s.n}>Semana {s.n} ({s.ini}–{s.fim})</option>)}</select>
          <select className={cls.input + ' w-auto'} value={fResp} onChange={(e) => setFResp(e.target.value as any)}><option value="todos">Todos</option><option value="meus">Só as minhas</option><option value="sem">Sem responsável</option></select>
          <Button size="sm" variant="secondary" onClick={() => gerar.mutate({ empresaId: fMarca || undefined })} loading={gerar.isPending}>Criar peças da semana</Button>
          <Button size="sm" onClick={() => setNovaComp(true)}>+ Demanda complementar</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="text-dark-300">{lista.length} peças</span>
        {atrasadas > 0 && <span className="text-red-400 font-semibold">{atrasadas} atrasadas</span>}
        {paradas > 0 && <span className="text-orange-300">{paradas} paradas há 3+ dias</span>}
        {carga.length > 0 && <span className="text-dark-400">Carga desta semana: {carga.map(([n, q]) => <b key={n} className="text-dark-200 mr-2">{n.split(' ')[0]} {q}</b>)}</span>}
        <label className="ml-auto flex items-center gap-2 text-dark-400 cursor-pointer">
          <input type="checkbox" checked={!!auto.data?.ligado} onChange={(e) => salvarAuto.mutate({ ligado: e.target.checked })} />
          Criar sozinho toda segunda às 6h (meta da semana de cada marca)
        </label>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {STATUS.map((st) => {
          const col = lista.filter((p) => (p.status || 'Ideia') === st)
          return (
            <div key={st} className={`min-w-[250px] w-[250px] flex-shrink-0 rounded-xl border ${arrastando ? 'border-dashed border-dark-500' : 'border-dark-700'} bg-dark-900/40`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); setArrastando(null); const p = pecas.find((x) => x.id === id); if (p && p.status !== st) mover.mutate({ id, status: st }, { onError: (err) => toast.error(err.message, { duration: 8000 }) }) }}>
              <div className="px-3 py-2 border-b border-dark-700"><div className="flex justify-between text-sm"><b className="text-dark-100">{st}</b><span className="text-dark-400">{col.length}</span></div><div className="text-[11px] text-dark-500">{DICA_COL[st]}</div></div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {col.map((p) => {
                  const atr = atrasada(p)
                  const par = diasParada(p)
                  const ret = retornos.data?.[p.id]
                  const resp = nomePessoa(p.responsavelId)
                  const feitos = (p.checklist || []).filter((c) => c.ok).length
                  return (
                    <div key={p.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setArrastando(p.id) }} onDragEnd={() => setArrastando(null)} onClick={() => abrirPeca(p)}
                      className={`cursor-pointer rounded-lg p-2.5 space-y-1.5 border bg-dark-800 hover:border-dark-500 ${atr ? 'border-red-600' : 'border-dark-700'}`}>
                      <div className="flex justify-between text-[11px] text-dark-400"><span>{nomeMarca(p.empresaId)} · {p.tipo}</span><span className={atr ? 'text-red-400 font-semibold' : ''}>{diaLabel(p.data)}</span></div>
                      <div className="text-sm font-semibold text-dark-100 leading-snug">{p.titulo || 'Sem título'}</div>
                      {p.roteiroAprovadoEm && p.status === 'Produção' && <div className="text-[11px] font-semibold px-2 py-0.5 rounded bg-green-900/50 text-green-200 inline-block">✅ Liberado para gravação</div>}
                      {p.finalAprovadoEm && p.status === 'Aprovação final' && <div className="text-[11px] font-semibold px-2 py-0.5 rounded bg-green-900/50 text-green-200 inline-block">✅ Aprovado — agendar na mLabs</div>}
                      {p.status === 'Produção' && !(p.anexos || []).length && <div className="text-[11px] text-orange-300">falta anexar o {p.tipo === 'Post' ? 'post' : 'vídeo'}</div>}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {resp ? <span title={resp} className="w-6 h-6 rounded-full bg-gold-900/50 text-gold-200 flex items-center justify-center font-bold">{iniciais(resp)}</span> : <span className="text-dark-500">sem responsável</span>}
                        {(p.checklist || []).length > 0 && <span className="text-dark-300">☑ {feitos}/{p.checklist!.length}</span>}
                        {atr && <span className="text-red-400 font-semibold">atrasada</span>}
                        {!atr && par >= 3 && <span className="text-orange-300">parada {par}d</span>}
                        {ret?.tipo === 'ajuste' && ['Roteiro', 'Produção'].includes(p.status) && <span className="text-yellow-300" title={ret.texto}>ajuste pedido</span>}
                        {p.origem === 'complementar' && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-200">complementar</span>}
                        {(p.anexos || []).length > 0 && <span className="text-dark-300" title={(p.anexos || []).map((a) => a.nome).join(', ')}>📎 {(p.anexos || []).length}</span>}
                        {p.origem === 'auto' && p.titulo.includes('pauta a definir') && <span className="text-dark-500">automática</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {novaComp && <NovaComplementar open={novaComp} marcas={marcas} marcaPadrao={fMarca} onClose={() => setNovaComp(false)} />}
    </div>
  )
}
