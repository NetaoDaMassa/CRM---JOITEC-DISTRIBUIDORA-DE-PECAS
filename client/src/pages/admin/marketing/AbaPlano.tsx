// Plano do mês: objetivo, pilares, metas, diagnóstico e aprendizados (editável, salva sozinho).
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { trpc } from '../../../lib/trpc'
import { CORES, cls, corPilar, mesLongo, nomeCurtoMarca } from './comum'
import type { Peca } from './PecaModal'

type Plano = { id: string; empresaId: number; mes: string; dados: any }
const linhas = (a?: string[]) => (a || []).join('\n')
const deLinhas = (s: string) => s.split('\n')

// Copiar os pilares para outras marcas no mesmo mês (João, 2026-11-23).
function CopiarPilares({ plano, pilares, nomeMarca, onClose }: { plano: Plano; pilares: any[]; nomeMarca: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const marcas = trpc.marketingModulo.marcas.useQuery()
  const outras = (marcas.data || []).filter((m) => m.empresaId !== plano.empresaId)
  const [sel, setSel] = useState<number[] | null>(null)
  const marcadas = sel ?? outras.map((m) => m.empresaId)
  const copiar = trpc.marketingModulo.copiarPilares.useMutation({
    onSuccess: (r) => { utils.marketingModulo.planos.invalidate(); utils.marketingModulo.pecas.invalidate(); toast.success(`Pilares copiados para: ${r.feitos.map(nomeCurtoMarca).join(', ')}`); onClose() },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title="Copiar pilares para outras marcas" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-dark-300">Os {pilares.length} pilares de <b>{nomeCurtoMarca(nomeMarca)}</b> em {mesLongo(plano.mes)} vão <b>substituir</b> os pilares das marcas marcadas, no mesmo mês. As peças que já existem lá passam para o pilar da mesma posição. Se a marca ainda não tem plano neste mês, ele é criado.</p>
        <div className="flex flex-wrap gap-2">{pilares.map((p) => <span key={p.id} className="text-xs font-bold px-2 py-1 rounded" style={{ background: `${corPilar(p.cor)}22`, color: corPilar(p.cor) }}>{p.nome}</span>)}</div>
        <div className="space-y-2">
          {outras.map((m) => (
            <label key={m.empresaId} className="flex items-center gap-3 bg-dark-900/60 border border-dark-700 rounded-lg px-3 py-2.5 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={marcadas.includes(m.empresaId)} onChange={(e) => setSel(e.target.checked ? [...marcadas, m.empresaId] : marcadas.filter((x) => x !== m.empresaId))} />
              <span className="text-dark-100 font-semibold">{m.nome}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => copiar.mutate({ planoId: plano.id, empresas: marcadas as any, pilares })} loading={copiar.isPending} disabled={!marcadas.length}>Copiar para {marcadas.length} marca(s)</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function AbaPlano({ plano, nomeMarca, pecas, salvarDados }: { plano: Plano; nomeMarca: string; pecas: Peca[]; salvarDados: (d: any) => void }) {
  const [d, setD] = useState<any>(plano.dados)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [copiar, setCopiar] = useState(false)
  useEffect(() => { setD(plano.dados) }, [plano.id])
  const mudar = (novo: any) => {
    setD(novo)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => salvarDados(novo), 800)
  }
  const pilares: any[] = d.pilares || []
  // Ordem dos pilares (João, 2026-11-23): a mesma ordem vale no Calendário.
  const moverPilar = (i: number, dir: number) => { const ps = [...pilares]; const j = i + dir; if (j < 0 || j >= ps.length) return; [ps[i], ps[j]] = [ps[j], ps[i]]; mudar({ ...d, pilares: ps }) }
  const setPilar = (i: number, campos: any) => { const ps = [...pilares]; ps[i] = { ...ps[i], ...campos }; mudar({ ...d, pilares: ps }) }
  const lista = (k: string, rot: string, cor: string) => (
    <div className={`bg-dark-800 border border-dark-700 border-t-4 ${cor} rounded-xl p-3 space-y-1`}>
      <div className="font-bold text-dark-100">{rot}</div>
      <textarea rows={5} className={cls.input} value={linhas(d[k])} onChange={(e) => mudar({ ...d, [k]: deLinhas(e.target.value) })} placeholder="Um item por linha" />
    </div>
  )
  const v = pecas.filter((p) => p.tipo !== 'Post').length

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-[1.3fr_1fr] gap-4 items-end">
        <div>
          <div className={cls.rotulo}>Planejamento · {nomeMarca}</div>
          <h2 className="text-3xl font-bold text-dark-100">{mesLongo(plano.mes)}</h2>
          <div className="text-xs text-dark-400 mt-1">{pecas.length} peças · {v} vídeos · {pecas.length - v} posts</div>
        </div>
        <div className="bg-gold-900/30 border border-gold-700/50 rounded-xl p-4 space-y-2">
          <div className={cls.rotulo}>Objetivo principal do mês</div>
          <textarea rows={2} className={cls.input + ' font-semibold'} value={d.objetivo || ''} onChange={(e) => mudar({ ...d, objetivo: e.target.value })} />
          <div className={cls.rotulo}>Mensagem central</div>
          <textarea rows={2} className={cls.input} value={d.mensagem || ''} onChange={(e) => mudar({ ...d, mensagem: e.target.value })} />
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-lg font-bold text-dark-100">Pilares</h3><span className="text-xs text-dark-400">Use ▲▼ para mudar a ordem (a mesma ordem aparece no Calendário).</span></div>
          <Button size="sm" variant="secondary" onClick={() => setCopiar(true)} disabled={!pilares.length}>Copiar estes pilares para as outras marcas</Button>
        </div>
        {copiar && <CopiarPilares plano={plano} pilares={pilares} nomeMarca={nomeMarca} onClose={() => setCopiar(false)} />}
        {pilares.map((p, i) => (
          <div key={p.id} className="bg-dark-800 border border-dark-700 rounded-xl p-3 grid md:grid-cols-[200px_repeat(4,1fr)] gap-3" style={{ borderLeft: `6px solid ${corPilar(p.cor)}` }}>
            <div className="space-y-1">
              <input className={cls.input + ' font-bold uppercase'} style={{ color: corPilar(p.cor) }} value={p.nome} onChange={(e) => setPilar(i, { nome: e.target.value })} />
              <textarea rows={2} className={cls.input + ' text-xs'} value={p.desc || ''} onChange={(e) => setPilar(i, { desc: e.target.value })} />
              <div className="flex items-center gap-2 text-xs text-dark-400">
                <button className="w-5 h-5 rounded" style={{ background: corPilar(p.cor) }} title="Trocar cor" onClick={() => setPilar(i, { cor: CORES[(CORES.indexOf(p.cor) + 1) % CORES.length] })} />
                {pecas.filter((x) => x.pilar === p.id).length} peças
                <span className="flex gap-0.5 ml-1" title="Mudar a ordem dos pilares">
                  <button disabled={i === 0} className="px-1.5 rounded bg-dark-700 hover:bg-dark-600 disabled:opacity-30" onClick={() => moverPilar(i, -1)}>▲</button>
                  <button disabled={i === pilares.length - 1} className="px-1.5 rounded bg-dark-700 hover:bg-dark-600 disabled:opacity-30" onClick={() => moverPilar(i, 1)}>▼</button>
                </span>
                <button className="text-red-400 hover:underline ml-auto" onClick={() => { if (confirm(`Remover o pilar ${p.nome}?`)) mudar({ ...d, pilares: pilares.filter((_, j) => j !== i) }) }}>remover</button>
              </div>
            </div>
            {(['estrategias', 'formatos', 'canais', 'metricas'] as const).map((k) => (
              <label key={k} className="block"><span className={cls.rotulo}>{{ estrategias: 'Estratégias', formatos: 'Formatos', canais: 'Canais', metricas: 'Métricas' }[k]}</span>
                <textarea rows={4} className={cls.input + ' text-xs'} value={linhas(p[k])} onChange={(e) => setPilar(i, { [k]: deLinhas(e.target.value) })} placeholder="Um por linha" /></label>
            ))}
          </div>
        ))}
        <Button variant="ghost" onClick={() => { const usadas = new Set(pilares.map((x) => x.cor)); mudar({ ...d, pilares: [...pilares, { id: 'p' + Date.now().toString(36), nome: 'Novo pilar', cor: CORES.find((c) => !usadas.has(c)) || 'cinza', desc: '', estrategias: [], formatos: [], canais: [], metricas: [] }] }) }}>+ Pilar</Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-dark-100">Metas do mês</h3>
        <div className="space-y-2">
          {(d.metas || []).map((g: any, i: number) => (
            <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_auto] gap-2">
              {(['nome', 'atual', 'meta'] as const).map((k) => <input key={k} className={cls.input} placeholder={{ nome: 'Indicador', atual: 'Hoje', meta: 'Meta' }[k]} value={g[k] || ''} onChange={(e) => { const ms = [...d.metas]; ms[i] = { ...g, [k]: e.target.value }; mudar({ ...d, metas: ms }) }} />)}
              <button className="text-dark-500 hover:text-red-400 px-2" onClick={() => mudar({ ...d, metas: d.metas.filter((_: any, j: number) => j !== i) })}>×</button>
            </div>))}
          <Button variant="ghost" size="sm" onClick={() => mudar({ ...d, metas: [...(d.metas || []), { nome: '', atual: '', meta: '' }] })}>+ meta</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-dark-100">Diagnóstico</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(d.diagnostico || []).map((x: any, i: number) => (
            <div key={i} className={`bg-dark-800 border rounded-xl p-3 space-y-1 ${x.alerta ? 'border-red-700' : 'border-dark-700'}`}>
              <input className={cls.input + ' text-xs uppercase'} value={x.rotulo || ''} onChange={(e) => { const a = [...d.diagnostico]; a[i] = { ...x, rotulo: e.target.value }; mudar({ ...d, diagnostico: a }) }} />
              <input className={cls.input + ' text-xl font-bold'} value={x.valor || ''} onChange={(e) => { const a = [...d.diagnostico]; a[i] = { ...x, valor: e.target.value }; mudar({ ...d, diagnostico: a }) }} />
              <textarea rows={2} className={cls.input + ' text-xs'} value={x.texto || ''} onChange={(e) => { const a = [...d.diagnostico]; a[i] = { ...x, texto: e.target.value }; mudar({ ...d, diagnostico: a }) }} />
              <div className="flex justify-between text-xs text-dark-400"><label className="flex gap-1 items-center"><input type="checkbox" checked={!!x.alerta} onChange={(e) => { const a = [...d.diagnostico]; a[i] = { ...x, alerta: e.target.checked }; mudar({ ...d, diagnostico: a }) }} />alerta</label><button className="hover:text-red-400" onClick={() => mudar({ ...d, diagnostico: d.diagnostico.filter((_: any, j: number) => j !== i) })}>remover</button></div>
            </div>))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => mudar({ ...d, diagnostico: [...(d.diagnostico || []), { rotulo: '', valor: '', texto: '', alerta: false }] })}>+ número do diagnóstico</Button>
        <div className="grid md:grid-cols-2 gap-3">{lista('funcionou', 'O que funcionou', 'border-t-green-500')}{lista('travou', 'O que travou', 'border-t-orange-500')}</div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-dark-100">O que muda neste mês</h3>
        <div className="grid md:grid-cols-3 gap-3">
          {(d.recomendacoes || []).map((r: any, i: number) => (
            <div key={i} className="bg-dark-800 border border-dark-700 rounded-xl p-3 space-y-1">
              <input className={cls.input + ' font-semibold'} value={r.titulo || ''} onChange={(e) => { const a = [...d.recomendacoes]; a[i] = { ...r, titulo: e.target.value }; mudar({ ...d, recomendacoes: a }) }} />
              <textarea rows={3} className={cls.input + ' text-xs'} value={r.texto || ''} onChange={(e) => { const a = [...d.recomendacoes]; a[i] = { ...r, texto: e.target.value }; mudar({ ...d, recomendacoes: a }) }} />
              <button className="text-xs text-dark-500 hover:text-red-400" onClick={() => mudar({ ...d, recomendacoes: d.recomendacoes.filter((_: any, j: number) => j !== i) })}>remover</button>
            </div>))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => mudar({ ...d, recomendacoes: [...(d.recomendacoes || []), { titulo: '', texto: '' }] })}>+ recomendação</Button>
      </section>
    </div>
  )
}
