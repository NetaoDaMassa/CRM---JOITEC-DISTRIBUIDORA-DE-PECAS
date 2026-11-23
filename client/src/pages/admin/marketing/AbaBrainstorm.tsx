// Brainstorm: ideias e links que inspiram, por marca. João, 2026-11-23: o
// card abre com mais informações, a IA traz a ideia para a realidade da
// empresa (ou copia o pedido para o Claude) e a ideia vira peça no calendário.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import IaAcao from './IaAcao'
import { cls, mesLongo, mesSomar } from './comum'

type Ideia = { id: number; empresaId: number; url: string; nota: string; titulo: string; detalhes: string; adaptacao: string; status: string; usadaEm: string | null; createdAt: string }

function rede(u: string) {
  if (!u) return 'ideia'
  try {
    const h = new URL(u).hostname.replace(/^www\./, '')
    if (/instagram/.test(h)) return 'Instagram'
    if (/tiktok/.test(h)) return 'TikTok'
    if (/youtu/.test(h)) return 'YouTube'
    if (/facebook|fb\./.test(h)) return 'Facebook'
    if (/linkedin/.test(h)) return 'LinkedIn'
    return h
  } catch { return 'link' }
}
const normUrl = (u: string) => { const t = u.trim(); return t && !/^https?:\/\//i.test(t) ? 'https://' + t : t }

function IdeiaModal({ ideia, mes, nomeMarca, onClose }: { ideia: Ideia | null; mes: string; nomeMarca: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [f, setF] = useState<Ideia | null>(ideia)
  const [paraCal, setParaCal] = useState({ mes, tipo: 'Vídeo' as 'Vídeo' | 'Post', data: '' })
  const inv = () => utils.marketingModulo.ideias.invalidate()
  const salvar = trpc.marketingModulo.atualizarIdeia.useMutation({ onSuccess: inv, onError: (e) => toast.error(e.message) })
  const excluir = trpc.marketingModulo.excluirIdeia.useMutation({ onSuccess: () => { inv(); onClose() } })
  const virarPeca = trpc.marketingModulo.ideiaParaPeca.useMutation({ onSuccess: () => { inv(); utils.marketingModulo.pecas.invalidate(); utils.marketingModulo.planos.invalidate(); toast.success(`Peça criada no calendário de ${mesLongo(paraCal.mes)} (etapa Ideia)`); onClose() }, onError: (e) => toast.error(e.message) })
  if (!ideia || !f) return null
  const mudou = ['titulo', 'url', 'nota', 'detalhes', 'adaptacao'].some((k) => (f as any)[k] !== (ideia as any)[k])
  const gravar = (fechar = false) => salvar.mutate({ id: f.id, titulo: f.titulo, url: normUrl(f.url), nota: f.nota, detalhes: f.detalhes, adaptacao: f.adaptacao }, { onSuccess: () => { toast.success('Salvo'); if (fechar) onClose() } })
  const campo = (rot: string, el: React.ReactNode) => <label className="block space-y-1"><span className={cls.rotulo}>{rot}</span>{el}</label>
  return (
    <Modal open={!!ideia} onClose={() => { if (mudou) gravar(); onClose() }} title={`Ideia · ${nomeMarca}`} size="xl">
      <div className="space-y-3">
        {campo('Ideia / título', <input className={cls.input + ' font-semibold'} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Antes e depois de uma instalação de ar comprimido" />)}
        <div className="grid md:grid-cols-2 gap-3">
          {campo('Link de inspiração', <div className="flex gap-2"><input className={cls.input} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />{f.url && <a href={normUrl(f.url)} target="_blank" rel="noopener noreferrer" className="text-sm text-gold-400 hover:underline self-center whitespace-nowrap">abrir ↗</a>}</div>)}
          {campo('Por que inspira', <input className={cls.input} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Gancho forte, formato de antes e depois…" />)}
        </div>
        {campo('Mais informações', <textarea rows={4} className={cls.input} value={f.detalhes} onChange={(e) => setF({ ...f, detalhes: e.target.value })} placeholder="Como é o vídeo, o que aparece, o que falam, qual produto nosso combina, quem poderia gravar…" />)}
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cls.rotulo}>Trazer para a realidade da {nomeMarca}</span>
            <IaAcao pequeno tipo="adaptar" params={{ ideiaId: f.id }} rotulo="Adaptar com IA" onResultado={(r) => { setF((o) => (o ? { ...o, adaptacao: r.adaptacao } : o)); inv() }} />
          </div>
          <p className="text-xs text-dark-400">A IA usa a persona, o plano do mês e a base de conhecimento da empresa. Salve antes as informações acima para ela ler. "Copiar pedido" leva o mesmo texto para o Claude.</p>
          <textarea rows={10} className={cls.input + ' text-[13px]'} value={f.adaptacao} onChange={(e) => setF({ ...f, adaptacao: e.target.value })} placeholder="Aqui fica a ideia adaptada (título, formato, gancho, roteiro resumido…). Pode editar." />
        </div>
        <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-3 flex flex-wrap items-end gap-2">
          <span className="text-sm text-dark-200 font-semibold w-full">Levar para o calendário</span>
          {campo('Mês', <select className={cls.input} value={paraCal.mes} onChange={(e) => setParaCal({ ...paraCal, mes: e.target.value })}>{[0, 1, 2].map((n) => { const m = mesSomar(mes, n); return <option key={m} value={m}>{mesLongo(m)}</option> })}</select>)}
          {campo('Tipo', <select className={cls.input} value={paraCal.tipo} onChange={(e) => setParaCal({ ...paraCal, tipo: e.target.value as 'Vídeo' | 'Post' })}><option>Vídeo</option><option>Post</option></select>)}
          {campo('Dia (opcional)', <input type="date" className={cls.input} value={paraCal.data} min={`${paraCal.mes}-01`} max={`${paraCal.mes}-31`} onChange={(e) => setParaCal({ ...paraCal, data: e.target.value })} />)}
          <Button onClick={() => { if (mudou) gravar(); virarPeca.mutate({ id: f.id, mes: paraCal.mes, tipo: paraCal.tipo, data: paraCal.data || null }) }} loading={virarPeca.isPending}>Criar peça</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-dark-700">
          <span className="flex flex-wrap gap-2">
            {f.status !== 'usada' && <Button size="sm" variant="secondary" onClick={() => salvar.mutate({ id: f.id, status: 'usada', usadaEm: new Date().toLocaleDateString('pt-BR') }, { onSuccess: onClose })}>Marcar como usada</Button>}
            {f.status !== 'nova' && <Button size="sm" variant="secondary" onClick={() => salvar.mutate({ id: f.id, status: 'nova' }, { onSuccess: onClose })}>Voltar para novas</Button>}
            {f.status !== 'arquivada' && <Button size="sm" variant="ghost" onClick={() => salvar.mutate({ id: f.id, status: 'arquivada' }, { onSuccess: onClose })}>Arquivar</Button>}
            <Button size="sm" variant="danger" onClick={() => confirm('Excluir esta ideia?') && excluir.mutate({ id: f.id })}>Excluir</Button>
          </span>
          <Button onClick={() => gravar(true)} disabled={!mudou} loading={salvar.isPending}>Salvar</Button>
        </div>
      </div>
    </Modal>
  )
}

function NotasGerais({ empresaId }: { empresaId: number }) {
  const q = trpc.marketingModulo.notasBrainstorm.useQuery({ empresaId })
  const salvar = trpc.marketingModulo.salvarNotasBrainstorm.useMutation()
  const [t, setT] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { setT(null) }, [empresaId])
  const valor = t ?? q.data?.texto ?? ''
  return (
    <details className={cls.card + ' p-4'} open={!!q.data?.texto}>
      <summary className="cursor-pointer font-semibold text-dark-100">Anotações gerais do brainstorm <span className="text-xs font-normal text-dark-400">— temas, datas, campanhas, o que o comercial pediu… {salvar.isPending ? '(salvando…)' : ''}</span></summary>
      <textarea rows={6} className={cls.input + ' mt-3'} value={valor} placeholder="Escreva livre. Salva sozinho." onChange={(e) => { const v = e.target.value; setT(v); clearTimeout(timer.current); timer.current = setTimeout(() => salvar.mutate({ empresaId, texto: v }), 800) }} />
    </details>
  )
}

export default function AbaBrainstorm({ empresaId, nomeMarca, mes }: { empresaId: number; nomeMarca: string; mes: string }) {
  const utils = trpc.useUtils()
  const q = trpc.marketingModulo.ideias.useQuery({ empresaId })
  const criar = trpc.marketingModulo.criarIdeia.useMutation({ onSuccess: () => { setNova({ titulo: '', url: '', nota: '' }); utils.marketingModulo.ideias.invalidate() }, onError: (e) => toast.error(e.message) })
  const [nova, setNova] = useState({ titulo: '', url: '', nota: '' })
  const [aberta, setAberta] = useState<Ideia | null>(null)
  const add = () => criar.mutate({ empresaId, titulo: nova.titulo.trim(), url: normUrl(nova.url), nota: nova.nota.trim() })
  const grupos: [string, string][] = [['nova', 'Novas'], ['usada', 'Usadas'], ['arquivada', 'Arquivadas']]
  const ideias = (q.data || []) as Ideia[]
  return (
    <div className="space-y-5">
      <div><h2 className="text-2xl font-bold text-dark-100">Brainstorm · {nomeMarca}</h2><p className="text-sm text-dark-400">Guarde ideias e links que inspiram. Clique no card para completar, adaptar com IA e levar para o calendário.</p></div>
      <div className={cls.card + ' p-4 grid md:grid-cols-[1.4fr_1fr_1.2fr_auto] gap-3 items-end'}>
        <label className="block"><span className={cls.rotulo}>Ideia</span><input className={cls.input} placeholder="Escreva a ideia" value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
        <label className="block"><span className={cls.rotulo}>Link (opcional)</span><input className={cls.input} placeholder="https://www.instagram.com/p/..." value={nova.url} onChange={(e) => setNova({ ...nova, url: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
        <label className="block"><span className={cls.rotulo}>Por que inspira</span><input className={cls.input} placeholder="Gancho forte, antes e depois…" value={nova.nota} onChange={(e) => setNova({ ...nova, nota: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
        <Button onClick={add} disabled={!nova.titulo.trim() && !nova.url.trim()} loading={criar.isPending}>Adicionar</Button>
      </div>
      <NotasGerais empresaId={empresaId} />
      {grupos.map(([st, t]) => {
        const arr = ideias.filter((i) => i.status === st)
        if (st === 'arquivada' && !arr.length) return null
        return (
          <section key={st} className="space-y-2">
            <h3 className="text-lg font-bold text-dark-100">{t} ({arr.length})</h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
              {arr.map((i) => (
                <button key={i.id} onClick={() => setAberta(i)} className={`text-left bg-dark-800 border border-dark-700 hover:border-dark-500 border-l-4 rounded-xl p-3 space-y-1.5 ${st === 'nova' ? 'border-l-gold-500' : st === 'usada' ? 'border-l-green-500 opacity-85' : 'border-l-dark-600 opacity-70'}`}>
                  <div className="flex justify-between text-xs text-dark-400"><span>{rede(i.url)}</span><span>{i.createdAt.slice(8, 10)}/{i.createdAt.slice(5, 7)}</span></div>
                  {i.titulo && <div className="text-sm font-semibold text-dark-100 leading-snug">{i.titulo}</div>}
                  {i.url && <div className="text-xs text-gold-400 break-all">{i.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</div>}
                  {i.nota && <div className="text-sm text-dark-300 line-clamp-3">{i.nota}</div>}
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {i.adaptacao && <span className="px-1.5 py-0.5 rounded bg-gold-900/40 text-gold-200">✨ adaptada para a empresa</span>}
                    {i.detalhes && <span className="text-dark-400">+ informações</span>}
                    {i.usadaEm && <span className="text-green-400">usada em {i.usadaEm}</span>}
                  </div>
                </button>))}
            </div>
            {!arr.length && <p className="text-sm text-dark-400">Nada aqui.</p>}
          </section>
        )
      })}
      <IdeiaModal key={aberta?.id} ideia={aberta} mes={mes} nomeMarca={nomeMarca} onClose={() => setAberta(null)} />
    </div>
  )
}
