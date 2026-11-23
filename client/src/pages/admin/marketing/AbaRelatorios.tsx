// Relatórios do marketing (João, 2026-11-23): em quais redes menos postamos e
// quantos vídeos/posts saem por mês, semana e dia. Instagram vem da Meta; as
// outras redes vêm da mLabs (robô diário).
import { useMemo, useState } from 'react'
import { trpc } from '../../../lib/trpc'
import { cls, diaLabel, fimMes, hojeBR, mesLongo, nomeCurtoMarca } from './comum'

type Marca = { empresaId: number; nome: string }
const NOME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', pinterest: 'Pinterest', google: 'Google Meu Negócio', threads: 'Threads', outro: 'Outra' }
const COR: Record<string, string> = { instagram: '#e1306c', facebook: '#1877f2', tiktok: '#25f4ee', youtube: '#ff0000', linkedin: '#0a66c2', pinterest: '#e60023', google: '#34a853', threads: '#a3a3a3', outro: '#94a3b8' }

function somar(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function segunda(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dw = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return somar(iso, dw === 0 ? -6 : 1 - dw)
}
const um = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

export default function AbaRelatorios({ mes, marcas }: { mes: string; marcas: Marca[] }) {
  const [periodo, setPeriodo] = useState<'mes' | '30' | '90'>('mes')
  const [fMarca, setFMarca] = useState(0)
  const [fRede, setFRede] = useState('todas')
  const hoje = hojeBR()
  const [de, ate] = periodo === 'mes' ? [`${mes}-01`, fimMes(mes) < hoje ? fimMes(mes) : hoje] : [somar(hoje, -Number(periodo) + 1), hoje]
  const q = trpc.marketingModulo.relatorio.useQuery({ de, ate })
  const metas = trpc.marketingModulo.metas.useQuery()

  const r = useMemo(() => {
    const todos = q.data?.itens || []
    const itens = todos.filter((i) => (!fMarca || i.empresaId === fMarca) && (fRede === 'todas' || i.rede === fRede))
    const dias = Math.max(1, Math.round((Date.parse(ate) - Date.parse(de)) / 864e5) + 1)
    const semanas = dias / 7
    const v = itens.filter((i) => i.video).length
    const p = itens.length - v
    // Redes: as que têm publicação + as que a marca tem ligadas na mLabs (para mostrar zero).
    const ligadas = (q.data?.redesLigadas || []).filter((x) => !fMarca || x.empresaId === fMarca).map((x) => x.rede)
    const redes = [...new Set([...todos.filter((i) => !fMarca || i.empresaId === fMarca).map((i) => i.rede), ...ligadas])].filter((x) => fRede === 'todas' || x === fRede)
    const porRede = redes.map((rede) => {
      const l = itens.filter((i) => i.rede === rede)
      const vv = l.filter((i) => i.video).length
      return { rede, v: vv, p: l.length - vv, t: l.length, sem: l.length / semanas }
    }).sort((a, b) => a.t - b.t)
    const porMarca = marcas.map((m) => {
      const l = itens.filter((i) => i.empresaId === m.empresaId)
      const vv = l.filter((i) => i.video).length
      const redesM: Record<string, number> = {}
      l.forEach((i) => { redesM[i.rede] = (redesM[i.rede] || 0) + 1 })
      return { ...m, v: vv, p: l.length - vv, t: l.length, redes: redesM }
    })
    const ws: { ini: string; fim: string; v: number; p: number }[] = []
    for (let s = segunda(de); s <= ate; s = somar(s, 7)) {
      const ini = s < de ? de : s
      const fim = somar(s, 6) > ate ? ate : somar(s, 6)
      const l = itens.filter((i) => i.data >= ini && i.data <= fim)
      const vv = l.filter((i) => i.video).length
      ws.push({ ini, fim, v: vv, p: l.length - vv })
    }
    const porDia: { d: string; v: number; p: number }[] = []
    for (let d = de; d <= ate; d = somar(d, 1)) {
      const l = itens.filter((i) => i.data === d)
      const vv = l.filter((i) => i.video).length
      porDia.push({ d, v: vv, p: l.length - vv })
    }
    return { v, p, dias, semanas, porRede, porMarca, ws, porDia, redesTodas: [...new Set(todos.map((i) => i.rede))] }
  }, [q.data, fMarca, fRede, de, ate, marcas])

  const nMarcas = fMarca ? 1 : marcas.length
  const metaV = (metas.data?.videos ?? 3) * nMarcas
  const metaP = (metas.data?.posts ?? 2) * nMarcas
  const maxDia = Math.max(1, ...r.porDia.map((d) => d.v + d.p))
  const maxRede = Math.max(1, ...r.porRede.map((x) => x.t))
  const Kpi = ({ rot, v, txt }: { rot: string; v: string; txt: string }) => (
    <div className="bg-dark-800 border border-dark-700 rounded-xl p-4"><div className={cls.rotulo}>{rot}</div><div className="text-3xl font-bold text-dark-100">{v}</div><div className="text-xs text-dark-400">{txt}</div></div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-dark-100">Relatórios · o que saiu nas redes</h2>
          <p className="text-sm text-dark-400">{diaLabel(de)} a {diaLabel(ate)} · {r.dias} dias. Somando as redes: o mesmo vídeo no Instagram e no TikTok conta 2. Escolha uma rede para ver só ela.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={cls.input + ' w-auto'} value={periodo} onChange={(e) => setPeriodo(e.target.value as any)}><option value="mes">{mesLongo(mes)}</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
          <select className={cls.input + ' w-auto'} value={fRede} onChange={(e) => setFRede(e.target.value)}><option value="todas">Todas as redes</option>{r.redesTodas.map((x) => <option key={x} value={x}>{NOME[x] || x}</option>)}</select>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[{ empresaId: 0, nome: 'Todas as marcas' }, ...marcas].map((m) => (
          <button key={m.empresaId} onClick={() => setFMarca(m.empresaId)} className={`px-3 py-1 rounded-full text-xs border ${fMarca === m.empresaId ? 'bg-dark-100 text-dark-900 border-dark-100 font-semibold' : 'border-dark-600 text-dark-300'}`}>{nomeCurtoMarca(m.nome)}</button>
        ))}
      </div>
      {q.isLoading ? <p className="text-sm text-dark-400">Carregando…</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi rot="Vídeos no período" v={String(r.v)} txt={`${um(r.v / r.semanas)} por semana · ${um(r.v / r.dias)} por dia`} />
            <Kpi rot="Posts no período" v={String(r.p)} txt={`${um(r.p / r.semanas)} por semana · ${um(r.p / r.dias)} por dia`} />
            <Kpi rot="Vídeos por mês (ritmo)" v={um((r.v / r.dias) * 30)} txt={`meta: ${metaV} por semana (${fMarca ? 'esta marca' : `${nMarcas} marcas`})`} />
            <Kpi rot="Posts por mês (ritmo)" v={um((r.p / r.dias) * 30)} txt={`meta: ${metaP} por semana`} />
          </div>

          <section className={cls.card + ' p-4 space-y-2'}>
            <h3 className="text-lg font-bold text-dark-100">Onde menos postamos</h3>
            <p className="text-xs text-dark-400">Da rede com menos publicações para a com mais. Rede ligada na mLabs sem nada no período fica em vermelho.</p>
            {r.porRede.map((x) => (
              <div key={x.rede} className="grid grid-cols-[130px_1fr_150px] items-center gap-3 text-sm">
                <span className={`font-semibold ${x.t === 0 ? 'text-red-400' : 'text-dark-100'}`}>{NOME[x.rede] || x.rede}</span>
                <div className="h-5 bg-dark-900 rounded overflow-hidden flex">
                  <div style={{ width: `${(x.v / maxRede) * 100}%`, background: COR[x.rede] || COR.outro }} title={`${x.v} vídeos`} />
                  <div style={{ width: `${(x.p / maxRede) * 100}%`, background: COR[x.rede] || COR.outro, opacity: 0.45 }} title={`${x.p} posts`} />
                </div>
                <span className={`text-xs ${x.t === 0 ? 'text-red-400 font-semibold' : 'text-dark-300'}`}>{x.t === 0 ? 'nada no período' : `${x.v} vídeos · ${x.p} posts · ${um(x.sem)}/sem`}</span>
              </div>
            ))}
            {!r.porRede.length && <p className="text-sm text-dark-400">Sem dados no período.</p>}
            <p className="text-[11px] text-dark-500">Barra cheia = vídeos · barra clara = posts.</p>
          </section>

          <section className={cls.card + ' p-4 space-y-2'}>
            <h3 className="text-lg font-bold text-dark-100">Por semana</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-dark-400 text-xs"><th className="py-1">Semana</th><th>Vídeos</th><th>Posts</th><th>Meta (V + P)</th></tr></thead>
                <tbody>{r.ws.map((w) => (
                  <tr key={w.ini} className="border-t border-dark-700/60">
                    <td className="py-1.5 text-dark-200">{diaLabel(w.ini)} – {diaLabel(w.fim)}</td>
                    <td className={w.v >= metaV ? 'text-green-400 font-semibold' : 'text-dark-200'}>{w.v}</td>
                    <td className={w.p >= metaP ? 'text-green-400 font-semibold' : 'text-dark-200'}>{w.p}</td>
                    <td className="text-dark-400">{metaV} + {metaP}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            {fRede === 'todas' && <p className="text-[11px] text-dark-500">Somando as redes, a semana passa da meta mais fácil. Para conferir a meta de verdade, escolha "Instagram" no filtro de rede, ou veja a aba Metas.</p>}
          </section>

          <section className={cls.card + ' p-4 space-y-2'}>
            <h3 className="text-lg font-bold text-dark-100">Por dia</h3>
            <div className="flex items-end gap-[3px] h-32 overflow-x-auto">
              {r.porDia.map((d) => (
                <div key={d.d} className="flex flex-col justify-end min-w-[10px] flex-1 h-full" title={`${diaLabel(d.d)}: ${d.v} vídeos, ${d.p} posts`}>
                  <div className="bg-gold-500/50" style={{ height: `${(d.p / maxDia) * 100}%` }} />
                  <div className="bg-gold-500" style={{ height: `${(d.v / maxDia) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-dark-500"><span>{diaLabel(de)}</span><span>dourado = vídeos · claro = posts · passe o mouse para ver o dia</span><span>{diaLabel(ate)}</span></div>
            <p className="text-xs text-dark-400">Dias sem nada publicado: <b className="text-dark-200">{r.porDia.filter((d) => d.v + d.p === 0).length}</b> de {r.dias}.</p>
          </section>

          {!fMarca && (
            <section className={cls.card + ' p-4 space-y-2'}>
              <h3 className="text-lg font-bold text-dark-100">Por marca</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-dark-400 text-xs"><th className="py-1">Marca</th><th>Vídeos</th><th>Posts</th><th>Por semana</th><th>Por rede</th></tr></thead>
                  <tbody>{[...r.porMarca].sort((a, b) => a.t - b.t).map((m) => (
                    <tr key={m.empresaId} className="border-t border-dark-700/60">
                      <td className="py-1.5 font-semibold text-dark-100">{nomeCurtoMarca(m.nome)}</td>
                      <td className="text-dark-200">{m.v}</td>
                      <td className="text-dark-200">{m.p}</td>
                      <td className="text-dark-300">{um(m.t / r.semanas)}</td>
                      <td className="text-xs text-dark-400">{Object.entries(m.redes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${NOME[k] || k} ${n}`).join(' · ') || <span className="text-red-400">nada</span>}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <p className="text-[11px] text-dark-500">A Odin Automação não está na mLabs: só aparece o Instagram dela quando a Meta estiver ligada.</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
