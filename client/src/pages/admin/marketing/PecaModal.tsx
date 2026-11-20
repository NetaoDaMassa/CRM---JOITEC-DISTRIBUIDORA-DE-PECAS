// Editar uma peça (pauta, roteiro, legenda…) com Criar/Analisar/Reescrever pelo Claude.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import IaAcao from './IaAcao'
import { CANAIS, CANAIS_P, CANAIS_V, MODELO_P, MODELO_V, STATUS, cls, rotHash } from './comum'

export type Peca = {
  id: string; empresaId: number; planoId: string; data: string | null; hora: string | null; tipo: string; pilar: string | null
  titulo: string; gancho: string; cta: string; canais: string[]; status: string; roteiro: string; legenda: string; obs: string; analise: any
}
type Pilar = { id: string; nome: string; cor?: string; desc?: string }

export function AnaliseBox({ a, peca }: { a: any; peca: Peca }) {
  if (!a) return <p className="text-sm text-dark-400">Sem revisão do Claude ainda.</p>
  const cor = a.veredito === 'aprovar' ? 'text-green-400' : a.veredito === 'ajustar' ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b className={cor}>Nota {a.nota}/10 · {a.veredito}</b>{a.hash !== rotHash(peca) && <span className="text-xs text-dark-400">(o roteiro mudou depois da revisão)</span>}</div>
      <div className="text-dark-200">{a.resumo}</div>
      {a.problemas?.length > 0 && <ul className="list-disc pl-5 text-dark-300">{a.problemas.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}
      {a.confirmar?.length > 0 && <div className="text-orange-300 text-xs">Confirmar antes de gravar: {a.confirmar.join(' · ')}</div>}
      {a.gancho && <div className="bg-gold-900/20 border border-gold-800/40 rounded-lg px-3 py-2 text-dark-100"><b>Gancho sugerido:</b> {a.gancho}</div>}
    </div>
  )
}

export default function PecaModal({ peca, pilares, personaResumo, onClose }: { peca: Peca | null; pilares: Pilar[]; personaResumo?: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [p, setP] = useState<Peca | null>(peca)
  const [salvo, setSalvo] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const salvar = trpc.marketingModulo.salvarPeca.useMutation({ onSuccess: () => { setSalvo(true); utils.marketingModulo.pecas.invalidate() }, onError: (e) => toast.error(e.message) })
  const excluir = trpc.marketingModulo.excluirPeca.useMutation({ onSuccess: () => { utils.marketingModulo.pecas.invalidate(); onClose() } })
  const [confirmaExcluir, setConfirmaExcluir] = useState(false)
  useEffect(() => { setP(peca); setSalvo(true) }, [peca?.id])

  if (!p) return null
  const mudar = (campos: Partial<Peca>) => {
    const novo = { ...p, ...campos }
    setP(novo)
    setSalvo(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const { id, data, hora, tipo, pilar, titulo, gancho, cta, canais, status, roteiro, legenda, obs } = novo
      salvar.mutate({ id, data: data || null, hora: hora || null, tipo: tipo as 'Vídeo' | 'Post', pilar, titulo, gancho, cta, canais, status, roteiro, legenda, obs })
    }, 700)
  }
  const fechar = () => {
    if (!salvo) {
      clearTimeout(timer.current)
      const { id, data, hora, tipo, pilar, titulo, gancho, cta, canais, status, roteiro, legenda, obs } = p
      salvar.mutate({ id, data: data || null, hora: hora || null, tipo: tipo as 'Vídeo' | 'Post', pilar, titulo, gancho, cta, canais, status, roteiro, legenda, obs })
    }
    onClose()
  }
  const campo = (rot: string, el: React.ReactNode) => <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>{el}</label>

  return (
    <Modal open={!!peca} onClose={fechar} title="Editar peça" size="xl">
      <div className="space-y-4">
        {campo('Pauta', <textarea className={cls.input + ' font-semibold'} rows={2} value={p.titulo} onChange={(e) => mudar({ titulo: e.target.value })} />)}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {campo('Data', <input type="date" className={cls.input} value={p.data || ''} onChange={(e) => mudar({ data: e.target.value || null })} />)}
          {campo('Hora', <input type="time" className={cls.input} value={p.hora || ''} onChange={(e) => mudar({ hora: e.target.value || null })} />)}
          {campo('Tipo', <select className={cls.input} value={p.tipo} onChange={(e) => mudar({ tipo: e.target.value })}><option>Vídeo</option><option>Post</option></select>)}
          {campo('Pilar', <select className={cls.input} value={p.pilar || ''} onChange={(e) => mudar({ pilar: e.target.value })}><option value="">—</option>{pilares.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>)}
          {campo('Status', <select className={cls.input} value={p.status} onChange={(e) => mudar({ status: e.target.value })}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>)}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between"><span className={cls.rotulo}>Canais</span><button className="text-xs text-gold-400 hover:underline" onClick={() => mudar({ canais: p.tipo === 'Post' ? [...CANAIS_P] : [...CANAIS_V] })}>Canais padrão do tipo</button></div>
          <div className="flex flex-wrap gap-2">{CANAIS.map((c) => (
            <label key={c} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${p.canais.includes(c) ? 'bg-gold-900/40 border-gold-600 text-gold-200' : 'border-dark-600 text-dark-300'}`}>
              <input type="checkbox" className="hidden" checked={p.canais.includes(c)} onChange={(e) => mudar({ canais: e.target.checked ? [...p.canais, c] : p.canais.filter((z) => z !== c) })} />{c}
            </label>))}</div>
        </div>
        {personaResumo && <details className="text-sm"><summary className="cursor-pointer text-dark-300 font-semibold">Persona e SWOT da marca</summary><pre className="whitespace-pre-wrap text-xs text-dark-300 bg-dark-900 rounded-lg p-3 mt-2">{personaResumo}</pre></details>}
        {campo('Gancho (primeiros 3 segundos)', <textarea className={cls.input} rows={2} value={p.gancho} onChange={(e) => mudar({ gancho: e.target.value })} />)}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Roteiro</span>
            <span className="flex flex-wrap gap-2">
              <IaAcao pequeno tipo="criar" params={{ pecaId: p.id }} rotulo="Criar com Claude" onResultado={(r) => mudar({ roteiro: r.roteiro, legenda: p.legenda.trim() ? p.legenda : r.legenda || '' })} />
              <Button size="sm" variant="ghost" onClick={() => { if (!p.roteiro.trim() || confirm('Substituir o roteiro pelo modelo em branco?')) mudar({ roteiro: p.tipo === 'Post' ? MODELO_P : MODELO_V }) }}>Inserir modelo</Button>
            </span>
          </div>
          <textarea className={cls.input + ' font-mono text-[13px] leading-relaxed'} rows={14} value={p.roteiro} onChange={(e) => mudar({ roteiro: e.target.value })} />
        </div>
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Revisão do Claude</span>
            <span className="flex flex-wrap gap-2">
              <IaAcao pequeno tipo="revisao" params={{ pecaIds: [p.id] }} rotulo="Analisar" onResultado={() => utils.marketingModulo.pecas.invalidate().then(() => utils.marketingModulo.pecas.fetch({ planoId: p.planoId }).then((l) => { const n = l.find((x) => x.id === p.id); if (n) setP((o) => (o ? { ...o, analise: n.analise } : o)) }))} />
              {p.analise && <IaAcao pequeno tipo="reescrever" params={{ pecaId: p.id }} rotulo="Reescrever" onResultado={(r) => mudar({ roteiro: r.roteiro })} />}
            </span>
          </div>
          <AnaliseBox a={p.analise} peca={p} />
          {p.analise?.gancho && <Button size="sm" variant="outline" onClick={() => mudar({ gancho: p.analise.gancho })}>Usar gancho sugerido</Button>}
        </div>
        {campo('Legenda e hashtags', <textarea className={cls.input} rows={4} value={p.legenda} onChange={(e) => mudar({ legenda: e.target.value })} />)}
        {campo('CTA', <input className={cls.input} value={p.cta} onChange={(e) => mudar({ cta: e.target.value })} />)}
        {campo('Observações', <textarea className={cls.input} rows={2} value={p.obs} onChange={(e) => mudar({ obs: e.target.value })} />)}
        <div className="flex items-center justify-between pt-2 border-t border-dark-700">
          {confirmaExcluir ? (
            <span className="flex gap-2"><Button variant="danger" size="sm" onClick={() => excluir.mutate({ id: p.id })}>Confirmar exclusão</Button><Button size="sm" variant="ghost" onClick={() => setConfirmaExcluir(false)}>Cancelar</Button></span>
          ) : <Button variant="danger" size="sm" onClick={() => setConfirmaExcluir(true)}>Excluir peça</Button>}
          <span className="text-xs text-dark-400">{salvo ? 'Salvo' : 'Salvando…'}</span>
        </div>
      </div>
    </Modal>
  )
}
