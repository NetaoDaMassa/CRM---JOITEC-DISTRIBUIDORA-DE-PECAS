// Aba Empresa → "Todas as redes": números de cada rede vindos da mLabs (robô diário).
import { trpc } from '../../../lib/trpc'
import { cls, dataHora, diaLabel, fmtN } from './comum'

const NOME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', pinterest: 'Pinterest', google: 'Google Meu Negócio', threads: 'Threads', outro: 'Outra' }
const COR: Record<string, string> = { instagram: '#e1306c', facebook: '#1877f2', tiktok: '#25f4ee', youtube: '#ff0000', linkedin: '#0a66c2', pinterest: '#e60023', google: '#34a853', threads: '#a3a3a3', outro: '#94a3b8' }
const ORDEM = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'google', 'threads', 'outro']

type Post = { id: string; rede: string; data: string; tipo: string | null; texto: string; link: string | null; views: number | null; alcance: number | null; curtidas: number | null; comentarios: number | null; compartilhamentos: number | null; salvos: number | null }
const interacoes = (p: Post) => (p.curtidas || 0) + (p.comentarios || 0) + (p.compartilhamentos || 0) + (p.salvos || 0)
const alcanceDe = (p: Post) => p.views || p.alcance || 0

export default function RedesMlabs({ empresaId }: { empresaId: number }) {
  const q = trpc.marketingModulo.redesEmpresa.useQuery({ empresaId, dias: 30 })
  const d = q.data
  if (q.isLoading) return null
  const posts = (d?.posts || []) as Post[]
  const redes = [...new Set([...(d?.redes || []).map((r) => r.rede), ...posts.map((p) => p.rede)])].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b))

  return (
    <section className={cls.card + ' p-4 space-y-4'}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-dark-100">Todas as redes · últimos 30 dias</h3>
          <p className="text-sm text-dark-400">Vem da mLabs 1 vez por dia. O Instagram acima continua vindo direto da Meta, de hora em hora.</p>
        </div>
        {d?.ultimo && <span className="text-xs text-dark-500">Atualizado em {dataHora(d.ultimo.em)}</span>}
      </div>

      {!redes.length ? (
        <p className="text-sm text-dark-400">Ainda não chegaram dados da mLabs para esta marca{empresaId === 3 ? ' (a Odin Automação não está cadastrada na mLabs)' : ''}.</p>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>
            {redes.map((rede) => {
              const r = d!.redes.find((x) => x.rede === rede)
              const ps = posts.filter((p) => p.rede === rede)
              const comVisu = ps.filter((p) => alcanceDe(p) > 0)
              const media = comVisu.length ? Math.round(comVisu.reduce((s, p) => s + alcanceDe(p), 0) / comVisu.length) : 0
              const melhor = [...ps].sort((a, b) => alcanceDe(b) - alcanceDe(a))[0]
              const parado = ps.length === 0
              return (
                <div key={rede} className={`bg-dark-900/60 rounded-xl p-3 space-y-1.5 border ${parado ? 'border-orange-700/60' : 'border-dark-700'}`} style={{ borderTop: `4px solid ${COR[rede] || COR.outro}` }}>
                  <div className="font-bold text-dark-100">{NOME[rede] || rede}</div>
                  <div className="text-2xl font-bold text-dark-100">{r?.seguidores != null ? fmtN(r.seguidores) : '—'}<span className="text-xs font-normal text-dark-400"> seguidores</span></div>
                  {r?.ganhoPeriodo != null && <div className={`text-xs ${r.ganhoPeriodo >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.ganhoPeriodo >= 0 ? '+' : ''}{fmtN(r.ganhoPeriodo)} no período</div>}
                  <div className="text-xs text-dark-300">{ps.length} publicações{media ? ` · média de ${fmtN(media)} visualizações` : ''}</div>
                  {r?.engajamentoPct != null && <div className="text-xs text-dark-400">Engajamento {String(r.engajamentoPct).replace('.', ',')}%</div>}
                  {parado && <div className="text-xs text-orange-400">Nada publicado em 30 dias</div>}
                  {melhor && alcanceDe(melhor) > 0 && (
                    <a href={melhor.link || '#'} target="_blank" rel="noopener noreferrer" className="block text-xs text-gold-400 hover:underline truncate" title={melhor.texto}>🏆 {fmtN(alcanceDe(melhor))} · {melhor.texto.slice(0, 50) || 'abrir'}</a>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <div className={cls.rotulo + ' mb-1'}>Top 8 publicações de todas as redes</div>
            {[...posts].sort((a, b) => alcanceDe(b) - alcanceDe(a)).slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-dark-700/50 text-sm">
                <span className="text-[11px] px-2 py-0.5 rounded whitespace-nowrap text-dark-900 font-semibold" style={{ background: COR[p.rede] || COR.outro }}>{NOME[p.rede] || p.rede}</span>
                <span className="text-xs text-dark-400 whitespace-nowrap">{diaLabel(p.data)}</span>
                <a href={p.link || '#'} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline truncate flex-1">{p.texto.slice(0, 90) || 'Abrir'}</a>
                <span className="text-xs text-dark-400 whitespace-nowrap">{fmtN(alcanceDe(p))} visu · {fmtN(interacoes(p))} interações</span>
              </div>
            ))}
          </div>

          {!!d?.melhoresHorarios?.length && (
            <div>
              <div className={cls.rotulo + ' mb-1'}>Melhores horários para postar (mLabs)</div>
              <div className="grid md:grid-cols-2 gap-3">
                {[...new Set(d.melhoresHorarios.map((h) => h.rede))].map((rede) => (
                  <div key={rede} className="bg-dark-900/60 rounded-lg p-3 text-xs space-y-0.5">
                    <div className="font-semibold text-dark-100 mb-1">{NOME[rede] || rede}</div>
                    {d.melhoresHorarios.filter((h) => h.rede === rede).map((h) => (
                      <div key={h.dia} className="flex gap-2"><span className="w-20 text-dark-400 capitalize">{h.dia}</span><span className="text-dark-200">{h.horarios.join(' · ') || '—'}</span></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
