// Empresa: Instagram dos últimos 90 dias + Persona + SWOT da marca.
import { useEffect, useRef, useState } from 'react'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import IaAcao from './IaAcao'
import { cls, fmtN, pct, diaLabel } from './comum'

const CAMPOS: [string, string, string][] = [
  ['nome', 'Nome da persona', 'Ex.: Carlos, dono de oficina mecânica'], ['quem', 'Quem é', 'Cargo, tipo de empresa, cidade, idade'], ['dores', 'Dores', 'O que tira o sono dela'],
  ['desejos', 'O que ela quer', 'Resultado que busca'], ['objecoes', 'Objeções', 'Por que não compraria'], ['onde', 'Onde se informa', 'Instagram, WhatsApp, YouTube, vendedor…'], ['tom', 'Como falar com ela', 'Tom, palavras que usa, o que evitar'],
]
const QUADS: [string, string, string, string][] = [
  ['forcas', 'Forças', 'border-t-green-500', 'O que fazemos melhor que os concorrentes'], ['fraquezas', 'Fraquezas', 'border-t-orange-500', 'O que atrapalha hoje'],
  ['oportunidades', 'Oportunidades', 'border-t-blue-500', 'O que o mercado está abrindo'], ['ameacas', 'Ameaças', 'border-t-pink-500', 'O que pode tirar venda'],
]
type Perfil = { personas: Record<string, string>[]; swot: Record<string, string[]>; concorrentes: { handle: string; obs?: string }[] }

export default function AbaEmpresa({ empresaId, nomeMarca, mes }: { empresaId: number; nomeMarca: string; mes: string }) {
  const utils = trpc.useUtils()
  const ig = trpc.marketingModulo.igEmpresa.useQuery({ empresaId, mes })
  const perfilQ = trpc.marketingModulo.perfil.useQuery({ empresaId })
  const analises = trpc.marketingModulo.analises.useQuery({ empresaId })
  const salvar = trpc.marketingModulo.salvarPerfil.useMutation({ onSuccess: () => { setSalvo(true); utils.marketingModulo.perfil.invalidate() } })
  const [perf, setPerf] = useState<Perfil | null>(null)
  const [salvo, setSalvo] = useState(true)
  const [sugestao, setSugestao] = useState<{ personas: any[]; swot: any } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { if (perfilQ.data && salvo) setPerf(perfilQ.data as Perfil) }, [perfilQ.data, empresaId])
  useEffect(() => { setPerf(null) }, [empresaId])

  const mudar = (novo: Perfil) => {
    setPerf(novo)
    setSalvo(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => salvar.mutate({ empresaId, personas: novo.personas, swot: novo.swot, concorrentes: novo.concorrentes }), 800)
  }
  const aplicarSug = (juntar: boolean) => {
    if (!perf || !sugestao) return
    const sw: Record<string, string[]> = {}
    for (const [k] of QUADS) sw[k] = juntar ? [...(perf.swot[k] || []), ...(sugestao.swot[k] || [])] : sugestao.swot[k] || []
    mudar({ ...perf, personas: juntar ? [...perf.personas, ...sugestao.personas] : sugestao.personas, swot: sw })
    setSugestao(null)
  }

  const midias = ig.data?.midias || []
  const v = midias.filter((m) => m.tipo === 'Vídeo'), p = midias.filter((m) => m.tipo === 'Post')
  const med = (a: typeof midias, k: 'views' | 'alcance') => (a.length ? Math.round(a.reduce((s, x) => s + (x[k] || 0), 0) / a.length) : 0)
  const eng = (m: (typeof midias)[number]) => (m.alcance ? (m.curtidas + m.comentarios + m.compartilhamentos + m.salvos) / m.alcance : 0)
  const engM = midias.length ? midias.reduce((s, m) => s + eng(m), 0) / midias.length : 0
  const seg = ig.data?.seguidores || []
  const ord = [...midias].sort((a, b) => (b.views || b.alcance) - (a.views || a.alcance))
  const igA = (analises.data || []).find((x) => x.chave === `ig-${empresaId}`)

  const Linha = ({ m }: { m: (typeof midias)[number] }) => (
    <div className="flex items-center gap-2 py-1.5 border-b border-dark-700/50 text-sm">
      <span className="text-xs px-2 py-0.5 rounded bg-dark-700 text-dark-200 whitespace-nowrap">{m.tipo} · {diaLabel(m.data)}</span>
      <a href={m.permalink || '#'} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline truncate flex-1">{m.legenda.slice(0, 80) || 'Abrir'}</a>
      <span className="text-xs text-dark-400 whitespace-nowrap">{m.views ? `${fmtN(m.views)} views · ` : ''}{fmtN(m.alcance)} alc · {pct(eng(m))}</span>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-dark-100">{nomeMarca}</h2>
        <p className="text-sm text-dark-400">Instagram, persona e SWOT num lugar só. O Claude usa a persona e a SWOT sempre que cria ou revisa um roteiro.</p>
      </div>

      <section className={cls.card + ' p-4 space-y-4'}>
        <h3 className="text-lg font-bold text-dark-100">Instagram · últimos 90 dias</h3>
        {!ig.data?.conta ? <p className="text-sm text-dark-400">Instagram não ligado. O super admin liga em Marketing → Conexões.</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-dark-900/60 rounded-xl p-3"><div className={cls.rotulo}>Seguidores</div><div className="text-2xl font-bold text-dark-100">{seg.length ? fmtN(seg[seg.length - 1].seguidores) : '—'}</div><div className="text-xs text-dark-400">{seg.length > 1 ? `+${fmtN(seg[seg.length - 1].seguidores - seg[0].seguidores)} desde ${diaLabel(seg[0].data)}` : 'histórico começa a contar hoje'}</div></div>
              <div className="bg-dark-900/60 rounded-xl p-3"><div className={cls.rotulo}>Vídeos (Reels)</div><div className="text-2xl font-bold text-dark-100">{v.length}</div><div className="text-xs text-dark-400">média de {fmtN(med(v, 'views'))} views</div></div>
              <div className="bg-dark-900/60 rounded-xl p-3"><div className={cls.rotulo}>Posts</div><div className="text-2xl font-bold text-dark-100">{p.length}</div><div className="text-xs text-dark-400">média de {fmtN(med(p, 'alcance'))} de alcance</div></div>
              <div className="bg-dark-900/60 rounded-xl p-3"><div className={cls.rotulo}>Engajamento médio</div><div className="text-2xl font-bold text-dark-100">{pct(engM)}</div><div className="text-xs text-dark-400">interações ÷ alcance</div></div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div><div className={cls.rotulo + ' mb-1'}>Top 5</div>{ord.slice(0, 5).map((m) => <Linha key={m.id} m={m} />)}</div>
              <div><div className={cls.rotulo + ' mb-1'}>Piores 5</div>{ord.length > 5 ? ord.slice(-5).reverse().map((m) => <Linha key={m.id} m={m} />) : <p className="text-sm text-dark-400">Poucos posts para comparar.</p>}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2"><IaAcao tipo="instagram" params={{ empresaId }} rotulo="Claude, analisa o Instagram" desabilitado={!midias.length} onResultado={() => utils.marketingModulo.analises.invalidate()} /></div>
            {igA?.texto && <pre className="whitespace-pre-wrap text-sm text-dark-200 font-sans bg-dark-900/60 rounded-lg p-3">{igA.texto}</pre>}
          </>
        )}
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-lg font-bold text-dark-100">Persona</h3><p className="text-sm text-dark-400">Para quem a marca fala. Salva sozinho. {salvo ? '' : 'Salvando…'}</p></div>
          <IaAcao tipo="persona" params={{ empresaId }} rotulo="Claude sugere persona e SWOT" onResultado={(r) => setSugestao(r)} />
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(perf?.personas || []).map((pe, i) => (
            <div key={i} className="bg-dark-900/60 border border-dark-700 border-t-4 border-t-gold-500 rounded-xl p-3 space-y-2">
              {CAMPOS.map(([k, lab, ph]) => (
                <label key={k} className="block"><span className={cls.rotulo}>{lab}</span>
                  <textarea rows={k === 'nome' ? 1 : 2} placeholder={ph} className={cls.input + (k === 'nome' ? ' font-semibold' : '')} value={pe[k] || ''} onChange={(e) => { const ps = [...perf!.personas]; ps[i] = { ...pe, [k]: e.target.value }; mudar({ ...perf!, personas: ps }) }} />
                </label>))}
              <button className="text-xs text-red-400 hover:underline" onClick={() => mudar({ ...perf!, personas: perf!.personas.filter((_, j) => j !== i) })}>Remover persona</button>
            </div>))}
        </div>
        {perf && <Button variant="ghost" onClick={() => mudar({ ...perf, personas: [...perf.personas, {}] })}>+ Persona</Button>}
      </section>

      <section className="space-y-3">
        <div><h3 className="text-lg font-bold text-dark-100">Análise SWOT</h3><p className="text-sm text-dark-400">Forças e fraquezas são de dentro da empresa; oportunidades e ameaças vêm de fora. Um item por linha.</p></div>
        <div className="grid md:grid-cols-2 gap-3">
          {QUADS.map(([k, t, cor, sub]) => (
            <div key={k} className={`bg-dark-800 border border-dark-700 border-t-4 ${cor} rounded-xl p-3 space-y-1`}>
              <div className="font-bold text-dark-100">{t}</div><div className="text-xs text-dark-400">{sub}</div>
              <textarea rows={6} className={cls.input} value={(perf?.swot[k] || []).join('\n')} onChange={(e) => perf && mudar({ ...perf, swot: { ...perf.swot, [k]: e.target.value.split('\n') } })} onBlur={() => perf && mudar({ ...perf, swot: { ...perf.swot, [k]: (perf.swot[k] || []).map((s) => s.trim()).filter(Boolean) } })} />
            </div>))}
        </div>
      </section>

      <Modal open={!!sugestao} onClose={() => setSugestao(null)} title={`Sugestão do Claude · ${nomeMarca}`} size="xl">
        {sugestao && (
          <div className="space-y-3 text-sm">
            <p className="text-dark-400">Revise antes de usar. Dá para editar tudo depois.</p>
            {sugestao.personas.map((pe, i) => <div key={i} className="bg-dark-900/60 rounded-lg p-3 space-y-0.5">{CAMPOS.map(([k, lab]) => pe[k] ? <div key={k}><b className="text-dark-200">{lab}:</b> <span className="text-dark-300">{pe[k]}</span></div> : null)}</div>)}
            {QUADS.map(([k, t]) => <div key={k}><b className="text-dark-200">{t}:</b> <span className="text-dark-300">{(sugestao.swot[k] || []).join(' · ')}</span></div>)}
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setSugestao(null)}>Descartar</Button><Button variant="outline" onClick={() => aplicarSug(true)}>Juntar com o que já tem</Button><Button onClick={() => aplicarSug(false)}>Substituir pelo sugerido</Button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
