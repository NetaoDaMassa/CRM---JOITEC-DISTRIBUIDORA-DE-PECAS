import { memo, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { formatarPercentual } from '../lib/utils'
import AvatarMeta from '../components/ui/AvatarMeta'
import PainelConfigModal from '../components/PainelConfigModal'
import { BarraLinha, Card, Kpi, Linhas, NomeVendedor, Posicao, Selo } from '../components/painelTv/BlocosTv'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PainelData = RouterOutputs['dashboardOdin']['painelTvEquipes']

// Painel de TV da Odin Compressores no formato telão 75" (mesmos blocos do
// PainelTV.tsx, tudo em vh, sem rolagem) — uma tela por equipe, cada uma com
// o que ela acompanha (pedido do João, 2026-10-23):
//   Externos: visitas → propostas → pedidos (sem meta individual)
//   Leads:    leads → contatos → propostas → pedidos (meta individual)
//   Peças:    carteira → contatos/ligações → orçamentos → vendas (meta individual)
// Sem R$ na TV — só %, quantidade e participação (ver lib/painelTvOdin.ts).
const COR_META = '#3987e5'
const COR_VISITAS = '#8b6fd1'
const COR_CONTATOS = '#c2691a'
const COR_PEDIDOS = '#0ea5a4'
const COR_META_BATIDA = '#0ca30c'
const COR_RUIM = '#dc4444'

const SEGUNDOS_PADRAO = 25

const pctTexto = (v: number | null | undefined) => (v == null ? '—' : `${formatarPercentual(v)}%`)

// Barra de meta com o tracinho do "ideal de hoje" — quem olha de longe vê se
// está antes ou depois do ritmo.
function BarraMeta({ percentual, ideal, batida, alturaVh = 2.2 }: { percentual: number; ideal: number; batida: boolean; alturaVh?: number }) {
  return (
    <div className="relative bg-dark-900 rounded-full overflow-hidden" style={{ height: `${alturaVh}vh` }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, percentual)}%`, background: batida ? COR_META_BATIDA : percentual >= ideal ? COR_META : COR_RUIM }}
      />
      <div className="absolute inset-y-0 w-[0.35vh] bg-gold-400" style={{ left: `${Math.min(100, ideal)}%` }} title="Ideal de hoje" />
    </div>
  )
}

function Numero({ rotulo, valor, sub, destaque }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; destaque?: 'vermelho' | 'verde' }) {
  const cor = destaque === 'vermelho' ? 'text-red-400' : destaque === 'verde' ? 'text-green-400' : 'text-dark-50'
  return (
    <div className="bg-dark-900/60 rounded-[1vh] px-[1.4vh] py-[1.1vh] min-w-0 flex flex-col justify-center">
      <p className="text-[1.5vh] text-dark-400 uppercase tracking-wide font-semibold truncate">{rotulo}</p>
      <p className={`text-[4.6vh] leading-none font-bold font-mono tabular-nums mt-[0.6vh] ${cor}`}>{valor}</p>
      {sub && <p className="text-[1.5vh] text-dark-400 mt-[0.5vh] truncate">{sub}</p>}
    </div>
  )
}

// Cartão grande por vendedor — Leads e Peças são equipes pequenas (2-3
// pessoas), então cada um ganha um bloco inteiro em vez de uma linha.
function CartaoVendedor({
  nome,
  fotoUrl,
  temMeta,
  percentualMeta,
  bateuMeta,
  ideal,
  colunas = 3,
  children,
}: {
  nome: string
  fotoUrl: string | null
  temMeta: boolean
  percentualMeta: number
  bateuMeta: boolean
  ideal: number
  colunas?: number
  children: React.ReactNode
}) {
  return (
    <div
      className="bg-dark-800 border border-dark-600 rounded-[1.4vh] p-[2.2vh] flex flex-col gap-[1.6vh] min-h-0 overflow-hidden"
      style={{ borderTop: `0.5vh solid ${bateuMeta ? COR_META_BATIDA : COR_META}` }}
    >
      <div className="flex items-center gap-[1.6vh] shrink-0">
        <AvatarMeta nome={nome} fotoUrl={fotoUrl} destaque={bateuMeta} tamanho="6vh" />
        <p className="text-[3.2vh] font-semibold text-dark-50 truncate flex-1">
          {nome} {bateuMeta && '🎉'}
        </p>
        {temMeta ? (
          <span className="text-[5vh] leading-none font-bold font-mono tabular-nums text-dark-50 shrink-0">{pctTexto(percentualMeta)}</span>
        ) : (
          <Selo tom="neutro">sem meta cadastrada</Selo>
        )}
      </div>
      {temMeta && (
        <div className="shrink-0">
          <BarraMeta percentual={percentualMeta} ideal={ideal} batida={bateuMeta} />
          <p className="text-[1.6vh] text-dark-400 mt-[0.6vh]">
            da meta do mês · ideal hoje {pctTexto(ideal)} {percentualMeta >= ideal ? '✅ no ritmo' : '⚠️ abaixo do ritmo'}
          </p>
        </div>
      )}
      <div className="flex-1 min-h-0 grid auto-rows-fr gap-[1.2vh]" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  )
}

const SlideGeral = memo(function SlideGeral({ data }: { data: PainelData }) {
  const g = data.geral
  const equipes = [
    { nome: 'Externos', valor: g.participacao.externos, cor: COR_VISITAS },
    { nome: 'Interno leads', valor: g.participacao.leads, cor: COR_CONTATOS },
    { nome: 'Interno peças', valor: g.participacao.pecas, cor: COR_PEDIDOS },
  ]
  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <div className="col-span-5 flex flex-col gap-[2vh] min-h-0">
        <Card titulo="🏢 Meta do mês · Odin Compressores" cor={g.bateuMeta ? COR_META_BATIDA : COR_META} className="flex-[1.5]">
          {g.temMeta ? (
            <div className="flex-1 flex flex-col justify-center">
              <p className="text-[14vh] leading-none font-bold font-mono tabular-nums text-dark-50">{pctTexto(g.percentualMeta)}</p>
              <p className="text-[2.2vh] text-dark-400 mt-[1vh]">da meta da empresa {g.bateuMeta ? '🎉' : ''}</p>
              <div className="mt-[2.4vh]">
                <BarraMeta percentual={g.percentualMeta} ideal={data.percentualIdealHoje} batida={g.bateuMeta} alturaVh={2.6} />
              </div>
              <div className="mt-[2.4vh] flex flex-wrap gap-[1vh]">
                <Selo tom={g.noRitmo ? 'verde' : 'vermelho'}>
                  Ideal hoje {pctTexto(data.percentualIdealHoje)} {g.noRitmo ? '✅ no ritmo' : '❌ abaixo do ritmo'}
                </Selo>
                <Selo tom="neutro">
                  {data.diasUteisAteHoje} de {data.diasUteisMes} dias úteis
                </Selo>
              </div>
            </div>
          ) : (
            <p className="text-[2.4vh] text-dark-400">Meta da empresa não cadastrada (Configurações → Meta de faturamento da empresa).</p>
          )}
        </Card>
        <Card titulo="De onde vêm as vendas do mês" cor={COR_PEDIDOS} className="flex-1">
          <div className="flex-1 flex flex-col justify-around">
            {equipes.map((e) => (
              <div key={e.nome} className="flex items-center gap-[1.6vh] text-[2.6vh]">
                <span className="w-[22vh] text-dark-100 font-medium">{e.nome}</span>
                <BarraLinha percentual={e.valor} cor={e.cor} rotulo={pctTexto(e.valor)} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="col-span-7 grid grid-cols-3 grid-rows-2 gap-[2vh] min-h-0">
        <Kpi titulo="Pedidos hoje" valor={g.pedidosHoje} sub="vendas fechadas" cor={COR_PEDIDOS} />
        <Kpi titulo="Pedidos no mês" valor={g.pedidosMes} sub="vendas fechadas" cor={COR_PEDIDOS} />
        <Kpi titulo="Propostas no mês" valor={g.propostasMes} sub="externos + leads" cor={COR_META} />
        <Kpi titulo="Visitas no mês" valor={g.visitasMes} sub="equipe externa" cor={COR_VISITAS} />
        <Kpi titulo="Leads no mês" valor={g.leadsMes} sub="recebidos" cor={COR_CONTATOS} />
        <Kpi
          titulo="Leads aguardando"
          valor={<span className={g.leadsAguardando > 0 ? 'text-red-400' : 'text-green-400'}>{g.leadsAguardando}</span>}
          sub="sem nenhum atendimento ainda"
          cor={g.leadsAguardando > 0 ? COR_RUIM : COR_META_BATIDA}
        />
      </div>
    </div>
  )
})

const SlideExternos = memo(function SlideExternos({ data }: { data: PainelData }) {
  const l = data.externos
  const soma = (f: (v: (typeof l)[number]) => number) => l.reduce((a, v) => a + f(v), 0)
  const visitasMes = soma((v) => v.visitasMes)
  const maxVisitas = Math.max(1, ...l.map((v) => v.visitasMes))
  return (
    <div className="flex flex-col gap-[2vh] h-full">
      <div className="grid grid-cols-4 gap-[2vh] shrink-0 h-[20vh]">
        <Kpi titulo="Visitas hoje" valor={soma((v) => v.visitasHoje)} sub="equipe toda" cor={COR_VISITAS} />
        <Kpi titulo="Visitas no mês" valor={visitasMes} sub={`${soma((v) => v.visitasGps)} com GPS`} cor={COR_VISITAS} />
        <Kpi titulo="Propostas no mês" valor={soma((v) => v.propostasMes)} sub={`${soma((v) => v.propostasHoje)} hoje`} cor={COR_META} />
        <Kpi titulo="Pedidos no mês" valor={soma((v) => v.pedidosMes)} sub="vendas fechadas" cor={COR_PEDIDOS} />
      </div>
      <Card titulo="🚗 Ranking dos externos · mês" cor={COR_VISITAS} className="flex-1" extra={<Selo tom="neutro">sem meta individual</Selo>}>
        <div className="flex items-center gap-[1.4vh] text-[1.6vh] text-dark-400 uppercase tracking-wide pb-[0.8vh] border-b border-dark-600 shrink-0">
          <span className="flex-1">Vendedor</span>
          <span className="w-[11vh] text-right">Visitas hoje</span>
          <span className="w-[30%]">Visitas no mês</span>
          <span className="w-[11vh] text-right">Propostas</span>
          <span className="w-[11vh] text-right">Pedidos</span>
          <span className="w-[14vh] text-right">Visita → proposta</span>
        </div>
        <Linhas
          itens={l}
          chave={(v) => v.id}
          render={(v, i, fonteVh) => (
            <>
              <Posicao i={i} />
              <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={i === 0 && v.pedidosMes > 0} tamanho={`${fonteVh * 1.9}vh`} />
              <div className="flex-1 min-w-0 flex">
                <NomeVendedor nome={v.nome} fonteVh={fonteVh} />
              </div>
              <span className={`w-[11vh] text-right font-mono tabular-nums ${v.visitasHoje ? 'text-dark-50 font-bold' : 'text-dark-500'}`}>{v.visitasHoje}</span>
              <div className="w-[30%] flex">
                <BarraLinha percentual={(v.visitasMes / maxVisitas) * 100} cor={COR_VISITAS} rotulo={String(v.visitasMes)} />
              </div>
              <span className="w-[11vh] text-right font-mono tabular-nums text-dark-100">{v.propostasMes}</span>
              <span className="w-[11vh] text-right font-mono tabular-nums font-bold text-dark-50">{v.pedidosMes}</span>
              <span className="w-[14vh] text-right font-mono tabular-nums text-dark-300">{pctTexto(v.conversaoVisitaProposta)}</span>
            </>
          )}
        />
      </Card>
    </div>
  )
})

const SlideLeads = memo(function SlideLeads({ data }: { data: PainelData }) {
  const l = data.leads
  const soma = (f: (v: (typeof l)[number]) => number) => l.reduce((a, v) => a + f(v), 0)
  const aguardando = soma((v) => v.aguardando)
  return (
    <div className="flex flex-col gap-[2vh] h-full">
      <div className="grid grid-cols-5 gap-[2vh] shrink-0 h-[18vh]">
        <Kpi titulo="Leads hoje" valor={soma((v) => v.leadsHoje)} sub="recebidos" cor={COR_CONTATOS} />
        <Kpi titulo="Leads no mês" valor={soma((v) => v.leadsMes)} sub="recebidos" cor={COR_CONTATOS} />
        <Kpi
          titulo="Aguardando"
          valor={<span className={aguardando ? 'text-red-400' : 'text-green-400'}>{aguardando}</span>}
          sub="sem atendimento"
          cor={aguardando ? COR_RUIM : COR_META_BATIDA}
        />
        <Kpi titulo="Contatos hoje" valor={soma((v) => v.contatosHoje)} sub={`${soma((v) => v.contatosMes)} no mês`} cor={COR_CONTATOS} />
        <Kpi titulo="Propostas no mês" valor={soma((v) => v.propostasMes)} sub={`${soma((v) => v.pedidosMes)} viraram pedido`} cor={COR_META} />
      </div>
      <div className="flex-1 min-h-0 grid gap-[2vh]" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(l.length, 1), 4)}, minmax(0, 1fr))` }}>
        {l.map((v) => (
          <CartaoVendedor key={v.id} {...v} ideal={data.percentualIdealHoje}>
            <Numero rotulo="Leads no mês" valor={v.leadsMes} sub={`${v.leadsHoje} hoje`} />
            <Numero rotulo="Aguardando" valor={v.aguardando} sub="sem atendimento" destaque={v.aguardando ? 'vermelho' : 'verde'} />
            <Numero rotulo="Contatos hoje" valor={v.contatosHoje} sub={`${v.contatosMes} no mês`} />
            <Numero rotulo="Propostas" valor={v.propostasMes} sub="no mês" />
            <Numero rotulo="Pedidos" valor={v.pedidosMes} sub="no mês" />
            <Numero rotulo="Lead → pedido" valor={pctTexto(v.leadsMes ? (v.pedidosMes / v.leadsMes) * 100 : null)} sub="conversão" />
          </CartaoVendedor>
        ))}
        {!l.length && <p className="text-dark-500 text-[2.4vh]">Ninguém na equipe de leads.</p>}
      </div>
    </div>
  )
})

const SlidePecas = memo(function SlidePecas({ data }: { data: PainelData }) {
  const l = data.pecas
  const soma = (f: (v: (typeof l)[number]) => number) => l.reduce((a, v) => a + f(v), 0)
  return (
    <div className="flex flex-col gap-[2vh] h-full">
      <div className="grid grid-cols-4 gap-[2vh] shrink-0 h-[18vh]">
        <Kpi titulo="Contatos hoje" valor={soma((v) => v.contatosHoje)} sub={`${soma((v) => v.contatosMes)} no mês`} cor={COR_CONTATOS} />
        <Kpi titulo="Ligações hoje" valor={soma((v) => v.ligacoesHoje)} sub={`${soma((v) => v.ligacoesMes)} no mês`} cor={COR_CONTATOS} />
        <Kpi titulo="Orçamentos em aberto" valor={soma((v) => v.orcamentosAbertos)} sub="em negociação agora" cor={COR_META} />
        <Kpi titulo="Vendas no mês" valor={soma((v) => v.vendasMes)} sub={`${soma((v) => v.vendasHoje)} hoje`} cor={COR_PEDIDOS} />
      </div>
      <div className="flex-1 min-h-0 grid gap-[2vh]" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(l.length, 1), 4)}, minmax(0, 1fr))` }}>
        {l.map((v) => (
          <CartaoVendedor key={v.id} {...v} ideal={data.percentualIdealHoje} colunas={4}>
            <div className="col-span-4 bg-dark-900/60 rounded-[1vh] px-[1.4vh] py-[1.1vh] flex flex-col justify-center gap-[0.8vh]">
              <div className="flex items-baseline justify-between">
                <p className="text-[1.5vh] text-dark-400 uppercase tracking-wide font-semibold">Cobertura da carteira</p>
                <p className="text-[1.6vh] text-dark-400">
                  {v.carteira - v.semContato} de {v.carteira} clientes · faltam {v.semContato}
                </p>
              </div>
              <div className="flex items-center gap-[1.4vh] text-[3.4vh]">
                <BarraLinha percentual={v.coberturaPercentual} cor={v.coberturaPercentual >= data.percentualIdealHoje ? COR_META_BATIDA : COR_CONTATOS} rotulo={pctTexto(v.coberturaPercentual)} />
              </div>
            </div>
            <Numero rotulo="Contatos hoje" valor={v.contatosHoje} sub={`${v.contatosMes} no mês`} />
            <Numero rotulo="Ligações hoje" valor={v.ligacoesHoje} sub={`${v.ligacoesMes} no mês`} />
            <Numero rotulo="Orçamentos" valor={v.orcamentosAbertos} sub="em aberto" />
            <Numero rotulo="Vendas no mês" valor={v.vendasMes} sub={`${v.vendasHoje} hoje`} />
          </CartaoVendedor>
        ))}
        {!l.length && <p className="text-dark-500 text-[2.4vh]">Ninguém na equipe de peças.</p>}
      </div>
    </div>
  )
})

const SLIDES = [
  { chave: 'geral', titulo: 'Visão geral' },
  { chave: 'externos', titulo: 'Externos · visitas e propostas' },
  { chave: 'leads', titulo: 'Interno leads' },
  { chave: 'pecas', titulo: 'Interno peças · carteira' },
] as const

export default function PainelTvOdin() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // A permissão do menu não tem trava de empresa, mas os dados só existem
  // pra Odin Compressores — outra empresa cai no aviso de erro.
  const { data, isError, error } = trpc.dashboardOdin.painelTvEquipes.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true, retry: false })

  const [slideAtual, setSlideAtual] = useState(0)
  const [configAberta, setConfigAberta] = useState(false)
  const utils = trpc.useUtils()
  const { data: config } = trpc.configuracoes.painelTvOdinConfig.useQuery()
  const segundos = config?.segundos ?? SEGUNDOS_PADRAO
  const autoplay = config?.autoplay ?? true
  const salvarConfigMut = trpc.configuracoes.set.useMutation({
    onSuccess() {
      utils.configuracoes.painelTvOdinConfig.invalidate()
      setConfigAberta(false)
    },
  })

  useEffect(() => {
    if (!autoplay) return
    const id = setInterval(() => setSlideAtual((s) => (s + 1) % SLIDES.length), segundos * 1000)
    return () => clearInterval(id)
  }, [segundos, autoplay])

  const atual = SLIDES[slideAtual] ?? SLIDES[0]

  function renderSlide() {
    if (isError) return <p className="text-dark-500 text-[2.4vh]">{error?.message ?? 'Módulo indisponível pra esta empresa.'}</p>
    if (!data) return <p className="text-dark-500 text-[2.4vh]">Carregando...</p>
    switch (atual.chave) {
      case 'geral':
        return <SlideGeral data={data} />
      case 'externos':
        return <SlideExternos data={data} />
      case 'leads':
        return <SlideLeads data={data} />
      case 'pecas':
        return <SlidePecas data={data} />
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-dark-950 text-dark-50 p-[2.4vh] flex flex-col gap-[2vh]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[2vh]">
          <h1 className="font-heading text-[4vh] text-gold-400 font-bold leading-none">Odin Compressores</h1>
          <span className="text-[3vh] font-semibold text-dark-100 leading-none">· {atual.titulo}</span>
          <span className="flex items-center gap-[0.8vh] text-[1.7vh] text-green-400 bg-green-900/25 px-[1.2vh] py-[0.5vh] rounded-full">
            <span className="w-[1vh] h-[1vh] rounded-full bg-green-400 animate-pulse" />
            ao vivo
          </span>
        </div>
        <div className="flex items-center gap-[1.6vh]">
          <div className="text-right">
            <p className="text-[4vh] font-mono leading-none tabular-nums">{relogio.toLocaleTimeString('pt-BR')}</p>
            <p className="text-[1.8vh] text-dark-400 mt-[0.4vh]">{relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
          </div>
          <button
            onClick={() => setConfigAberta(true)}
            className="text-dark-600 hover:text-dark-300 transition-colors p-1.5 rounded-lg hover:bg-dark-800"
            title="Configurar carrossel"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      <PainelConfigModal
        open={configAberta}
        onClose={() => setConfigAberta(false)}
        segundosAtual={segundos}
        autoplayAtual={autoplay}
        salvando={salvarConfigMut.isPending}
        onSalvar={({ segundos: s, autoplay: a }) => salvarConfigMut.mutate({ painel_tv_odin_segundos: s, painel_tv_odin_autoplay: a ? 1 : 0 })}
      />

      <div className="flex-1 min-h-0">{renderSlide()}</div>

      <div className="shrink-0 flex items-center gap-[1vh]">
        {SLIDES.map((s, i) => (
          <button
            key={s.chave}
            onClick={() => setSlideAtual(i)}
            className={`relative flex-1 overflow-hidden rounded-full text-[1.7vh] py-[0.7vh] transition-colors ${
              s.chave === atual.chave ? 'bg-dark-700 text-dark-50 font-semibold' : 'bg-dark-800 text-dark-500'
            }`}
          >
            {s.chave === atual.chave && autoplay && (
              <span key={`${slideAtual}-${segundos}`} className="absolute inset-y-0 left-0 bg-gold-400/30 painel-progresso" style={{ animationDuration: `${segundos}s` }} />
            )}
            <span className="relative">{s.titulo}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
