// Metas: o que saiu no Instagram × meta semanal (vídeos e posts), por marca e semana.
import { useState } from 'react'
import { trpc } from '../../../lib/trpc'
import IaAcao from './IaAcao'
import { cls, diaLabel, estadoSemana, faixaSemana, metaSemana, mesLongo, semanasDoMes, fmtN } from './comum'
import type { Peca } from './PecaModal'

type Marca = { empresaId: number; nome: string; instagram: { username: string | null; ultimoSync: string | null; ultimoErro: string | null } | null }
const COR = { ok: 'border-green-500 bg-green-500/10', partial: 'border-yellow-500 bg-yellow-500/10', bad: 'border-red-500 bg-red-500/10', fut: 'border-dark-600 bg-dark-900/40' }

export default function AbaMetas({ mes, marcas, pecas, temPlano, abrirPeca }: { mes: string; marcas: Marca[]; pecas: Peca[]; temPlano: (empresaId: number) => boolean; abrirPeca: (p: Peca) => void }) {
  const utils = trpc.useUtils()
  const metas = trpc.marketingModulo.metas.useQuery()
  const ig = trpc.marketingModulo.igMes.useQuery({ mes })
  const salvarMetas = trpc.marketingModulo.salvarMetas.useMutation({ onSuccess: () => utils.marketingModulo.metas.invalidate() })
  const [sel, setSel] = useState<{ empresaId: number; w: number } | null>(null)
  const meta = metas.data || { videos: 3, posts: 2 }
  const semanas = semanasDoMes(mes)
  const analises = trpc.marketingModulo.analises.useQuery({ empresaId: sel?.empresaId || 4 }, { enabled: !!sel })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-dark-100">Metas de {mesLongo(mes)}</h2>
          <p className="text-sm text-dark-400">Conta o que saiu de verdade no Instagram de cada marca (Meta). A linha de baixo mostra o que está planejado no Calendário.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-dark-300">
          Meta por semana:
          <input type="number" min={0} className={cls.input + ' w-16'} defaultValue={meta.videos} key={`v${meta.videos}`} onBlur={(e) => salvarMetas.mutate({ videos: Number(e.target.value) || 0, posts: meta.posts })} /> vídeos
          <input type="number" min={0} className={cls.input + ' w-16'} defaultValue={meta.posts} key={`p${meta.posts}`} onBlur={(e) => salvarMetas.mutate({ videos: meta.videos, posts: Number(e.target.value) || 0 })} /> posts
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-dark-400">
        <span><i className="inline-block w-3 h-3 rounded-sm bg-green-500 mr-1 align-middle" />meta batida</span>
        <span><i className="inline-block w-3 h-3 rounded-sm bg-yellow-500 mr-1 align-middle" />semana em andamento</span>
        <span><i className="inline-block w-3 h-3 rounded-sm bg-red-500 mr-1 align-middle" />meta não batida</span>
        <span><i className="inline-block w-3 h-3 rounded-sm bg-dark-600 mr-1 align-middle" />ainda não começou</span>
      </div>
      <div className={cls.card + ' overflow-x-auto'}>
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-dark-400 border-b border-dark-700">
              <th className="p-3">Marca</th>
              {semanas.map((w) => { const mt = metaSemana(mes, w, meta); return <th key={w.n} className="p-3">Semana {w.n}<br /><span className="normal-case tracking-normal">{w.ini}–{w.fim} · meta {mt.v}V {mt.p}P</span></th> })}
              <th className="p-3">Mês</th>
            </tr>
          </thead>
          <tbody>
            {marcas.map((m) => {
              const pub = (ig.data || []).filter((x) => x.empresaId === m.empresaId)
              const pl = pecas.filter((x) => x.empresaId === m.empresaId)
              let tV = 0, tP = 0, tMV = 0, tMP = 0, tPlV = 0, tPlP = 0
              const celulas = semanas.map((w) => {
                const [a, b] = faixaSemana(mes, w)
                const mt = metaSemana(mes, w, meta)
                const est = estadoSemana(mes, w)
                const p = pub.filter((x) => x.data >= a && x.data <= b)
                const v = p.filter((x) => x.tipo === 'Vídeo').length, po = p.length - v
                const plW = pl.filter((x) => x.data && x.data >= a && x.data <= b)
                const plV = plW.filter((x) => x.tipo !== 'Post').length, plP = plW.length - plV
                tV += v; tP += po; tMV += mt.v; tMP += mt.p; tPlV += plV; tPlP += plP
                const bate = v >= mt.v && po >= mt.p
                const c = !m.instagram || est === 'futura' ? 'fut' : bate ? 'ok' : est === 'atual' ? 'partial' : 'bad'
                const ativo = sel?.empresaId === m.empresaId && sel.w === w.n
                return (
                  <td key={w.n} className="p-2 align-top">
                    <button onClick={() => setSel(ativo ? null : { empresaId: m.empresaId, w: w.n })} className={`w-full text-left rounded-lg border-l-4 px-3 py-2 ${COR[c]} ${ativo ? 'ring-2 ring-gold-500' : ''}`}>
                      <div className="flex justify-between font-mono font-semibold text-dark-100">{m.instagram ? <><span>🎬 {v}/{mt.v}</span><span>🖼 {po}/{mt.p}</span></> : <span className="text-dark-400">sem Instagram</span>}</div>
                      <div className="text-[11px] text-dark-400">planejado {plV}V {plP}P</div>
                    </button>
                  </td>
                )
              })
              const okMes = tV >= tMV && tP >= tMP
              return (
                <tr key={m.empresaId} className="border-b border-dark-700/60">
                  <td className="p-3 align-top">
                    <div className="font-semibold text-dark-100">{m.nome}</div>
                    {m.instagram ? <div className="text-xs text-dark-400">@{m.instagram.username}</div> : <div className="text-xs text-dark-500">Instagram não ligado</div>}
                    {m.instagram?.ultimoErro && <div className="text-xs text-red-400 mt-1">{m.instagram.ultimoErro.slice(0, 120)}</div>}
                    {!temPlano(m.empresaId) && <div className="text-xs text-dark-500">Sem plano neste mês</div>}
                  </td>
                  {celulas}
                  <td className="p-2 align-top"><div className={`rounded-lg border-l-4 px-3 py-2 ${m.instagram ? (okMes ? COR.ok : COR.partial) : COR.fut}`}><div className="flex justify-between font-mono font-semibold text-dark-100"><span>🎬 {tV}/{tMV}</span><span>🖼 {tP}/{tMP}</span></div><div className="text-[11px] text-dark-400">planejado {tPlV}V {tPlP}P</div></div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!sel ? <p className="text-sm text-dark-400">Clique numa semana de uma marca para ver o que foi publicado e o que estava planejado.</p> : (() => {
        const m = marcas.find((x) => x.empresaId === sel.empresaId)!
        const w = semanas.find((x) => x.n === sel.w)!
        const [a, b] = faixaSemana(mes, w)
        const pub = (ig.data || []).filter((x) => x.empresaId === sel.empresaId && x.data >= a && x.data <= b)
        const pl = pecas.filter((x) => x.empresaId === sel.empresaId && x.data && x.data >= a && x.data <= b).sort((x, y) => (x.data || '').localeCompare(y.data || ''))
        const salvo = (analises.data || []).find((x) => x.chave === `mes-${sel.empresaId}-${mes}`)
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-dark-100">{m.nome} · semana {w.n} ({w.ini}–{w.fim})</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className={cls.card + ' p-4'}>
                <div className={cls.rotulo + ' mb-2'}>Publicado no Instagram</div>
                {pub.length ? pub.map((x) => (
                  <div key={x.id} className="flex items-center gap-2 py-1.5 border-b border-dark-700/50 text-sm">
                    <span className="text-xs px-2 py-0.5 rounded bg-dark-700 text-dark-200 whitespace-nowrap">{x.tipo} · {diaLabel(x.data)}</span>
                    <a href={x.permalink || '#'} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline truncate flex-1">{x.legenda.slice(0, 80) || 'Abrir'}</a>
                    <span className="text-xs text-dark-400 whitespace-nowrap">{x.views ? `${fmtN(x.views)} views · ` : ''}{fmtN(x.alcance)} alc</span>
                  </div>)) : <p className="text-sm text-dark-400">Nada publicado nesta semana.</p>}
              </div>
              <div className={cls.card + ' p-4'}>
                <div className={cls.rotulo + ' mb-2'}>Planejado no Calendário</div>
                {pl.length ? pl.map((x) => (
                  <div key={x.id} className="flex items-center gap-2 py-1.5 border-b border-dark-700/50 text-sm">
                    <span className="text-xs px-2 py-0.5 rounded bg-dark-700 text-dark-200 whitespace-nowrap">{x.tipo} · {diaLabel(x.data)}</span>
                    <button onClick={() => abrirPeca(x)} className="text-gold-400 hover:underline truncate flex-1 text-left">{x.titulo || 'Sem título'}</button>
                    <span className="text-xs text-dark-400">{x.status}</span>
                  </div>)) : <p className="text-sm text-dark-400">Nenhuma peça planejada nesta semana.</p>}
              </div>
            </div>
            <div className={cls.card + ' p-4 space-y-3'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-dark-100">Análise do Claude — {m.nome} em {mesLongo(mes)}</span>
                <IaAcao tipo="mes" params={{ empresaId: sel.empresaId, mes }} rotulo="Analisar o mês" onResultado={() => utils.marketingModulo.analises.invalidate()} />
              </div>
              <pre className="whitespace-pre-wrap text-sm text-dark-200 font-sans">{salvo?.texto || 'Nenhuma análise ainda.'}</pre>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
