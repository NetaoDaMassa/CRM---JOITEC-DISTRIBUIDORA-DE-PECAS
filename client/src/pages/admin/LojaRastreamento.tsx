import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MousePointerClick, KeyRound, Copy } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { useAuth } from '../../contexts/AuthContext'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { formatarMoeda } from '../../lib/moeda'

// Loja virtual nova (Compretec) — o que os visitantes fazem: páginas e
// tempo, tempo até sair, cliques com o produto, produtos mais vistos,
// origem do tráfego e quem se identificou (virou lead). Pedido do João,
// 2026-11-03. Dados: eventos que a loja manda em lote (routes/lojaEventos.ts).

function hojeBr() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
}
function diasAtras(n: number) {
  return new Date(Date.now() - 3 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)
}
function tempo(msx: number | null | undefined) {
  if (!msx) return '—'
  const s = Math.round(msx / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
const n = (v: number) => v.toLocaleString('pt-BR')
const dataHora = (utc: string | null) =>
  utc ? new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3 min-w-0">
      <h2 className="text-sm font-semibold text-dark-100">{titulo}</h2>
      {children}
    </div>
  )
}

function Tabela({ cab, linhas, vazio }: { cab: string[]; linhas: React.ReactNode[][]; vazio: string }) {
  if (!linhas.length) return <p className="text-sm text-dark-400">{vazio}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-dark-400 text-left">
            {cab.map((c, i) => (
              <th key={c} className={`py-1.5 pr-3 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-dark-700/70">
              {l.map((c, j) => (
                <td key={j} className={`py-1.5 pr-3 ${j > 0 ? 'text-right font-mono whitespace-nowrap' : 'text-dark-200'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Configuracao() {
  const { data } = trpc.lojaRastreamento.chave.useQuery()
  const [chave, setChave] = useState<string | null>(null)
  const gerar = trpc.lojaRastreamento.gerarChave.useMutation({ onSuccess: (r) => setChave(r.chave), onError: (e) => toast.error(e.message) })
  const url = `${window.location.origin}/api/loja/eventos`
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copiado'))
  if (!data) return null
  return (
    <Bloco titulo="🔑 Ligação com a loja (só superAdmin)">
      <div className="text-sm text-dark-300 space-y-1">
        <p>
          Endereço que a loja chama: <code className="text-gold-300">{url}</code>
          <button type="button" className="ml-2 text-dark-400 hover:text-dark-100" onClick={() => copiar(url)}>
            <Copy size={13} className="inline" />
          </button>
        </p>
        <p>
          company_id: <code className="text-gold-300">{data.slug}</code> · chave {data.configurada ? <b className="text-green-300">configurada</b> : <b className="text-amber-300">ainda não gerada</b>}
        </p>
      </div>
      {chave ? (
        <div className="rounded-lg border border-amber-600/50 bg-amber-900/20 p-3 space-y-2">
          <p className="text-xs text-amber-200">Copie agora e cole na configuração da loja (variável de ambiente). Ela não aparece de novo — se perder, gere outra.</p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all text-dark-100 flex-1">{chave}</code>
            <Button size="sm" variant="secondary" onClick={() => copiar(chave)}>
              Copiar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" loading={gerar.isPending} onClick={() => gerar.mutate()}>
          <KeyRound size={14} className="mr-1 inline" /> {data.configurada ? 'Gerar chave nova (a antiga para de valer)' : 'Gerar chave'}
        </Button>
      )}
    </Bloco>
  )
}

export default function LojaRastreamento() {
  const { user } = useAuth()
  const [de, setDe] = useState(diasAtras(6))
  const [ate, setAte] = useState(hojeBr())
  const { data, isLoading } = trpc.lojaRastreamento.resumo.useQuery({ de, ate })
  const base = user?.role === 'admin' ? '/admin/leads' : '/vendedor/leads'
  const t = data?.totais
  const maiorDia = Math.max(1, ...(data?.porDia ?? []).map((d) => d.visitantes))
  const topoFunil = data?.funil[0]?.visitantes || 1

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
            <MousePointerClick size={20} className="text-orange-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">Loja virtual — visitantes</h1>
            <p className="text-sm text-dark-400">Páginas, tempo, cliques, produtos, origem do tráfego e quem virou lead</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {[
            ['Hoje', 0],
            ['7 dias', 6],
            ['30 dias', 29],
          ].map(([rot, d]) => (
            <Button key={rot as string} size="sm" variant="ghost" onClick={() => (setDe(diasAtras(d as number)), setAte(hojeBr()))}>
              {rot}
            </Button>
          ))}
          <Input label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Input label="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      {user?.superAdmin && <Configuracao />}

      {isLoading || !data || !t ? (
        <div className="h-40 rounded-2xl bg-dark-800 animate-pulse" />
      ) : t.visitantes === 0 ? (
        <p className="text-sm text-dark-400 bg-dark-800 border border-dark-600 rounded-2xl p-5">
          Nenhum evento da loja neste período. Os dados aparecem assim que a loja começar a mandar o rastreamento.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            {[
              ['Visitantes', n(t.visitantes)],
              ['Sessões', n(t.sessoes)],
              ['Páginas vistas', n(t.paginasVistas)],
              ['Págs. por sessão', t.paginasPorSessao ? t.paginasPorSessao.toFixed(1) : '—'],
              ['Tempo médio na página', tempo(t.tempoMedioPaginaMs)],
              ['Tempo até sair (média)', tempo(t.tempoMedioSessaoMs)],
              ['Viraram lead', n(t.leads)],
              ['Compras', `${n(t.compras)}${t.valorCompras ? ` · ${formatarMoeda(t.valorCompras, { casas: 0 })}` : ''}`],
            ].map(([rot, v]) => (
              <div key={rot} className="bg-dark-800 border border-dark-600 rounded-2xl p-3">
                <p className="text-xs text-dark-400">{rot}</p>
                <p className="text-lg font-bold font-mono text-dark-50">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Bloco titulo="Funil (visitantes únicos)">
              <div className="space-y-2">
                {data.funil.map((f) => (
                  <div key={f.etapa} className="flex items-center gap-3">
                    <span className="w-44 text-sm text-dark-300 shrink-0">{f.etapa}</span>
                    <div className="flex-1 h-6 rounded bg-dark-700 overflow-hidden">
                      <div className="h-full bg-orange-500/70" style={{ width: `${(f.visitantes / topoFunil) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right font-mono text-sm">
                      {n(f.visitantes)} <span className="text-dark-500 text-xs">{Math.round((f.visitantes / topoFunil) * 100)}%</span>
                    </span>
                  </div>
                ))}
              </div>
              {t.carrinhosAbandonados > 0 && <p className="text-xs text-amber-300">{t.carrinhosAbandonados} carrinho(s) abandonado(s) no período</p>}
            </Bloco>
            <Bloco titulo="Visitantes por dia">
              <div className="flex items-end gap-1 h-40">
                {data.porDia.map((d) => (
                  <div key={d.dia} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${d.dia}: ${d.visitantes} visitantes, ${d.views} páginas, ${d.compras} compras`}>
                    <span className="text-[10px] text-dark-300">{d.visitantes}</span>
                    <div className="w-full rounded-t bg-orange-500/60" style={{ height: `${(d.visitantes / maiorDia) * 100}%` }} />
                    <span className="text-[10px] text-dark-500">{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            </Bloco>
          </div>

          <Bloco titulo="Produtos mais visitados">
            <Tabela
              cab={['Produto', 'Vistas', 'Visitantes', 'Cliques', 'Carrinho', 'Compras', 'Tempo na página']}
              vazio="Nenhum produto visto no período."
              linhas={data.produtos.map((p) => [
                <span key="n">
                  {p.nome} <span className="text-xs text-dark-500">{p.sku}</span>
                </span>,
                n(p.vistas),
                n(p.visitantes),
                n(p.cliques),
                n(p.carrinho),
                n(p.compras),
                tempo(p.engajadoMedioMs),
              ])}
            />
          </Bloco>

          <div className="grid lg:grid-cols-2 gap-4">
            <Bloco titulo="De onde vêm (origem do tráfego)">
              <Tabela
                cab={['Origem', 'Sessões', 'Visitantes', 'Carrinho', 'Leads', 'Compras']}
                vazio="Sem dados."
                linhas={data.origens.map((o) => [o.origem, n(o.sessoes), n(o.visitantes), n(o.carrinho), n(o.leads), `${n(o.compras)}${o.valor ? ` · ${formatarMoeda(o.valor, { casas: 0 })}` : ''}`])}
              />
            </Bloco>
            <Bloco titulo="Cliques em botões">
              <Tabela
                cab={['Botão / produto', 'Cliques', 'Visitantes']}
                vazio="Nenhum clique registrado."
                linhas={data.cliques.map((c) => [
                  <span key="b">
                    {c.elemento}
                    {c.produto && <span className="text-xs text-dark-400"> · {c.produto}</span>}
                  </span>,
                  n(c.cliques),
                  n(c.visitantes),
                ])}
              />
            </Bloco>
          </div>

          <Bloco titulo="Páginas: tempo e saída">
            <Tabela
              cab={['Página', 'Visualizações', 'Tempo engajado (média)', 'Tempo aberta (média)', 'Saíram por aqui']}
              vazio="Sem páginas no período."
              linhas={data.paginas.map((p) => [
                <span key="p">
                  {p.titulo ?? p.path} <span className="text-xs text-dark-500">{p.path}</span>
                </span>,
                n(p.views),
                tempo(p.engajadoMedioMs),
                tempo(p.duracaoMediaMs),
                n(p.saidas),
              ])}
            />
          </Bloco>

          <Bloco titulo="Visitantes que se identificaram (viraram lead)">
            <Tabela
              cab={['Lead', 'Telefone', 'Última visita', 'Ações na loja']}
              vazio="Ninguém se identificou no período."
              linhas={data.identificados.map((v) => [
                <Link key="l" to={`${base}/${v.leadId}`} className="text-gold-400 hover:underline">
                  {v.nome ?? `Lead ${v.leadId}`}
                </Link>,
                v.telefone ?? '—',
                dataHora(v.ultimaVisita),
                n(v.eventos),
              ])}
            />
          </Bloco>
        </>
      )}
    </div>
  )
}
