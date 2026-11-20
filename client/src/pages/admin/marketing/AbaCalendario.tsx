// Calendário: peças do plano (marca + mês) por semana.
import { useState } from 'react'
import { trpc } from '../../../lib/trpc'
import { STATUS, corPilar, diaLabel, faixaSemana, mesLongo, semanasDoMes, CANAIS_V, cls } from './comum'
import type { Peca } from './PecaModal'

type Plano = { id: string; empresaId: number; mes: string; dados: any }

export default function AbaCalendario({ plano, pecas, abrirPeca, salvarDados }: { plano: Plano; pecas: Peca[]; abrirPeca: (p: Peca) => void; salvarDados: (d: any) => void }) {
  const utils = trpc.useUtils()
  const criar = trpc.marketingModulo.criarPeca.useMutation({ onSuccess: (p) => { utils.marketingModulo.pecas.invalidate(); abrirPeca(p as Peca) } })
  const [fPilar, setFPilar] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const pilares: any[] = plano.dados.pilares || []
  const semanas = semanasDoMes(plano.mes)
  const temas: { tema: string }[] = plano.dados.semanas || []
  const lista = pecas.filter((p) => (fPilar === 'all' || p.pilar === fPilar || (fPilar === 'post' && p.tipo === 'Post')) && (fStatus === 'all' || p.status === fStatus))
    .sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''))
  const comRot = pecas.filter((p) => (p.roteiro || '').trim().length > 20).length
  const pil = (id: string | null) => pilares.find((x) => x.id === id)

  const novaPeca = (ini: number, fim: number) => {
    const [y, m] = plano.mes.split('-').map(Number)
    let d = ini
    while (d < fim && [0, 6].includes(new Date(y, m - 1, d).getDay())) d++
    criar.mutate({ planoId: plano.id, data: `${plano.mes}-${String(d).padStart(2, '0')}`, hora: '11:00', tipo: 'Vídeo', pilar: pilares[0]?.id || null, canais: [...CANAIS_V], status: 'Ideia' })
  }
  const Card = ({ p }: { p: Peca }) => {
    const pi = pil(p.pilar)
    return (
      <button onClick={() => abrirPeca(p)} className="text-left bg-dark-800 border border-dark-700 hover:border-dark-500 rounded-lg p-3 space-y-1.5" style={{ borderTop: `4px solid ${corPilar(pi?.cor)}` }}>
        <div className="flex justify-between gap-2 text-[11px] font-mono text-dark-400"><span style={{ color: corPilar(pi?.cor) }} className="uppercase">{p.tipo} · {pi?.nome || 'sem pilar'}</span><span>{diaLabel(p.data)} {p.hora || ''}</span></div>
        <div className="text-sm font-semibold text-dark-100 leading-snug">{p.titulo || 'Sem título'}</div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-dark-700 text-dark-200">{p.status}</span>
          {(p.roteiro || '').trim().length > 20 && <span className="text-[11px] text-green-400">✓ roteiro</span>}
          {p.analise && <span className={`text-[11px] font-semibold ${p.analise.veredito === 'aprovar' ? 'text-green-400' : p.analise.veredito === 'ajustar' ? 'text-yellow-400' : 'text-red-400'}`}>{p.analise.nota}/10</span>}
        </div>
      </button>
    )
  }
  const semData = lista.filter((p) => !p.data || p.data.slice(0, 7) !== plano.mes)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 'all', nome: 'Todos' }, ...pilares.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor })), { id: 'post', nome: 'Só posts' }].map((c: any) => (
            <button key={c.id} onClick={() => setFPilar(c.id)} className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1.5 ${fPilar === c.id ? 'bg-dark-100 text-dark-900 border-dark-100' : 'border-dark-600 text-dark-300'}`}>{c.cor && <i className="w-2 h-2 rounded-full" style={{ background: corPilar(c.cor) }} />}{c.nome}</button>))}
        </div>
        <div className="flex items-center gap-3 text-xs text-dark-400">
          <span>{pecas.length} peças · {comRot} com roteiro</span>
          <select className={cls.input + ' w-auto'} value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="all">Todos os status</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
      </div>
      {semanas.map((w) => {
        const [a, b] = faixaSemana(plano.mes, w)
        const itens = lista.filter((p) => p.data && p.data >= a && p.data <= b)
        return (
          <section key={w.n} className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-bold text-dark-100 whitespace-nowrap">Semana {w.n}</h3>
              <span className="text-xs font-mono text-dark-400">{w.ini}–{w.fim} {mesLongo(plano.mes).split(' ')[0]}</span>
              <input className="flex-1 min-w-[220px] bg-transparent border-b border-dashed border-dark-600 focus:border-gold-500 outline-none text-sm font-semibold text-dark-200 px-1 py-0.5" placeholder="Tema da semana" defaultValue={temas[w.n - 1]?.tema || ''} key={`${plano.id}-${w.n}-${temas[w.n - 1]?.tema || ''}`}
                onBlur={(e) => { const s = semanas.map((_, i) => ({ tema: temas[i]?.tema || '' })); s[w.n - 1] = { tema: e.target.value }; salvarDados({ ...plano.dados, semanas: s }) }} />
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
              {itens.map((p) => <Card key={p.id} p={p} />)}
              <button onClick={() => novaPeca(w.ini, w.fim)} className="border border-dashed border-dark-600 rounded-lg text-dark-400 hover:text-dark-100 text-sm font-semibold min-h-[90px]">+ Nova peça</button>
            </div>
          </section>
        )
      })}
      {semData.length > 0 && <section className="space-y-2"><h3 className="text-lg font-bold text-dark-100">Sem data ou fora do mês</h3><div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>{semData.map((p) => <Card key={p.id} p={p} />)}</div></section>}
    </div>
  )
}
