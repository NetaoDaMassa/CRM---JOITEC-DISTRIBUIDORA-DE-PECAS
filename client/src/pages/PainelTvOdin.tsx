import { memo, useEffect, useState } from 'react'
import { Settings, MapPin, UserPlus } from 'lucide-react'
import { FunnelChart, Funnel, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts'
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

// Gradiente de 4 cores pro funil — azul/âmbar/verde já validados contra a
// superfície escura dos cards em PainelTV.tsx; roxo (Pedidos) fecha o
// degradê entre âmbar e verde sem colidir com nenhum dos dois. Verde
// continua reservado pra etapa final (mesmo sentido de "sucesso" que o
// resto do sistema usa).
const COR_TOPO = '#3987e5'
const COR_PROPOSTAS = '#c2691a'
const COR_PEDIDOS = '#8b6fd1'
const COR_VENDAS = '#0ca30c'

const SEGUNDOS_PADRAO = 25

function TooltipFunil({ active, payload }: { active?: boolean; payload?: { payload: { nome: string; valor: number } }[] }) {
  if (!active || !payload?.length) return null
  const { nome, valor } = payload[0].payload
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-dark-100 font-medium">{nome}</p>
      <p className="text-dark-400">{valor}</p>
    </div>
  )
}

// Rótulo dentro de cada trapézio — desenhado via função customizada no
// próprio prop `label` do <Funnel> (não como <LabelList> filho: no recharts
// 3 instalado aqui isso quebra a renderização inteira do gráfico, mesmo bug
// já documentado/contornado pro <Bar> em PainelTV.tsx — mesma solução).
function RotuloFunil(props: any) {
  const { x, y, width, height, value, name } = props
  if (x == null || y == null || width == null || height == null) return null
  return (
    <text x={x + width / 2} y={y + height / 2} dy={4} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>
      {`${name} · ${value}`}
    </text>
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

// Faixa de conversão entre duas etapas — fica fora do SVG do funil de
// propósito (texto simples em HTML), pra não depender de posicionamento
// manual de rótulo dentro do gráfico.
function FaixaConversao({ de, para, percentual }: { de: string; para: string; percentual: number | null }) {
  return (
    <div className="flex items-center justify-between text-xs px-1">
      <span className="text-dark-500">
        {de} → {para}
      </span>
      <span className="font-mono font-bold text-gold-400">{percentual != null ? `${formatarPercentual(percentual)}%` : '—'}</span>
    </div>
  )
}

function Funil({
  icone,
  titulo,
  subtitulo,
  etapas,
  conversoes,
}: {
  icone: React.ReactNode
  titulo: string
  subtitulo: string
  etapas: { nome: string; valor: number }[]
  conversoes: { de: string; para: string; percentual: number | null }[]
}) {
  const cores = [COR_TOPO, COR_PROPOSTAS, COR_PEDIDOS, COR_VENDAS]
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-3">
        {icone}
        <div>
          <h2 className="text-base font-semibold text-dark-100">{titulo}</h2>
          <p className="text-xs text-dark-500">{subtitulo}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <FunnelChart>
          <Tooltip content={<TooltipFunil />} />
          <Funnel dataKey="valor" data={etapas} isAnimationActive={false} label={RotuloFunil} stroke="#111e2d" strokeWidth={2}>
            {etapas.map((e, i) => (
              <Cell key={e.nome} fill={cores[i]} />
            ))}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2 pt-3 border-t border-dark-700/60">
        {conversoes.map((c) => (
          <FaixaConversao key={c.de} {...c} />
        ))}
      </div>
    </div>
  )
}

const SlideVisaoGeral = memo(function SlideVisaoGeral({ data }: { data: PainelData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <TileGeral titulo="Leads no mês" valor={data.geral.leads} cor={COR_TOPO} />
        <TileGeral titulo="Propostas geradas" valor={data.geral.propostas} cor={COR_PROPOSTAS} />
        <TileGeral titulo="Pedidos" valor={data.geral.pedidos} cor={COR_PEDIDOS} />
        <TileGeral titulo="Vendas fechadas" valor={data.geral.vendas} cor={COR_VENDAS} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Funil
          icone={<MapPin size={20} className="text-dark-400" />}
          titulo="Equipe de Campo"
          subtitulo="Visita → Proposta → Pedido → Venda"
          etapas={[
            { nome: 'Visitas', valor: data.equipeCampo.totais.visitas },
            { nome: 'Propostas', valor: data.equipeCampo.totais.propostas },
            { nome: 'Pedidos', valor: data.equipeCampo.totais.pedidos },
            { nome: 'Vendas', valor: data.equipeCampo.totais.vendas },
          ]}
          conversoes={[
            { de: 'Visita', para: 'Proposta', percentual: data.equipeCampo.totais.conversaoVisitaProposta },
            { de: 'Proposta', para: 'Pedido', percentual: data.equipeCampo.totais.conversaoPropostaPedido },
            { de: 'Pedido', para: 'Venda', percentual: data.equipeCampo.totais.conversaoPedidoVenda },
          ]}
        />
        <Funil
          icone={<UserPlus size={20} className="text-dark-400" />}
          titulo="Equipe de Leads"
          subtitulo="Lead do site → Proposta → Pedido → Venda"
          etapas={[
            { nome: 'Leads', valor: data.equipeLeads.totais.leads },
            { nome: 'Propostas', valor: data.equipeLeads.totais.propostas },
            { nome: 'Pedidos', valor: data.equipeLeads.totais.pedidos },
            { nome: 'Vendas', valor: data.equipeLeads.totais.vendas },
          ]}
          conversoes={[
            {
              de: 'Lead',
              para: 'Proposta',
              percentual: data.equipeLeads.totais.leads ? Math.round((data.equipeLeads.totais.propostas / data.equipeLeads.totais.leads) * 1000) / 10 : null,
            },
            { de: 'Proposta', para: 'Pedido', percentual: data.equipeLeads.totais.conversaoPropostaPedido },
            { de: 'Pedido', para: 'Venda', percentual: data.equipeLeads.totais.conversaoPedidoVenda },
          ]}
        />
      </div>
      <p className="text-center text-xs text-dark-500">Mês corrente · atualiza automaticamente</p>
    </div>
  )
})

function TileGeral({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5" style={{ borderLeft: `4px solid ${cor}` }}>
      <p className="text-xs text-dark-400 uppercase tracking-wide font-semibold">{titulo}</p>
      <p className="text-4xl font-bold text-dark-50 mt-1 font-mono tabular-nums">{valor}</p>
    </div>
  )
}

// Ranking por vendedor de uma equipe — barra de vendas (mesmo padrão já
// usado no resto do sistema pra ranking) mais o detalhe do funil de cada
// um (visitas/leads → propostas → pedidos → vendas) na lista abaixo.
function SlideEquipe({ equipe, tituloTopo, campoTopo }: { equipe: Equipe; tituloTopo: string; campoTopo: 'visitas' | 'leads' }) {
  const porVendedor = equipe.porVendedor

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-6">
      {!porVendedor.length && <p className="text-sm text-dark-500">Ninguém registrou nada esse mês ainda.</p>}
      {!!porVendedor.length && (
        <ResponsiveContainer width="100%" height={porVendedor.length * 34 + 10}>
          <BarChart data={porVendedor.map((v) => ({ nome: v.nome, valor: v.vendas }))} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fill: '#c3c2b7', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Bar
              dataKey="valor"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              isAnimationActive={false}
              label={(props: any) => <LabelFimDaBarra {...props} />}
              fill={COR_VENDAS}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-[10px] text-dark-500 uppercase tracking-wide mt-1 mb-4">vendas fechadas no mês (barra) — funil completo de cada um abaixo</p>

      <div className="space-y-3">
        {porVendedor.map((v) => (
          <div key={v.id} className="flex items-center gap-3">
            <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} size="sm" />
            <span className="flex-1 font-medium text-dark-100 truncate">{v.nome}</span>
            <span className="text-xs text-dark-500 font-mono w-20 text-right">
              {tituloTopo} {campoTopo === 'visitas' ? v.visitas : v.leads}
            </span>
            <span className="text-xs text-dark-500 font-mono w-20 text-right">Propostas {v.propostas}</span>
            <span className="text-xs text-dark-500 font-mono w-18 text-right">Pedidos {v.pedidos}</span>
            <span className="text-xs text-dark-500 font-mono w-16 text-right">Vendas {v.vendas}</span>
            <span className="text-sm font-mono tabular-nums text-gold-400 w-14 text-right">
              {v.conversaoPedidoVenda != null ? `${formatarPercentual(v.conversaoPedidoVenda)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const SlideEquipeCampo = memo(function SlideEquipeCampo({ data }: { data: PainelData }) {
  return <SlideEquipe equipe={data.equipeCampo} tituloTopo="Visitas" campoTopo="visitas" />
})

const SlideEquipeLeads = memo(function SlideEquipeLeads({ data }: { data: PainelData }) {
  return <SlideEquipe equipe={data.equipeLeads} tituloTopo="Leads" campoTopo="leads" />
})

// Painel de TV específico da Odin Compressores — pedido do João: repensar
// como um comercial estratégico enxergaria a operação. Dois funis de 4
// etapas (campo x leads) porque são dois jeitos diferentes de gerar
// negócio, com gente diferente trabalhando cada um (ver users.canalVenda).
export default function PainelTvOdin() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // A permissão do menu (Permissões > Painel de TV Odin Compressores) não
  // tem mais trava de empresa, mas os dados por trás (dashboardOdin.ts)
  // continuam só existindo pra Odin Compressores — outra empresa com a
  // permissão concedida cai aqui e vê esse aviso em vez de "Carregando..."
  // pra sempre.
  const { data, isError, error } = trpc.dashboardOdin.painelTv.useQuery(undefined, { refetchInterval: 30000, refetchIntervalInBackground: true, retry: false })

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

      {isError ? (
        <p className="text-dark-500">{error?.message ?? 'Módulo indisponível pra esta empresa.'}</p>
      ) : data ? (
        <Slide data={data} />
      ) : (
        <p className="text-dark-500">Carregando...</p>
      )}

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
