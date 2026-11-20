// Brainstorm: links de posts/vídeos que inspiram, por marca.
import { useState } from 'react'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import { cls } from './comum'

function rede(u: string) {
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

export default function AbaBrainstorm({ empresaId, nomeMarca }: { empresaId: number; nomeMarca: string }) {
  const utils = trpc.useUtils()
  const q = trpc.marketingModulo.ideias.useQuery({ empresaId })
  const inv = () => utils.marketingModulo.ideias.invalidate()
  const criar = trpc.marketingModulo.criarIdeia.useMutation({ onSuccess: () => { setUrl(''); setNota(''); inv() } })
  const atualizar = trpc.marketingModulo.atualizarIdeia.useMutation({ onSuccess: inv })
  const excluir = trpc.marketingModulo.excluirIdeia.useMutation({ onSuccess: inv })
  const [url, setUrl] = useState('')
  const [nota, setNota] = useState('')
  const add = () => { let u = url.trim(); if (!u) return; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; criar.mutate({ empresaId, url: u, nota: nota.trim() }) }
  const grupos: [string, string][] = [['nova', 'Novas'], ['usada', 'Usadas'], ['arquivada', 'Arquivadas']]
  return (
    <div className="space-y-5">
      <div><h2 className="text-2xl font-bold text-dark-100">Brainstorm · {nomeMarca}</h2><p className="text-sm text-dark-400">Guarde posts e vídeos que inspiram. As ideias novas entram no planejamento do mês seguinte.</p></div>
      <div className={cls.card + ' p-4 grid md:grid-cols-[1fr_1.5fr_auto] gap-3 items-end'}>
        <label className="block"><span className={cls.rotulo}>Link</span><input className={cls.input} placeholder="https://www.instagram.com/p/..." value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
        <label className="block"><span className={cls.rotulo}>Por que inspira</span><input className={cls.input} placeholder="Gancho forte, formato de antes e depois…" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        <Button onClick={add} disabled={!url.trim()}>Adicionar ideia</Button>
      </div>
      {grupos.map(([st, t]) => {
        const arr = (q.data || []).filter((i) => i.status === st)
        if (st === 'arquivada' && !arr.length) return null
        return (
          <section key={st} className="space-y-2">
            <h3 className="text-lg font-bold text-dark-100">{t} ({arr.length})</h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
              {arr.map((i) => (
                <div key={i.id} className={`bg-dark-800 border border-dark-700 border-l-4 rounded-xl p-3 space-y-2 ${st === 'nova' ? 'border-l-gold-500' : st === 'usada' ? 'border-l-green-500 opacity-85' : 'border-l-dark-600 opacity-70'}`}>
                  <div className="flex justify-between text-xs text-dark-400"><span>{rede(i.url)}</span><span>{i.createdAt.slice(8, 10)}/{i.createdAt.slice(5, 7)}</span></div>
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="block text-sm text-gold-400 hover:underline break-all">{i.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a>
                  {i.nota && <div className="text-sm text-dark-200 whitespace-pre-wrap">{i.nota}</div>}
                  {i.usadaEm && <div className="text-xs text-green-400">Usada em {i.usadaEm}</div>}
                  <div className="flex flex-wrap gap-2">
                    {st === 'nova' ? <Button size="sm" variant="secondary" onClick={() => atualizar.mutate({ id: i.id, status: 'usada', usadaEm: new Date().toLocaleDateString('pt-BR') })}>Marcar como usada</Button> : <Button size="sm" variant="secondary" onClick={() => atualizar.mutate({ id: i.id, status: 'nova' })}>Voltar para novas</Button>}
                    {st !== 'arquivada' && <Button size="sm" variant="ghost" onClick={() => atualizar.mutate({ id: i.id, status: 'arquivada' })}>Arquivar</Button>}
                    <Button size="sm" variant="danger" onClick={() => confirm('Excluir esta ideia?') && excluir.mutate({ id: i.id })}>Excluir</Button>
                  </div>
                </div>))}
            </div>
            {!arr.length && <p className="text-sm text-dark-400">Nada aqui.</p>}
          </section>
        )
      })}
    </div>
  )
}
