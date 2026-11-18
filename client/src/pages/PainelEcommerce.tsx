import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { Card, Kpi } from '../components/painelTv/BlocosTv'

// Painel de TV do E-commerce (João, 2026-11-18) — metas das vendedoras e
// meta geral, puxado sozinho da Aton (conta do marketplace de cada pedido).
// Mesmo formato telão do /painel-tv: tudo em vh, 1 tela por slide, sem rolagem.
type Dados = inferRouterOutputs<AppRouter>['painelEcommerce']['resumo']
type Vendedora = Dados['vendedoras'][number]

const COR_AZUL = '#3987e5'
const COR_VERDE = '#0ca30c'
const COR_AMBAR = '#e0a020'
const COR_RUIM = '#dc4444'
const SEGUNDOS_POR_SLIDE = 30

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const mil = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 100000 ? 0 : 1 })} mil` : moeda(v))
const pct = (v: number) => `${Math.round(v * 100)}%`
const urlFoto = (p: string | null) => (!p ? null : p.startsWith('/') || p.startsWith('http') ? p : `/uploads/${p}`)
const nomeConta = (c: string) =>
  c
    .toLowerCase()
    .replace(/(^|\s)\S/g, (s) => s.toUpperCase())
    .replace(/^Ml /, 'ML ')
    .replace(/ Jt$/, ' JT')
    .replace('Tik Tok', 'TikTok')

// Barra em 3 degraus iguais (0→M1, M1→M2, M2→M3) — com metas próximas
// (40/45/50 mil) os rótulos nunca se encostam.
function progresso(valor: number, metas: number[]) {
  let p = 0
  let prev = 0
  for (const m of metas) {
    if (valor >= m) {
      p += 1 / 3
      prev = m
      continue
    }
    p += Math.max(0, (valor - prev) / ((m - prev) || 1)) / 3
    break
  }
  return Math.min(p, 1)
}

function Avatar({ v, tamanho, destaque }: { v: Vendedora; tamanho: string; destaque?: boolean }) {
  const foto = urlFoto(v.fotoPath)
  return (
    <span
      className="rounded-full shrink-0 inline-flex items-center justify-center font-bold bg-[#1d3550] text-[#9cc4f0] bg-cover bg-center"
      style={{ width: tamanho, height: tamanho, fontSize: `calc(${tamanho} * 0.45)`, border: `0.3vh solid ${destaque ? COR_AMBAR : '#1f3045'}`, backgroundImage: foto ? `url('${foto}')` : undefined }}
    >
      {foto ? '' : v.nome[0]}
    </span>
  )
}

function SlideMetas({ d }: { d: Dados }) {
  const pctGeral = d.metaGeral ? d.total.valor / d.metaGeral : 0
  const falta = Math.max(d.metaGeral - d.total.valor, 0)
  const restantes = Math.max(d.diasNoMes - d.diaHoje, 1)
  const corGeral = pctGeral >= 1 ? COR_VERDE : COR_AZUL
  const [lider, segunda] = d.vendedoras
  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <div className="col-span-4 flex flex-col gap-[2vh] min-h-0">
        <Card titulo="🏢 Meta geral do mês" cor={corGeral} className="flex-[1.5]">
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-[12vh] leading-none font-bold font-mono tabular-nums text-dark-50">{pct(pctGeral)}</p>
            <p className="text-[2.2vh] text-dark-400 mt-[1vh]">
              <span className="font-mono text-dark-100">{moeda(d.total.valor)}</span> de <span className="font-mono">{moeda(d.metaGeral)}</span>
            </p>
            <div className="h-[2vh] bg-dark-900 rounded-full mt-[2vh] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(pctGeral * 100, 100)}%`, background: corGeral }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[1.6vh] mt-[2vh]">
            {[
              [d.total.qtd.toLocaleString('pt-BR'), 'vendas no mês'],
              [mil(d.total.hojeValor), 'vendido hoje'],
              [mil(falta), 'falta p/ a meta'],
              [mil(falta / restantes), 'precisa vender por dia'],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="text-[3.4vh] font-bold font-mono tabular-nums leading-none text-dark-50">{v}</p>
                <p className="text-[1.6vh] text-dark-400 mt-[0.5vh]">{l}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card titulo="👑 1º lugar do mês" cor={COR_AMBAR} className="flex-1">
          {lider && lider.valor > 0 ? (
            <div className="flex-1 flex flex-col justify-center gap-[1vh]">
              <div className="flex items-center gap-[2vh]">
                <Avatar v={lider} tamanho="11vh" destaque />
                <p className="text-[5.6vh] font-bold leading-none text-dark-50">🥇 {lider.nome}</p>
              </div>
              <p className="text-[2.2vh] text-dark-400">
                <b className="font-mono text-amber-400">{pct(lider.valor / (lider.metas[0] || 1))}</b> da Meta 1 · <span className="font-mono">{moeda(lider.valor)}</span>
              </p>
              {segunda && (
                <p className="text-[2vh] text-dark-500">
                  {segunda.nome} vem em 2º com <span className="font-mono">{pct(segunda.valor / (segunda.metas[0] || 1))}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-[2.2vh] text-dark-500">Ainda sem vendas no mês.</p>
          )}
        </Card>
      </div>

      <Card titulo="🏆 Ranking do mês · % da Meta 1 de cada uma" cor={COR_AZUL} className="col-span-8">
        <div className="flex-1 flex flex-col justify-around min-h-0">
          {d.vendedoras.map((v, i) => {
            const batidas = v.metas.filter((m) => v.valor >= m).length
            const prox = v.metas.find((m) => v.valor < m)
            const cor = batidas === 3 ? COR_AMBAR : batidas >= 1 ? COR_VERDE : COR_AZUL
            const ritmo = (v.valor / d.diaHoje) * d.diasNoMes
            return (
              <div key={v.id} className="grid grid-cols-[1.15fr_2fr] gap-[2.4vh] items-center border-b border-dark-700 last:border-0 pb-[1.6vh]">
                <div className="min-w-0">
                  <div className="flex items-center gap-[1.2vh] flex-wrap">
                    <span className="text-[3.6vh]">{['🥇', '🥈', '🥉'][i] ?? `${i + 1}º`}</span>
                    <Avatar v={v} tamanho="7vh" destaque={i === 0} />
                    <span className="text-[4vh] font-bold text-dark-50 leading-none">{v.nome}</span>
                    <span className="text-[2.4vh] font-mono text-dark-400">{pct(v.valor / (v.metas[0] || 1))}</span>
                    {batidas > 0 && (
                      <span className={`text-[1.6vh] font-bold rounded-full px-[1vh] py-[0.3vh] ${batidas === 3 ? 'bg-amber-900/40 text-amber-300' : 'bg-green-900/40 text-green-300'}`}>✓ Meta {batidas}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-[2vh] gap-y-[0.4vh] mt-[1vh] text-[1.8vh] text-dark-400">
                    <span><b className="font-mono text-dark-50 text-[2.2vh]">{moeda(v.valor)}</b> vendido</span>
                    <span><b className="font-mono text-dark-50 text-[2.2vh]">{v.qtd.toLocaleString('pt-BR')}</b> vendas</span>
                    <span><b className="font-mono text-dark-50 text-[2.2vh]">{moeda(v.qtd ? v.valor / v.qtd : 0)}</b> ticket</span>
                    <span><b className="font-mono text-dark-50 text-[2.2vh]">{mil(v.hojeValor)}</b> hoje</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-[0.6vh] mb-[1vh]">
                    {v.contas.map((c) => (
                      <span key={c.conta} className={`text-[1.5vh] rounded-[0.6vh] px-[0.8vh] py-[0.2vh] ${c.qtd ? 'bg-dark-900 text-dark-400' : 'bg-red-900/30 text-red-300'}`}>
                        {nomeConta(c.conta)} <b className="font-mono font-medium text-dark-100">{c.qtd ? mil(c.valor) : 'sem pedidos'}</b>
                      </span>
                    ))}
                  </div>
                  <div className="relative h-[2.4vh] bg-dark-900 rounded-full">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progresso(v.valor, v.metas) * 100}%`, background: cor }} />
                    <span className="absolute -top-[0.4vh] -bottom-[0.4vh] left-1/3 w-[0.25vh] bg-dark-200/60" />
                    <span className="absolute -top-[0.4vh] -bottom-[0.4vh] left-2/3 w-[0.25vh] bg-dark-200/60" />
                  </div>
                  <div className="relative h-[2.4vh] text-[1.5vh] font-mono text-dark-400">
                    {v.metas.map((m, k) => (
                      <span key={k} className={`absolute top-[0.4vh] -translate-x-full whitespace-nowrap ${v.valor >= m ? 'text-dark-50 font-bold' : ''}`} style={{ left: `${(k + 1) * 33.333}%` }}>
                        {v.valor >= m ? '✓ ' : ''}M{k + 1} {mil(m)}
                      </span>
                    ))}
                  </div>
                  <p className="text-[1.7vh] text-dark-400">
                    {prox ? (
                      <>
                        Falta <b className="font-mono text-amber-400">{mil(prox - v.valor)}</b> p/ Meta {v.metas.indexOf(prox) + 1}
                      </>
                    ) : (
                      <b className="text-amber-400">Bateu as 3 metas 🎉</b>
                    )}{' '}
                    · no ritmo atual fecha o mês em <span className="font-mono">{mil(ritmo)}</span>
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function Barras({ valores, rotulos, destaque, cor }: { valores: number[]; rotulos: string[]; destaque: number; cor: string }) {
  const max = Math.max(...valores, 1)
  return (
    <>
      <div className="flex-1 min-h-0 flex items-end gap-[0.4vh] pt-[1vh]">
        {valores.map((v, i) => (
          <div key={i} className="flex-1 rounded-t-[0.4vh] min-h-[0.3vh]" style={{ height: `${(v / max) * 100}%`, background: i === destaque ? COR_AMBAR : cor }} />
        ))}
      </div>
      <div className="flex gap-[0.4vh] text-[1.3vh] text-dark-500 mt-[0.6vh]">
        {rotulos.map((r, i) => (
          <span key={i} className="flex-1 text-center">
            {r}
          </span>
        ))}
      </div>
    </>
  )
}

function SlideContas({ d }: { d: Dados }) {
  const grupos = [
    ...d.vendedoras.map((v) => ({ titulo: v.nome, contas: d.contas.filter((c) => c.dona === v.id) })),
    { titulo: 'Só no total', contas: d.contas.filter((c) => c.dona === '') },
  ].filter((g) => g.contas.length)
  const horaPico = d.horas.indexOf(Math.max(...d.horas))
  return (
    <div className="flex flex-col gap-[2vh] h-full">
      <div className="grid grid-cols-4 gap-[2vh] shrink-0">
        <Kpi titulo="Pedidos hoje" valor={d.total.hojeQtd.toLocaleString('pt-BR')} sub={`${moeda(d.total.hojeValor)} até agora`} cor={COR_AZUL} />
        <Kpi titulo="Ticket médio" valor={moeda(d.total.qtd ? d.total.valor / d.total.qtd : 0)} sub="no mês, todas as contas" cor={COR_AZUL} />
        <Kpi titulo="⏳ Aguardando faturar" valor={d.total.aguardQtd.toLocaleString('pt-BR')} sub={`${moeda(d.total.aguardValor)} vendidos, ainda sem nota`} cor={COR_AMBAR} />
        <Kpi titulo="✖ Cancelados no marketplace" valor={d.total.cancQtd.toLocaleString('pt-BR')} sub={`${moeda(d.total.cancValor)} perdidos no mês`} cor={COR_RUIM} />
      </div>
      <div className="grid grid-cols-12 gap-[2vh] flex-1 min-h-0">
        <Card titulo="Vendas por conta" cor={COR_AZUL} className="col-span-7">
          <table className="w-full text-[1.9vh]">
            <thead>
              <tr className="text-[1.5vh] text-dark-400 uppercase tracking-wide text-left">
                <th className="pb-[0.6vh] font-medium">Conta</th>
                <th className="pb-[0.6vh] font-medium text-right">Pedidos</th>
                <th className="pb-[0.6vh] font-medium text-right">Valor</th>
                <th className="pb-[0.6vh] font-medium text-right">Hoje</th>
                <th className="pb-[0.6vh] font-medium text-right">Cancel.</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => [
                <tr key={`g-${g.titulo}`}>
                  <td colSpan={5} className="pt-[1vh] pb-[0.3vh] text-[1.6vh] font-bold text-gold-400">
                    {g.titulo}
                  </td>
                </tr>,
                ...g.contas.map((c) => (
                  <tr key={c.conta} className="border-t border-dark-700/70">
                    <td className="py-[0.45vh] text-dark-100">
                      {nomeConta(c.conta)}
                      {!c.qtd && <span className="ml-[0.8vh] text-[1.4vh] text-red-300">sem pedidos</span>}
                    </td>
                    <td className="py-[0.45vh] text-right font-mono">{c.qtd.toLocaleString('pt-BR')}</td>
                    <td className="py-[0.45vh] text-right font-mono">{moeda(c.valor)}</td>
                    <td className="py-[0.45vh] text-right font-mono text-dark-300">{mil(c.hojeValor)}</td>
                    <td className={`py-[0.45vh] text-right font-mono ${c.cancQtd ? 'text-red-300' : 'text-dark-500'}`}>{c.cancQtd || '–'}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </Card>
        <div className="col-span-5 flex flex-col gap-[2vh] min-h-0">
          <Card titulo="Faturamento por dia" cor={COR_AZUL} className="flex-1">
            <Barras
              valores={d.dias.map((x) => x.valor)}
              rotulos={d.dias.map((x) => String(Number(x.dia.slice(8, 10))))}
              destaque={d.dias.findIndex((x) => x.dia === d.hoje)}
              cor={COR_AZUL}
            />
          </Card>
          <Card titulo={`Pedidos por hora · pico às ${horaPico}h`} cor={COR_AZUL} className="flex-1">
            <Barras valores={d.horas} rotulos={d.horas.map((_, h) => (h % 3 === 0 ? `${h}h` : ''))} destaque={horaPico} cor={COR_AZUL} />
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function PainelEcommerce() {
  const { user } = useAuth()
  const [relogio, setRelogio] = useState(new Date())
  const [slide, setSlide] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % 2), SEGUNDOS_POR_SLIDE * 1000)
    return () => clearInterval(id)
  }, [])
  // TV fica sem mouse/teclado — atualiza mesmo com a aba sem foco.
  const { data, error } = trpc.painelEcommerce.resumo.useQuery(undefined, { refetchInterval: 60_000, refetchIntervalInBackground: true, retry: 1 })
  const { data: minhas } = trpc.permissoes.minhasPermissoes.useQuery(undefined, { enabled: user?.role === 'admin' && !user.superAdmin, retry: false })
  const podeConfigurar = !!user?.superAdmin || !!minhas?.includes('painel_ecommerce_config')
  const slides = ['Metas', 'Contas']
  const lido = data ? new Date(data.lidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="h-screen overflow-hidden bg-dark-950 text-dark-50 p-[2.4vh] flex flex-col gap-[2vh]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[2vh]">
          <h1 className="font-heading text-[4vh] text-gold-400 font-bold leading-none">🛒 E-commerce</h1>
          <span className="text-[3vh] font-semibold text-dark-100 leading-none">· {slides[slide]}</span>
          <span className="flex items-center gap-[0.8vh] text-[1.7vh] text-green-400 bg-green-900/25 px-[1.2vh] py-[0.5vh] rounded-full">
            <span className="w-[1vh] h-[1vh] rounded-full bg-green-400 animate-pulse" />
            ao vivo da Aton{lido ? ` · lido às ${lido}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-[1.6vh]">
          <div className="text-right">
            <p className="text-[4vh] font-mono leading-none tabular-nums">{relogio.toLocaleTimeString('pt-BR')}</p>
            <p className="text-[1.8vh] text-dark-400 mt-[0.4vh]">{relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
          </div>
          {podeConfigurar && (
            <Link to="/admin/painel-ecommerce" className="text-dark-600 hover:text-dark-300 p-1.5 rounded-lg hover:bg-dark-800" title="Metas, contas e fotos">
              <Settings size={18} />
            </Link>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {error ? (
          <p className="text-red-400 text-[2.4vh]">{error.message}</p>
        ) : !data ? (
          <p className="text-dark-500 text-[2.4vh]">Buscando os pedidos do mês na Aton… (a primeira leitura do mês leva até 1 minuto)</p>
        ) : slide === 0 ? (
          <SlideMetas d={data} />
        ) : (
          <SlideContas d={data} />
        )}
      </div>

      <div className="shrink-0 flex items-center gap-[1vh]">
        {slides.map((s, i) => (
          <button
            key={s}
            onClick={() => setSlide(i)}
            className={`relative flex-1 overflow-hidden rounded-full text-[1.7vh] py-[0.7vh] ${i === slide ? 'bg-dark-700 text-dark-50 font-semibold' : 'bg-dark-800 text-dark-500'}`}
          >
            {i === slide && <span key={slide} className="absolute inset-y-0 left-0 bg-gold-400/30 painel-progresso" style={{ animationDuration: `${SEGUNDOS_POR_SLIDE}s` }} />}
            <span className="relative">{s}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
