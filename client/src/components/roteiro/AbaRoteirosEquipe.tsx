// Roteiro do dia — visão do gestor: quem enviou, aprovar/devolver, pedidos
// de visita extra, andamento do dia, planejado x realizado e as regras da
// trava (Configurações). Pedido do João, 2026-10-22.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ThumbsUp, Eye, Settings2, Lock, Unlock, AlertTriangle, CheckCircle2, XCircle, MapPin, Home } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Badge } from '../ui/Badge'
import AbaRoteiro from './AbaRoteiro'
import { STATUS_ROTEIRO, RESULTADOS_VISITA, dataBr, diaSemana } from './util'

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
}
function proximoDiaUtilSimples(d: string): string {
  const x = new Date(`${d}T12:00:00Z`)
  do x.setUTCDate(x.getUTCDate() + 1)
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6)
  return x.toISOString().slice(0, 10)
}

export default function AbaRoteirosEquipe() {
  const hoje = hojeBr()
  const [data, setData] = useState(hoje)
  const [aberto, setAberto] = useState<{ id: number; nome: string } | null>(null)
  const [verConfig, setVerConfig] = useState(false)
  const { data: painel, isLoading } = trpc.roteiros.painelEquipe.useQuery({ data }, { refetchInterval: 60000 })
  const utils = trpc.useUtils()
  const inv = () => { utils.roteiros.painelEquipe.invalidate(); utils.roteiros.obter.invalidate() }
  const aprovar = trpc.roteiros.aprovar.useMutation({ onSuccess: () => { toast.success('Roteiro aprovado'); inv() }, onError: (e) => toast.error(e.message) })
  const decidirExtra = trpc.roteiros.decidirExtra.useMutation({ onSuccess: () => { toast.success('Pedido respondido'); inv() }, onError: (e) => toast.error(e.message) })

  if (aberto) return <AbaRoteiro vendedorId={aberto.id} nomeVendedor={aberto.nome} dataInicial={data} onVoltar={() => setAberto(null)} />

  const proximo = proximoDiaUtilSimples(hoje)
  const vend = painel?.vendedores ?? []
  const cont = {
    aprovado: vend.filter((v) => v.roteiro?.status === 'aprovado').length,
    enviado: vend.filter((v) => v.roteiro?.status === 'enviado').length,
    devolvido: vend.filter((v) => v.roteiro?.status === 'devolvido').length,
    nada: vend.filter((v) => !v.roteiro || v.roteiro.status === 'rascunho').length,
  }
  const extras = vend.flatMap((v) => v.paradas.filter((p) => p.extra && p.extraStatus === 'pendente').map((p) => ({ ...p, vendedor: v.nome })))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {[hoje, proximo].map((d, i) => (
          <button key={d} onClick={() => setData(d)} className={`px-3 py-1.5 rounded-lg border text-xs ${data === d ? 'border-gold-500 bg-gold-500/10 text-gold-300 claro:text-gold-700 font-medium' : 'border-dark-600 text-dark-300 hover:border-dark-400'}`}>
            {i === 0 ? 'Hoje' : diaSemana(d).split('-')[0].replace(/^./, (c) => c.toUpperCase())} <span className="text-dark-500">{dataBr(d).slice(0, 5)}</span>
          </button>
        ))}
        <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} className="rounded-lg border border-dark-600 bg-transparent px-2 py-1 text-xs text-dark-200" />
        <span className={`ml-2 inline-flex items-center gap-1 text-xs ${painel?.travaAtiva ? 'text-green-400 claro:text-green-700' : 'text-dark-400'}`}>
          {painel?.travaAtiva ? <Lock size={13} /> : <Unlock size={13} />} Trava {painel?.travaAtiva ? 'ligada' : 'desligada'} neste dia
        </span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setVerConfig((x) => !x)}><Settings2 size={13} className="mr-1" /> Regras do roteiro</Button>
      </div>

      {verConfig && painel && <ConfigRoteiro config={painel.config} candidatos={painel.candidatos} onSalvo={() => { setVerConfig(false); inv() }} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
        <Cartao valor={cont.aprovado} rotulo="Aprovados" cor="text-green-400 claro:text-green-700" />
        <Cartao valor={cont.enviado} rotulo="Aguardando você" cor="text-amber-400 claro:text-amber-700" />
        <Cartao valor={cont.devolvido} rotulo="Devolvidos" cor="text-red-400 claro:text-red-700" />
        <Cartao valor={cont.nada} rotulo="Não enviados" cor="text-dark-200" />
      </div>
      {painel?.prazo && <p className="text-xs text-dark-500 -mt-2">Prazo para enviar o roteiro de {dataBr(data)}: {new Date(painel.prazo.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.</p>}

      {extras.length > 0 && (
        <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 space-y-2">
          <div className="text-sm font-medium text-violet-200 claro:text-violet-700">Pedidos de visita extra ({extras.length})</div>
          {extras.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-dark-100"><b>{p.vendedor}</b> → {p.nome}</span>
              <span className="text-xs text-dark-400">{p.objetivo} · “{p.extraJustificativa}”</span>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" onClick={() => decidirExtra.mutate({ paradaId: p.id, aprovar: true })}><CheckCircle2 size={13} className="mr-1" /> Liberar</Button>
                <Button size="sm" variant="secondary" onClick={() => decidirExtra.mutate({ paradaId: p.id, aprovar: false })}><XCircle size={13} className="mr-1" /> Recusar</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-dark-400">Carregando...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vend.map((v) => {
            const st = v.roteiro?.status ?? 'rascunho'
            const t = v.totais
            const pct = t.total ? Math.round((t.visitadas / t.total) * 100) : 0
            return (
              <div key={v.vendedorId} className="rounded-xl border border-dark-600 bg-dark-800 p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-dark-100">{v.nome}</div>
                  <Badge className={STATUS_ROTEIRO[st].cor}>{v.roteiro && st !== 'rascunho' ? STATUS_ROTEIRO[st].label : 'Não enviado'}</Badge>
                </div>
                {!v.temCasa && <div className="text-[11px] text-amber-400 claro:text-amber-700 flex items-center gap-1"><Home size={11} /> Sem endereço de casa cadastrado</div>}
                {v.roteiro ? (
                  <>
                    <div className="text-xs text-dark-400 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{t.planejadas} paradas</span>
                      <span>~{(v.roteiro.kmPrevisto ?? 0).toLocaleString('pt-BR')} km</span>
                      <span>saída {v.roteiro.horaSaida}</span>
                      {v.roteiro.enviadoEm && (
                        <span className={v.roteiro.noPrazo ? 'text-dark-400' : 'text-red-400 claro:text-red-700'}>
                          enviado {new Date(v.roteiro.enviadoEm.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}{v.roteiro.noPrazo ? '' : ' (fora do prazo)'}
                        </span>
                      )}
                      {v.roteiro.aprovacaoAutomatica && <span className="text-dark-500">aprovado automático</span>}
                    </div>
                    {st === 'aprovado' && (
                      <div>
                        <div className="flex justify-between text-[11px] text-dark-400 mb-1">
                          <span>{t.visitadas} feitas · {t.puladas} puladas{t.extrasPendentes ? ` · ${t.extrasPendentes} extra pendente` : ''}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-dark-700 overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                        {v.emAndamento && <div className="text-[11px] text-green-400 claro:text-green-700 mt-1 flex items-center gap-1"><MapPin size={11} /> Agora em: {v.emAndamento}</div>}
                      </div>
                    )}
                    <ol className="text-[11px] text-dark-400 space-y-0.5 max-h-28 overflow-y-auto">
                      {v.paradas.map((p, i) => (
                        <li key={p.id} className={p.status === 'pulada' ? 'line-through opacity-60' : ''}>
                          {p.status === 'visitada' ? '✅' : `${i + 1}.`} {p.nome} <span className="text-dark-500">— {p.objetivo}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <div className="text-xs text-dark-500 flex items-center gap-1"><AlertTriangle size={12} /> Ainda não montou o roteiro deste dia</div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setAberto({ id: v.vendedorId, nome: v.nome })}><Eye size={13} className="mr-1" /> {v.roteiro ? 'Ver roteiro' : 'Montar por ele'}</Button>
                  {st === 'enviado' && v.roteiro && <Button size="sm" loading={aprovar.isPending} onClick={() => aprovar.mutate({ roteiroId: v.roteiro!.id })}><ThumbsUp size={13} className="mr-1" /> Aprovar</Button>}
                </div>
              </div>
            )
          })}
          {!vend.length && <p className="text-sm text-dark-500">Ninguém no teste ainda. Abra "Regras do roteiro" e marque o vendedor que vai testar.</p>}
        </div>
      )}

      <Relatorio />
    </div>
  )
}

function Cartao({ valor, rotulo, cor }: { valor: number; rotulo: string; cor: string }) {
  return (
    <div className="rounded-2xl border border-dark-600 bg-dark-800 p-4">
      <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
      <p className="text-xs text-dark-400 mt-0.5">{rotulo}</p>
    </div>
  )
}

type Config = { travaDesde: string | null; horaLimite: string; autoAprovarHora: string | null; minParadas: number; participantes: number[] }

function ConfigRoteiro({ config, candidatos, onSalvo }: { config: Config; candidatos: { id: number; name: string }[]; onSalvo: () => void }) {
  const [f, setF] = useState(config)
  useEffect(() => setF(config), [config])
  const salvar = trpc.roteiros.salvarConfig.useMutation({ onSuccess: () => { toast.success('Regras salvas'); onSalvo() }, onError: (e) => toast.error(e.message) })
  const hoje = hojeBr()
  return (
    <div className="rounded-xl border border-dark-600 bg-dark-800 p-4 space-y-4 max-w-3xl">
      <div className="text-sm font-medium text-dark-100">Regras do Roteiro do dia</div>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
        <div className="text-sm font-medium text-amber-200 claro:text-amber-700">Quem está no teste</div>
        <p className="text-xs text-dark-300">Só os vendedores marcados aqui veem a aba "Meu roteiro" e seguem a trava. Os outros continuam registrando visita como sempre.</p>
        <div className="flex flex-wrap gap-2">
          {candidatos.map((c) => {
            const marcado = f.participantes.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setF({ ...f, participantes: marcado ? f.participantes.filter((x) => x !== c.id) : [...f.participantes, c.id] })}
                className={`px-2.5 py-1 rounded-full border text-xs ${marcado ? 'border-gold-500 bg-gold-500/15 text-gold-300 claro:text-gold-700 font-medium' : 'border-dark-600 text-dark-300 hover:border-dark-400'}`}
              >
                {marcado ? '✓ ' : ''}{c.name}
              </button>
            )
          })}
        </div>
        {!f.participantes.length && <p className="text-xs text-dark-500">Ninguém marcado = o Roteiro fica desligado para todos.</p>}
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={!!f.travaDesde} onChange={(e) => setF({ ...f, travaDesde: e.target.checked ? proximoDiaUtilSimples(hoje) : null })} />
        <span>
          <b className="text-dark-100">Trava ligada</b>
          <span className="block text-xs text-dark-400">Vendedor externo só registra visita pelo roteiro aprovado (botão "Cheguei"). Fora dele, só com visita extra liberada por você.</span>
          {f.travaDesde && (
            <span className="mt-1.5 flex items-center gap-2 text-xs text-dark-300">
              Vale a partir de <input type="date" value={f.travaDesde} min={hoje} onChange={(e) => setF({ ...f, travaDesde: e.target.value })} className="rounded-md border border-dark-600 bg-transparent px-2 py-1 text-dark-100" />
            </span>
          )}
        </span>
      </label>
      <div className="grid sm:grid-cols-3 gap-4 text-xs text-dark-300">
        <label className="space-y-1">
          <span className="block">Prazo para enviar (véspera)</span>
          <input type="time" value={f.horaLimite} onChange={(e) => setF({ ...f, horaLimite: e.target.value })} className="rounded-md border border-dark-600 bg-transparent px-2 py-1 text-dark-100" />
          <span className="block text-dark-500">Depois disso você recebe aviso de quem não enviou.</span>
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={!!f.autoAprovarHora} onChange={(e) => setF({ ...f, autoAprovarHora: e.target.checked ? '08:00' : null })} /> Aprovar sozinho se eu não analisar até
          </span>
          {f.autoAprovarHora && <input type="time" value={f.autoAprovarHora} onChange={(e) => setF({ ...f, autoAprovarHora: e.target.value })} className="rounded-md border border-dark-600 bg-transparent px-2 py-1 text-dark-100" />}
          <span className="block text-dark-500">Do próprio dia do roteiro. Evita o vendedor ficar parado esperando.</span>
        </label>
        <label className="space-y-1">
          <span className="block">Mínimo de paradas por roteiro</span>
          <input type="number" min={0} max={30} value={f.minParadas} onChange={(e) => setF({ ...f, minParadas: Math.max(0, Number(e.target.value) || 0) })} className="w-20 rounded-md border border-dark-600 bg-transparent px-2 py-1 text-dark-100" />
          <span className="block text-dark-500">0 = sem mínimo.</span>
        </label>
      </div>
      <Button size="sm" loading={salvar.isPending} onClick={() => salvar.mutate(f)}>Salvar regras</Button>
    </div>
  )
}

function Relatorio() {
  const hoje = hojeBr()
  const [de, setDe] = useState(`${hoje.slice(0, 8)}01`)
  const [ate, setAte] = useState(hoje)
  const { data, isLoading } = trpc.roteiros.relatorio.useQuery({ de, ate })
  const rot = (k: string) => RESULTADOS_VISITA.find((r) => r.value === k)?.label ?? k
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-heading text-dark-100">Planejado x realizado</div>
        <input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} className="rounded-lg border border-dark-600 bg-transparent px-2 py-1 text-xs text-dark-200" />
        <span className="text-xs text-dark-500">até</span>
        <input type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} className="rounded-lg border border-dark-600 bg-transparent px-2 py-1 text-xs text-dark-200" />
      </div>
      {isLoading ? (
        <p className="text-sm text-dark-400">Carregando...</p>
      ) : !data?.length ? (
        <p className="text-sm text-dark-500">Nenhum roteiro enviado nesse período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-dark-600">
          <table className="w-full text-xs">
            <thead className="bg-dark-800 text-dark-400">
              <tr>
                {['Vendedor', 'Roteiros', 'No prazo', 'Paradas', 'Feitas', 'Cumprido', 'Puladas', 'Extras', 'Visitas', 'Tempo médio', 'Km previstos', 'Resultados', 'Alertas'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.vendedorId} className="border-t border-dark-700 text-dark-200 align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{l.nome}</td>
                  <td className="px-3 py-2">{l.roteiros}{l.automaticos ? <span className="text-dark-500"> ({l.automaticos} auto)</span> : null}</td>
                  <td className={`px-3 py-2 ${l.noPrazo < l.roteiros ? 'text-amber-400 claro:text-amber-700' : ''}`}>{l.noPrazo}/{l.roteiros}</td>
                  <td className="px-3 py-2">{l.planejadas}</td>
                  <td className="px-3 py-2">{l.visitadas}</td>
                  <td className={`px-3 py-2 font-semibold ${l.cumprimento >= 80 ? 'text-green-400 claro:text-green-700' : l.cumprimento >= 50 ? 'text-amber-400 claro:text-amber-700' : 'text-red-400 claro:text-red-700'}`}>{l.cumprimento}%</td>
                  <td className="px-3 py-2" title={Object.entries(l.motivosPulo).map(([m, n]) => `${m}: ${n}`).join('\n')}>{l.puladas}{l.puladas ? <span className="text-dark-500"> ⓘ</span> : null}</td>
                  <td className="px-3 py-2">{l.extras}</td>
                  <td className="px-3 py-2">{l.visitas}</td>
                  <td className="px-3 py-2">{l.tempoMedioMin != null ? `${l.tempoMedioMin} min` : '—'}</td>
                  <td className="px-3 py-2">{l.km}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{Object.entries(l.resultados).map(([k, n]) => `${rot(k)}: ${n}`).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-amber-400 claro:text-amber-700">{[l.semGps ? `${l.semGps} sem GPS` : '', l.longe ? `${l.longe} longe do cliente` : ''].filter(Boolean).join(' · ') || <span className="text-dark-500">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-dark-500">"Cumprido" = paradas feitas ÷ paradas do roteiro (incluindo extras liberadas). "Longe do cliente" = chegada registrada a mais de 300 m do ponto da parada. Passe o mouse em "Puladas" para ver os motivos.</p>
    </div>
  )
}

