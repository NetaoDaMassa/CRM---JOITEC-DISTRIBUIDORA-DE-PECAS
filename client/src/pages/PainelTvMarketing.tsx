import { memo, useEffect, useRef, useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { formatElapsed, formatarPercentual } from '../lib/utils'
import { formatarMoeda } from '../lib/moeda'
import AvatarMeta from '../components/ui/AvatarMeta'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PainelData = RouterOutputs['painelMarketing']['resumo']

// Painel de TV só de Marketing/Leads, pensado pro telão de 75" — tela única
// (sem carrossel), ocupa 100% da altura sem rolagem, tamanhos em vh pra
// escalar com a resolução da TV. Mesma paleta validada do PainelTV.tsx
// (azul = magnitude, âmbar = contatos, verde só pra meta batida, vermelho
// pra atraso) — status nunca só pela cor, sempre com texto/emoji junto.
const COR_LEADS = '#3987e5'
const COR_CONTATOS = '#c2691a'
const COR_OK = '#0ca30c'
const COR_RUIM = '#dc4444'

function formatarMinutos(min: number): string {
  if (!min) return '—'
  if (min < 60) return `${Math.round(min)}min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

// Número que "sobe" até o valor novo quando o dado muda — dá a sensação de
// painel vivo na TV sem precisar de nenhuma interação.
function useContador(alvo: number, duracaoMs = 900): number {
  const [valor, setValor] = useState(alvo)
  const anterior = useRef(alvo)
  useEffect(() => {
    const de = anterior.current
    anterior.current = alvo
    if (de === alvo) return
    const inicio = performance.now()
    let raf = 0
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracaoMs)
      setValor(de + (alvo - de) * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo, duracaoMs])
  return valor
}

// Tudo na tela é em vh, mas o recharts e o AvatarMeta usam px fixo — essa
// escala (1 = tela de 1080px de altura) acompanha a resolução da TV (4K etc).
function useEscala(): number {
  const [escala, setEscala] = useState(() => window.innerHeight / 1080)
  useEffect(() => {
    const atualizar = () => setEscala(window.innerHeight / 1080)
    window.addEventListener('resize', atualizar)
    return () => window.removeEventListener('resize', atualizar)
  }, [])
  return escala
}

function Card({ titulo, children, className = '', cor }: { titulo?: string; children: React.ReactNode; className?: string; cor?: string }) {
  return (
    <div
      className={`bg-dark-800 border border-dark-600 rounded-[1.4vh] p-[1.8vh] flex flex-col min-h-0 overflow-hidden ${className}`}
      style={cor ? { borderLeft: `0.45vh solid ${cor}` } : undefined}
    >
      {titulo && <h2 className="text-[1.9vh] font-semibold text-gold-400 mb-[1.2vh] uppercase tracking-wide">{titulo}</h2>}
      {children}
    </div>
  )
}

function Kpi({
  titulo,
  valor,
  formatar = (v) => String(Math.round(v)),
  sub,
  cor,
  alerta,
}: {
  titulo: string
  valor: number
  formatar?: (v: number) => string
  sub?: string
  cor: string
  alerta?: boolean
}) {
  const animado = useContador(valor)
  return (
    <div
      className={`bg-dark-800 border rounded-[1.4vh] px-[2vh] py-[1.6vh] flex flex-col justify-between ${
        alerta ? 'border-red-500/60 animate-pulse' : 'border-dark-600'
      }`}
      style={{ borderTop: `0.5vh solid ${cor}` }}
    >
      <p className="text-[1.7vh] text-dark-300 uppercase tracking-wide font-semibold">{titulo}</p>
      <p className="text-[7.5vh] leading-none font-bold font-mono tabular-nums mt-[0.8vh]" style={{ color: alerta ? COR_RUIM : undefined }}>
        {formatar(animado)}
      </p>
      {sub && <p className="text-[1.5vh] text-dark-400 mt-[0.8vh]">{sub}</p>}
    </div>
  )
}

// Anel de progresso da meta. `maiorMelhor=false` (atendimento rápido): bate
// a meta quando o atual fica ABAIXO dela.
function AnelMeta({
  titulo,
  atual,
  meta,
  formatar,
  maiorMelhor = true,
  ritmoEsperado,
}: {
  titulo: string
  atual: number
  meta: number | null
  formatar: (v: number) => string
  maiorMelhor?: boolean
  ritmoEsperado?: number
}) {
  const tamanho = 100
  const raio = 42
  const circ = 2 * Math.PI * raio
  const temMeta = meta != null && meta > 0
  const bateu = temMeta && (maiorMelhor ? atual >= meta! : atual > 0 && atual <= meta!)
  const pct = !temMeta ? 0 : maiorMelhor ? atual / meta! : atual > 0 ? meta! / atual : 0
  const progresso = useContador(Math.min(1, pct))
  // Só "Leads no mês" tem ritmo (meta proporcional aos dias que já
  // passaram) — conversão e atendimento é bateu ou não bateu.
  const noRitmo = ritmoEsperado != null && atual >= ritmoEsperado
  const cor = !temMeta ? '#4a5768' : bateu ? COR_OK : noRitmo ? COR_LEADS : COR_CONTATOS

  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <div className="relative w-[15vh] h-[15vh]">
        <svg viewBox={`0 0 ${tamanho} ${tamanho}`} className="w-full h-full -rotate-90">
          <circle cx={50} cy={50} r={raio} fill="none" stroke="#1f2b3a" strokeWidth={9} />
          <circle
            cx={50}
            cy={50}
            r={raio}
            fill="none"
            stroke={cor}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progresso)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[3.2vh] font-bold font-mono tabular-nums leading-none">{formatar(atual)}</span>
          {temMeta && <span className="text-[1.5vh] text-dark-400 mt-[0.5vh]">meta {formatar(meta!)}</span>}
        </div>
      </div>
      <p className="text-[1.8vh] font-semibold text-dark-100 mt-[0.8vh]">{titulo}</p>
      <p className="text-[1.5vh] mt-[0.3vh]" style={{ color: cor }}>
        {!temMeta ? 'meta não definida' : bateu ? '🎯 meta batida' : noRitmo ? '✅ no ritmo' : ritmoEsperado != null ? '⚠️ abaixo do ritmo' : '⚠️ abaixo da meta'}
      </p>
    </div>
  )
}

const BlocoMetas = memo(function BlocoMetas({ data }: { data: PainelData }) {
  return (
    <Card titulo="🎯 Metas de marketing do mês" cor={COR_OK} className="col-span-5">
      <div className="flex-1 grid grid-cols-3 items-center gap-[2vh]">
        <AnelMeta
          titulo="Clientes ganhos"
          atual={data.mes.totalGanhos}
          meta={data.metas.clientesGanhos}
          formatar={(v) => String(Math.round(v))}
          ritmoEsperado={data.metas.ritmoClientesGanhos ?? undefined}
        />
        <AnelMeta
          titulo="Taxa de conversão"
          atual={data.mes.taxaConversaoPct}
          meta={data.metas.taxaConversaoPct}
          formatar={(v) => `${formatarPercentual(v)}%`}
        />
        <AnelMeta
          titulo="Atendimento rápido"
          atual={data.mes.primeiraRespostaHoras * 60}
          meta={data.metas.atendimentoRapidoHoras != null ? data.metas.atendimentoRapidoHoras * 60 : null}
          formatar={formatarMinutos}
          maiorMelhor={false}
        />
      </div>
    </Card>
  )
})

// Trocou o gráfico de "Leads por dia" (pedido do João, 2026-10-19): o que
// importa no telão é quanto tem na mesa agora, não o histórico de entrada.
const BlocoNegociacao = memo(function BlocoNegociacao({ data }: { data: PainelData }) {
  const n = data.emNegociacao
  const valorAnimado = useContador(n.valor)
  return (
    <Card titulo="🤝 Em negociação agora" cor={COR_CONTATOS} className="col-span-4">
      <div className="flex items-end gap-[3vh] shrink-0">
        <div>
          <p className="text-[6vh] leading-none font-bold font-mono tabular-nums">{n.quantidade}</p>
          <p className="text-[1.6vh] text-dark-400 mt-[0.4vh]">lead{n.quantidade !== 1 ? 's' : ''}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[4.4vh] leading-none font-bold font-mono tabular-nums truncate" style={{ color: COR_CONTATOS }}>
            {formatarMoeda(valorAnimado, { casas: 0 })}
          </p>
          <p className="text-[1.6vh] text-dark-400 mt-[0.4vh]">
            em orçamentos{n.semValor > 0 ? ` · ${n.semValor} sem valor informado` : ''}
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden mt-[1.4vh] pt-[1vh] border-t border-dark-700/60 flex flex-col justify-around">
        {!n.quantidade && <p className="text-[1.8vh] text-dark-500">Nenhum lead em negociação no momento.</p>}
        {n.maiores.slice(0, 3).map((l) => (
          <div key={l.id} className="flex items-center gap-[1vh]">
            <span className="flex-1 min-w-0 text-[1.9vh] text-dark-100 truncate">
              {l.nome}
              <span className="text-dark-400">{l.vendedor ? ` · ${l.vendedor}` : ' · sem vendedor'}</span>
            </span>
            <span className="text-[1.5vh] text-dark-400 font-mono shrink-0">há {formatElapsed(l.desde)}</span>
            <span className="w-[14vh] text-right text-[2vh] font-bold font-mono tabular-nums shrink-0">
              {l.valor ? formatarMoeda(l.valor, { casas: 0 }) : '—'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
})

const BlocoFunil = memo(function BlocoFunil({ data }: { data: PainelData }) {
  const maior = Math.max(1, ...data.funil.map((f) => f.qtd))
  return (
    <Card titulo="🔻 Funil de vendas (mês)" cor={COR_LEADS} className="col-span-3">
      <div className="flex-1 flex flex-col justify-around">
        {data.funil.map((f, i) => {
          const ganho = f.etapa === 'Ganho'
          return (
            <div key={f.etapa} className="flex items-center gap-[1.2vh]">
              <div className="flex-1 flex justify-center">
                <div
                  className="h-[4.2vh] rounded-[0.8vh] flex items-center justify-between px-[1.4vh] transition-all duration-700"
                  style={{
                    width: `${Math.max(55, (f.qtd / maior) * 100)}%`,
                    background: ganho ? COR_OK : COR_LEADS,
                    opacity: ganho ? 1 : 1 - i * 0.13,
                  }}
                >
                  <span className="text-[1.8vh] font-semibold text-white truncate">{f.etapa}</span>
                  <span className="text-[2.6vh] font-bold font-mono tabular-nums text-white">{f.qtd}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
})

const BlocoRanking = memo(function BlocoRanking({ data, metaMin }: { data: PainelData; metaMin: number | null }) {
  const lista = data.rankingResposta.slice(0, 5)
  const maior = Math.max(1, ...lista.map((v) => v.mediaMinutos))
  const escala = useEscala()
  return (
    <Card titulo="⚡ Ranking de resposta — vendedores (mês)" cor={COR_CONTATOS} className="col-span-5">
      {!lista.length && <p className="text-[1.8vh] text-dark-500">Nenhum lead do mês com 1º contato confirmado ainda.</p>}
      <div className="flex-1 flex flex-col justify-around min-h-0 overflow-hidden">
        {lista.map((v, i) => {
          const dentroMeta = metaMin != null && v.mediaMinutos <= metaMin
          const cor = metaMin == null ? COR_CONTATOS : dentroMeta ? COR_OK : COR_CONTATOS
          return (
            <div key={v.id} className="flex items-center gap-[1.2vh]">
              <span className="w-[3.5vh] text-[2vh] font-mono text-dark-400">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`}</span>
              <div style={{ zoom: escala * 1.2 }}>
                <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} size="sm" />
              </div>
              <span className="w-[16vh] text-[2vh] font-medium text-dark-100 truncate">{v.nome.split(' ')[0]}</span>
              <div className="flex-1 h-[2.2vh] bg-dark-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(4, (v.mediaMinutos / maior) * 100)}%`, background: cor }}
                />
              </div>
              <span className="w-[10vh] text-right text-[2.2vh] font-bold font-mono tabular-nums">{formatarMinutos(v.mediaMinutos)}</span>
              <span className="w-[3vh] text-[1.8vh]">{metaMin != null ? (dentroMeta ? '✅' : '⏳') : ''}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
})

const CORES_ORIGEM = ['#3987e5', '#c2691a', '#0ca30c', '#a35fd6', '#d9488f', '#2bb3a6', '#7a8696', '#5a6676']

const BlocoOrigem = memo(function BlocoOrigem({ data }: { data: PainelData }) {
  const total = data.porOrigem.reduce((s, o) => s + o.qtd, 0)
  return (
    <Card titulo="📣 De onde vêm os leads (mês)" cor={COR_LEADS} className="col-span-4">
      {!total && <p className="text-[1.8vh] text-dark-500">Nenhum lead no mês ainda.</p>}
      {!!total && (
        <>
          <div className="flex h-[3.2vh] rounded-full overflow-hidden mb-[1.6vh]">
            {data.porOrigem.map((o, i) => (
              <div key={o.canal} style={{ width: `${(o.qtd / total) * 100}%`, background: CORES_ORIGEM[i % CORES_ORIGEM.length] }} />
            ))}
          </div>
          <div className="flex-1 grid grid-cols-2 gap-x-[2vh] content-start gap-y-[1.2vh]">
            {data.porOrigem.slice(0, 8).map((o, i) => (
              <div key={o.canal} className="flex items-center gap-[1vh]">
                <span className="w-[1.6vh] h-[1.6vh] rounded-sm shrink-0" style={{ background: CORES_ORIGEM[i % CORES_ORIGEM.length] }} />
                <span className="flex-1 text-[2vh] text-dark-100 truncate">{o.canal}</span>
                <span className="text-[2.2vh] font-bold font-mono tabular-nums">{o.qtd}</span>
                <span className="w-[6vh] text-right text-[1.6vh] text-dark-400 font-mono">{Math.round((o.qtd / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
})

const BlocoUltimosLeads = memo(function BlocoUltimosLeads({ data, destaqueId }: { data: PainelData; destaqueId: number | null }) {
  return (
    <Card titulo="🔔 Últimos leads" cor={COR_CONTATOS} className="col-span-3">
      <div className="flex-1 flex flex-col justify-around min-h-0 overflow-hidden">
        {data.ultimosLeads.slice(0, 3).map((l) => (
          <div
            key={l.id}
            className={`flex items-center gap-[1vh] rounded-[0.8vh] px-[1vh] py-[0.6vh] transition-colors duration-1000 ${
              l.id === destaqueId ? 'bg-gold-400/20' : ''
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[2vh] font-medium text-dark-100 truncate">
                {l.nome}
                {l.cidade && <span className="text-dark-400 font-normal"> · {l.cidade}</span>}
              </p>
              <p className="text-[1.5vh] text-dark-400 truncate">
                {l.canal}
                {l.vendedor ? ` → ${l.vendedor}` : ' · sem vendedor'}
              </p>
            </div>
            <span className="text-[1.5vh] text-dark-400 font-mono shrink-0">há {formatElapsed(l.criadoEm)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
})

// Conteúdo do painel (KPIs + blocos) sem o cabeçalho/relógio — usado na
// página própria (/painel-tv-marketing) e também como slide "Marketing" do
// carrossel do Painel de TV geral (PainelTV.tsx), no lugar do antigo
// "Leads aguardando" (pedido do João, 2026-10-19). Preenche a altura do
// container pai (flex-1).
export function PainelMarketingConteudo() {
  // `refetchIntervalInBackground: true` — TV fica sem mouse/teclado, a aba
  // nunca ganha foco (mesmo motivo do PainelTV.tsx).
  const { data, isError, error } = trpc.painelMarketing.resumo.useQuery(undefined, {
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    retry: false,
  })

  // Lead novo chegou desde a última atualização → faixa de aviso por alguns
  // segundos + destaque na lista de "Últimos leads".
  const ultimoIdVisto = useRef<number | null>(null)
  const [novoLead, setNovoLead] = useState<PainelData['ultimosLeads'][number] | null>(null)
  useEffect(() => {
    const primeiro = data?.ultimosLeads[0]
    if (!primeiro) return
    if (ultimoIdVisto.current != null && primeiro.id > ultimoIdVisto.current) {
      setNovoLead(primeiro)
      const t = setTimeout(() => setNovoLead(null), 12000)
      ultimoIdVisto.current = primeiro.id
      return () => clearTimeout(t)
    }
    ultimoIdVisto.current = primeiro.id
  }, [data?.ultimosLeads])

  const metaMin = data?.metas.atendimentoRapidoHoras != null ? data.metas.atendimentoRapidoHoras * 60 : null

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-[1.8vh]">
      {novoLead && (
        <div className="shrink-0 rounded-[1.4vh] bg-gold-400 text-dark-950 px-[2.4vh] py-[1.4vh] flex items-center gap-[1.6vh] animate-bounce">
          <span className="text-[3.4vh]">🔔</span>
          <span className="text-[2.8vh] font-bold">Novo lead chegou!</span>
          <span className="text-[2.4vh]">
            {novoLead.nome}
            {novoLead.cidade ? ` · ${novoLead.cidade}` : ''} · {novoLead.canal}
            {novoLead.vendedor ? ` → ${novoLead.vendedor}` : ''}
          </span>
        </div>
      )}

      {isError && <p className="text-red-400 text-[2vh]">{error.message}</p>}
      {!data && !isError && <p className="text-dark-500 text-[2vh]">Carregando...</p>}

      {data && (
        <>
          <div className="grid grid-cols-5 gap-[1.8vh] shrink-0">
            <Kpi titulo="Leads hoje" valor={data.hoje.leadsNovos} cor={COR_LEADS} sub={`${data.mes.totalLeads} no mês`} />
            <Kpi
              titulo="Leads em atraso"
              valor={data.hoje.emAtraso}
              cor={COR_RUIM}
              alerta={data.hoje.emAtraso > 0}
              sub={data.hoje.emAtraso > 0 ? '⚠️ próximo contato vencido' : '✅ ninguém atrasado'}
            />
            <Kpi titulo="Pra chamar hoje" valor={data.hoje.praChamarHoje} cor={COR_CONTATOS} sub={`${data.hoje.aguardandoPrimeiroContato} aguardando 1º contato`} />
            <Kpi titulo="Contatados hoje" valor={data.hoje.contatados} cor={COR_OK} sub="leads com contato registrado" />
            <Kpi
              titulo="1ª resposta (média)"
              valor={data.mes.primeiraRespostaHoras * 60}
              formatar={formatarMinutos}
              cor={metaMin != null && data.mes.primeiraRespostaHoras * 60 > metaMin ? COR_CONTATOS : COR_OK}
              sub={metaMin != null ? `meta até ${formatarMinutos(metaMin)} · horas úteis` : 'horas úteis · mês'}
            />
          </div>

          <div className="grid grid-cols-12 gap-[1.8vh] flex-1 min-h-0">
            <BlocoMetas data={data} />
            <BlocoNegociacao data={data} />
            <BlocoFunil data={data} />
          </div>

          <div className="grid grid-cols-12 gap-[1.8vh] flex-1 min-h-0">
            <BlocoRanking data={data} metaMin={metaMin} />
            <BlocoOrigem data={data} />
            <BlocoUltimosLeads data={data} destaqueId={novoLead?.id ?? null} />
          </div>
        </>
      )}
    </div>
  )
}

export default function PainelTvMarketing() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Mesma query do conteúdo (react-query reaproveita) — só pro nome da empresa no título.
  const { data } = trpc.painelMarketing.resumo.useQuery(undefined, { refetchInterval: 15000, refetchIntervalInBackground: true, retry: false })

  return (
    <div className="h-screen overflow-hidden bg-dark-950 text-dark-50 p-[2.4vh] flex flex-col gap-[1.8vh]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[1.6vh]">
          <h1 className="font-heading text-[3.6vh] text-gold-400 font-bold leading-none">
            Marketing{data?.empresaNome ? ` · ${data.empresaNome}` : ''}
          </h1>
          <span className="flex items-center gap-[0.8vh] text-[1.6vh] text-green-400 bg-green-900/25 px-[1.2vh] py-[0.5vh] rounded-full">
            <span className="w-[1vh] h-[1vh] rounded-full bg-green-400 animate-pulse" />
            ao vivo
          </span>
        </div>
        <div className="text-right">
          <p className="text-[3.4vh] font-mono leading-none">{relogio.toLocaleTimeString('pt-BR')}</p>
          <p className="text-[1.7vh] text-dark-400 mt-[0.4vh]">
            {relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
      </div>

      <PainelMarketingConteudo />
    </div>
  )
}
