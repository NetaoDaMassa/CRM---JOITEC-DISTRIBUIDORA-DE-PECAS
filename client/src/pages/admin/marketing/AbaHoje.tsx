// Hoje (design novo, João 2026-11-23): a tela que abre primeiro — o que está
// esperando a pessoa, a semana da marca e as metas. Tudo clicável leva para a
// tela onde se resolve.
import { useMemo } from 'react'
import { trpc } from '../../../lib/trpc'
import { atrasada, corPilar, diaLabel, hojeBR, nomeCurtoMarca } from './comum'
import type { Peca } from './PecaModal'

type Marca = { empresaId: number; nome: string }
const NOME_REDE: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', pinterest: 'Pinterest', google: 'Google Meu Negócio', threads: 'Threads', outro: 'Outra' }
const COR_REDE: Record<string, string> = { instagram: '#e1306c', facebook: '#1877f2', tiktok: '#25f4ee', youtube: '#ff0000', linkedin: '#0a66c2', pinterest: '#e60023', google: '#34a853', threads: '#a3a3a3', outro: '#94a3b8' }
const COR_ETAPA: Record<string, string> = { Ideia: '#64748b', Roteiro: '#94a3b8', 'Aprovação do roteiro': '#e0b450', Produção: '#4f8cff', 'Aprovação final': '#a855f7', 'Agendado na mLabs': '#22c55e' }

function somar(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function segunda(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dw = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return somar(iso, dw === 0 ? -6 : 1 - dw)
}

export default function AbaHoje({ mes, marcas, pecas, empresaId, irPara, abrirPeca, pilaresDe }: {
  mes: string; marcas: Marca[]; pecas: Peca[]; empresaId: number
  irPara: (aba: any) => void; abrirPeca: (p: Peca) => void; pilaresDe: (planoId: string) => { id: string; nome: string; cor?: string }[]
}) {
  const rev = trpc.marketingFluxo.revisores.useQuery()
  const demandas = trpc.marketingFluxo.demandas.useQuery()
  const metas = trpc.marketingModulo.metas.useQuery()
  const hoje = hojeBR()
  const rel = trpc.marketingModulo.relatorio.useQuery({ de: somar(hoje, -29), ate: hoje })
  const eu = rev.data?.eu || { video: false, post: false }
  const meu = (p: Peca) => (p.tipo === 'Post' ? eu.post : eu.video)

  // Semana mostrada: a de hoje se o mês escolhido é o atual; senão a 1ª semana do mês.
  const seg = mes === hoje.slice(0, 7) ? segunda(hoje) : segunda(`${mes}-01`) < `${mes}-01` ? somar(segunda(`${mes}-01`), 7) : segunda(`${mes}-01`)
  const dom = somar(seg, 6)
  const daSemana = pecas.filter((p) => p.data && p.data >= seg && p.data <= dom)

  const tarefas = useMemo(() => {
    const t: { n: number; titulo: string; detalhe: string; acao: string; aba: string; cor: string }[] = []
    const rot = pecas.filter((p) => p.status === 'Aprovação do roteiro')
    const rotMeus = rot.filter(meu)
    if (rot.length) t.push({ n: rotMeus.length || rot.length, titulo: rotMeus.length ? 'Roteiros para você aprovar' : 'Roteiros esperando outro revisor', detalhe: rot.slice(0, 3).map((p) => p.titulo).join(' · '), acao: 'Abrir revisão', aba: 'revisao', cor: '#e0b450' })
    const fin = pecas.filter((p) => p.status === 'Aprovação final' && !p.finalAprovadoEm)
    if (fin.length) t.push({ n: fin.length, titulo: 'Vídeos/artes prontos para a aprovação final', detalhe: fin.slice(0, 3).map((p) => p.titulo).join(' · '), acao: 'Aprovar', aba: 'revisao', cor: '#a855f7' })
    const semAnexo = pecas.filter((p) => p.status === 'Produção' && !(p.anexos || []).length)
    if (semAnexo.length) t.push({ n: semAnexo.length, titulo: 'Peças em produção sem o arquivo anexado', detalhe: 'Sem o anexo elas não vão para a aprovação final nem para a mLabs', acao: 'Ver no quadro', aba: 'quadro', cor: '#f5a25d' })
    const atr = pecas.filter(atrasada)
    if (atr.length) t.push({ n: atr.length, titulo: 'Peças atrasadas', detalhe: 'A data de postar já passou e ainda não foram agendadas', acao: 'Ver no quadro', aba: 'quadro', cor: '#f87171' })
    const novos = (demandas.data || []).filter((d) => d.status === 'Novo')
    if (novos.length) t.push({ n: novos.length, titulo: 'Pedidos novos de outros setores', detalhe: novos.slice(0, 2).map((d) => `${d.titulo} (${d.solicitante})`).join(' · '), acao: 'Ver pedidos', aba: 'pedidos', cor: '#7aa7ff' })
    const semRot = daSemana.filter((p) => ['Ideia'].includes(p.status) && p.origem !== 'complementar')
    if (semRot.length) t.push({ n: semRot.length, titulo: 'Peças desta semana ainda sem roteiro', detalhe: semRot.slice(0, 3).map((p) => p.titulo || 'sem título').join(' · '), acao: 'Abrir calendário', aba: 'calendario', cor: '#94a3b8' })
    return t
  }, [pecas, demandas.data, rev.data, daSemana])

  const dias = [0, 1, 2, 3, 4].map((i) => {
    const d = somar(seg, i)
    return { d, pecas: daSemana.filter((p) => p.empresaId === empresaId && p.data === d) }
  })
  const pil = (p: Peca) => pilaresDe(p.planoId).find((x) => x.id === p.pilar)
  const metaV = metas.data?.videos ?? 3
  const metaP = metas.data?.posts ?? 2
  const porMarca = marcas.map((m) => {
    const l = daSemana.filter((p) => p.empresaId === m.empresaId && p.origem !== 'complementar')
    const ag = l.filter((p) => p.status === 'Agendado na mLabs')
    return { ...m, v: ag.filter((p) => p.tipo !== 'Post').length, p: ag.filter((p) => p.tipo === 'Post').length, planV: l.filter((p) => p.tipo !== 'Post').length, planP: l.filter((p) => p.tipo === 'Post').length }
  })
  const redes = useMemo(() => {
    const c: Record<string, number> = {}
    ;(rel.data?.redesLigadas || []).forEach((r) => { c[r.rede] ??= 0 })
    ;(rel.data?.itens || []).forEach((i) => { c[i.rede] = (c[i.rede] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [rel.data])
  const maxR = Math.max(1, ...redes.map((r) => r[1]))
  const nomeM = nomeCurtoMarca(marcas.find((m) => m.empresaId === empresaId)?.nome || '')

  const card = 'bg-dark-800 border border-dark-700 rounded-2xl p-5 space-y-4'
  return (
    <div className="flex flex-wrap gap-5 items-start">
      <div className="flex-[999_1_640px] min-w-0 space-y-5">
        <section className={card}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold text-dark-100">Esperando você</h2>
            <span className="text-sm text-dark-400">{tarefas.length ? `${tarefas.length} assunto(s)` : 'nada pendente'}</span>
          </div>
          {!tarefas.length && <p className="text-sm text-dark-400">Tudo em dia. 🎉</p>}
          {tarefas.map((t) => (
            <div key={t.titulo} className="flex items-center gap-4 bg-dark-900/60 border border-dark-700 rounded-xl px-4 py-3">
              <span className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center font-extrabold text-lg" style={{ background: `${t.cor}26`, color: t.cor }}>{t.n}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-dark-100">{t.titulo}</div>
                <div className="text-xs text-dark-400 truncate">{t.detalhe}</div>
              </div>
              <button onClick={() => irPara(t.aba)} className="text-sm font-bold text-gold-400 hover:text-gold-300 border border-dark-600 rounded-lg px-3 py-2 whitespace-nowrap">{t.acao} →</button>
            </div>
          ))}
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-dark-100">Semana {diaLabel(seg).slice(4)} a {diaLabel(somar(seg, 4)).slice(4)} · {nomeM}</h2>
            <button onClick={() => irPara('calendario')} className="text-sm font-bold text-gold-400 hover:text-gold-300">Calendário do mês →</button>
          </div>
          <div className="grid gap-2.5 overflow-x-auto" style={{ gridTemplateColumns: 'repeat(5, minmax(130px, 1fr))' }}>
            {dias.map((d) => (
              <div key={d.d} className="space-y-2">
                <div className={`text-xs font-semibold uppercase ${d.d === hoje ? 'text-gold-300' : 'text-dark-400'}`}>{diaLabel(d.d)}{d.d === hoje ? ' · hoje' : ''}</div>
                {d.pecas.map((p) => {
                  const pi = pil(p)
                  return (
                    <button key={p.id} onClick={() => abrirPeca(p)} className="w-full text-left bg-dark-900/60 border border-dark-700 hover:border-dark-500 rounded-lg p-2.5 space-y-1.5" style={{ borderTop: `4px solid ${corPilar(pi?.cor)}` }}>
                      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: corPilar(pi?.cor) }}>{p.tipo} · {pi?.nome || 'sem pilar'}</div>
                      <div className="text-[13px] font-semibold text-dark-100 leading-snug line-clamp-3">{p.titulo || 'Sem título'}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-dark-300"><span className="w-2 h-2 rounded-full" style={{ background: COR_ETAPA[p.status] || '#64748b' }} />{p.status}</div>
                    </button>
                  )
                })}
                {!d.pecas.length && <div className="text-xs text-dark-500 border border-dashed border-dark-700 rounded-lg p-3 text-center">nada</div>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex-[1_1_320px] min-w-0 space-y-5">
        <section className={card}>
          <div>
            <h2 className="text-lg font-bold text-dark-100">Meta da semana</h2>
            <p className="text-xs text-dark-400">{metaV} vídeos + {metaP} posts por marca · conta o que já está agendado na mLabs (planejado entre parênteses)</p>
          </div>
          {porMarca.map((m) => {
            const ok = m.v >= metaV && m.p >= metaP
            return (
              <div key={m.empresaId} className="space-y-1.5">
                <div className="flex justify-between text-sm"><span className="font-semibold text-dark-100">{nomeCurtoMarca(m.nome)}</span><span className={`font-bold ${ok ? 'text-green-400' : m.v + m.p ? 'text-yellow-300' : 'text-red-400'}`}>{ok ? 'Meta batida' : m.v + m.p ? `Faltam ${Math.max(0, metaV - m.v) + Math.max(0, metaP - m.p)}` : 'Nada agendado'}</span></div>
                <div className="grid grid-cols-[52px_1fr_64px] items-center gap-2 text-xs text-dark-400">
                  <span>Vídeos</span><div className="h-2 bg-dark-700 rounded-full overflow-hidden"><div className="h-full bg-gold-500 rounded-full" style={{ width: `${Math.min(100, (m.v / Math.max(1, metaV)) * 100)}%` }} /></div><span className="text-right text-dark-200">{m.v}/{metaV} ({m.planV})</span>
                  <span>Posts</span><div className="h-2 bg-dark-700 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (m.p / Math.max(1, metaP)) * 100)}%` }} /></div><span className="text-right text-dark-200">{m.p}/{metaP} ({m.planP})</span>
                </div>
              </div>
            )
          })}
          <button onClick={() => irPara('metas')} className="text-sm font-bold text-gold-400 hover:text-gold-300">Conferir no Instagram de verdade →</button>
        </section>

        <section className={card}>
          <h2 className="text-lg font-bold text-dark-100">Redes · últimos 30 dias</h2>
          {redes.map(([r, n]) => (
            <div key={r} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-sm">
              <span className="font-semibold text-dark-100 truncate">{NOME_REDE[r] || r}</span>
              <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden"><div className="h-full" style={{ width: `${(n / maxR) * 100}%`, background: COR_REDE[r] || COR_REDE.outro }} /></div>
              <span className={`text-right font-bold ${n ? 'text-dark-100' : 'text-red-400'}`}>{n}</span>
            </div>
          ))}
          {!redes.length && <p className="text-sm text-dark-400">Ainda sem dados das redes.</p>}
          {redes.some(([, n]) => !n) && <div className="text-xs text-orange-300 bg-orange-900/20 rounded-lg px-3 py-2">{redes.filter(([, n]) => !n).map(([r]) => NOME_REDE[r] || r).join(', ')}: nada em 30 dias.</div>}
          <button onClick={() => irPara('relatorios')} className="text-sm font-bold text-gold-400 hover:text-gold-300">Ver relatório completo →</button>
        </section>
      </div>
    </div>
  )
}
