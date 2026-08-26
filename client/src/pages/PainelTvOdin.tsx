import { memo, useEffect, useState } from 'react'
import { Settings, ArrowRight, MapPin, UserPlus } from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Cell } from 'recharts'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { formatarPercentual } from '../lib/utils'
import AvatarMeta from '../components/ui/AvatarMeta'
import { useAutoScroll } from '../lib/useAutoScroll'
import PainelConfigModal from '../components/PainelConfigModal'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PainelData = RouterOutputs['dashboardOdin']['painelTv']
type Equipe = PainelData['equipeCampo']

// Mesma paleta do Painel de TV normal: azul neutro pra magnitude, âmbar pra
// etapa intermediária do funil, verde só como cor de status (conversão boa).
const COR_TOPO = '#3987e5'
const COR_MEIO = '#c2691a'
const COR_FIM = '#0ca30c'

const SEGUNDOS_PADRAO = 25

function TooltipBarra({ active, payload, formatarValor }: { active?: boolean; payload?: { payload: { nome: string; valor: number } }[]; formatarValor: (v: number) => string }) {
  if (!active || !payload?.length) return null
  const { nome, valor } = payload[0].payload
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium">{nome}</p>
      <p className="text-dark-400">{formatarValor(valor)}</p>
    </div>
  )
}

function LabelFimDaBarra({ x, y, width, height, value }: { x?: number; y?: number; width?: number; height?: number; value?: number }) {
  if (x == null || y == null || width == null || height == null || value == null) return null
  return (
    <text x={x + width + 6} y={y + height / 2} dy={4} fill="#c3c2b7" fontSize={11}>
      {value}
    </text>
  )
}

// Um degrau do funil (ex: "Visitas: 42") — usado em sequência com setas +
// taxa de conversão entre um degrau e o próximo.
function DegrauFunil({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6 flex-1 text-center">
      <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">{titulo}</p>
      <p className="text-5xl font-bold font-mono tabular-nums mt-2" style={{ color: cor }}>
        {valor}
      </p>
    </div>
  )
}

function SetaConversao({ percentual }: { percentual: number | null }) {
  return (
    <div className="flex flex-col items-center justify-center px-2 shrink-0">
      <ArrowRight size={22} className="text-dark-600" />
      <span className="text-sm font-bold font-mono tabular-nums text-gold-400 mt-1">{percentual != null ? `${formatarPercentual(percentual)}%` : '—'}</span>
    </div>
  )
}

function Funil({ icone, titulo, subtitulo, degraus }: { icone: React.ReactNode; titulo: string; subtitulo: string; degraus: { titulo: string; valor: number; cor: string; conversaoAntes: number | null }[] }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        {icone}
        <div>
          <h2 className="text-base font-semibold text-dark-100">{titulo}</h2>
          <p className="text-xs text-dark-500">{subtitulo}</p>
        </div>
      </div>
      <div className="flex items-stretch">
        {degraus.map((d, i) => (
          <div key={d.titulo} className="flex items-stretch flex-1">
            {i > 0 && <SetaConversao percentual={d.conversaoAntes} />}
            <DegrauFunil titulo={d.titulo} valor={d.valor} cor={d.cor} />
          </div>
        ))}
      </div>
    </div>
  )
}

const SlideVisaoGeral = memo(function SlideVisaoGeral({ data }: { data: PainelData }) {
  return (
    <div className="space-y-6">
      <Funil
        icone={<MapPin size={20} className="text-dark-400" />}
        titulo="Equipe de Campo"
        subtitulo="Visita → Proposta → Venda"
        degraus={[
          { titulo: 'Visitas', valor: data.equipeCampo.totais.visitas, cor: COR_TOPO, conversaoAntes: null },
          { titulo: 'Propostas', valor: data.equipeCampo.totais.propostas, cor: COR_MEIO, conversaoAntes: data.equipeCampo.totais.conversaoVisitaProposta },
          { titulo: 'Vendas', valor: data.equipeCampo.totais.vendas, cor: COR_FIM, conversaoAntes: data.equipeCampo.totais.conversaoPropostaVenda },
        ]}
      />
      <Funil
        icone={<UserPlus size={20} className="text-dark-400" />}
        titulo="Equipe de Leads"
        subtitulo="Lead do site → Proposta → Venda (sem visita)"
        degraus={[
          { titulo: 'Leads', valor: data.equipeLeads.totais.leads, cor: COR_TOPO, conversaoAntes: null },
          {
            titulo: 'Propostas',
            valor: data.equipeLeads.totais.propostas,
            cor: COR_MEIO,
            conversaoAntes: data.equipeLeads.totais.leads ? Math.round((data.equipeLeads.totais.propostas / data.equipeLeads.totais.leads) * 1000) / 10 : null,
          },
          { titulo: 'Vendas', valor: data.equipeLeads.totais.vendas, cor: COR_FIM, conversaoAntes: data.equipeLeads.totais.conversaoPropostaVenda },
        ]}
      />
      <p className="text-center text-xs text-dark-500">Mês corrente · atualiza automaticamente</p>
    </div>
  )
})

// Ranking por vendedor de uma equipe — 3 barras (visitas ou leads, propostas,
// vendas) lado a lado por pessoa, mais as duas taxas de conversão na lista
// abaixo. `mostrarVisitas` diferencia o vocabulário/coluna entre as duas
// equipes (campo tem visitas, leads não).
function SlideEquipe({ equipe, tituloTopo, mostrarConversaoTopo }: { equipe: Equipe; tituloTopo: string; mostrarConversaoTopo: boolean }) {
  const porVendedor = equipe.porVendedor

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6">
      {!porVendedor.length && <p className="text-sm text-dark-500">Ninguém registrou nada esse mês ainda.</p>}
      {!!porVendedor.length && (
        <ResponsiveContainer width="100%" height={porVendedor.length * 34 + 10}>
          <BarChart data={porVendedor.map((v) => ({ nome: v.nome, valor: v.vendas }))} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} label={<LabelFimDaBarra />}>
              {porVendedor.map((v) => (
                <Cell key={v.id} fill={COR_FIM} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-dark-500 uppercase tracking-wide mt-1 mb-4">vendas no mês (barra) — detalhe do funil de cada um abaixo</p>

      <div className="space-y-3">
        {porVendedor.map((v) => (
          <div key={v.id} className="flex items-center gap-3">
            <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} size="sm" />
            <span className="flex-1 font-medium text-dark-100 truncate">{v.nome}</span>
            <span className="text-xs text-dark-500 font-mono w-20 text-right">
              {tituloTopo} {mostrarConversaoTopo ? v.visitas : v.leads}
            </span>
            <span className="text-xs text-dark-500 font-mono w-24 text-right">
              Propostas {v.propostas}
              {mostrarConversaoTopo && v.conversaoVisitaProposta != null && <span className="text-dark-600"> ({formatarPercentual(v.conversaoVisitaProposta)}%)</span>}
            </span>
            <span className="text-xs text-dark-500 font-mono w-20 text-right">Vendas {v.vendas}</span>
            <span className="text-sm font-mono tabular-nums text-gold-400 w-14 text-right">
              {v.conversaoPropostaVenda != null ? `${formatarPercentual(v.conversaoPropostaVenda)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const SlideEquipeCampo = memo(function SlideEquipeCampo({ data }: { data: PainelData }) {
  return <SlideEquipe equipe={data.equipeCampo} tituloTopo="Visitas" mostrarConversaoTopo />
})

const SlideEquipeLeads = memo(function SlideEquipeLeads({ data }: { data: PainelData }) {
  return <SlideEquipe equipe={data.equipeLeads} tituloTopo="Leads" mostrarConversaoTopo={false} />
})

// Painel de TV específico da Odin Compressores — pedido do João: repensar
// como um comercial estratégico enxergaria a operação. Dois funis
// separados (campo x leads) porque são dois jeitos diferentes de gerar
// negócio, com gente diferente trabalhando cada um (ver users.canalVenda).
export default function PainelTvOdin() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data } = trpc.dashboardOdin.painelTv.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true })

  const slides = [
    { titulo: 'Visão geral', render: SlideVisaoGeral },
    { titulo: 'Equipe de Campo', render: SlideEquipeCampo },
    { titulo: 'Equipe de Leads', render: SlideEquipeLeads },
  ]
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
    const id = setInterval(() => setSlideAtual((s) => (s + 1) % slides.length), segundos * 1000)
    return () => clearInterval(id)
  }, [slides.length, segundos, autoplay])

  useAutoScroll(slideAtual, segundos * 1000, autoplay)

  const Slide = slides[slideAtual].render

  return (
    <div className="min-h-screen bg-dark-950 text-dark-50 p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">Odin Compressores</p>
          <h1 className="font-heading text-2xl text-gold-400 font-bold mt-0.5">
            {slideAtual === 0 ? 'Visão geral do funil' : slides[slideAtual].titulo}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-mono">{relogio.toLocaleTimeString('pt-BR')}</p>
            <p className="text-sm text-dark-400">{relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
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

      {data ? <Slide data={data} /> : <p className="text-dark-500">Carregando...</p>}

      <div className="flex items-center justify-center gap-2 mt-8">
        {slides.map((s, i) => (
          <button
            key={s.titulo}
            onClick={() => setSlideAtual(i)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              i === slideAtual ? 'bg-gold-400 text-dark-950 font-semibold' : 'bg-dark-700 text-dark-400'
            }`}
          >
            {s.titulo}
          </button>
        ))}
      </div>
    </div>
  )
}
