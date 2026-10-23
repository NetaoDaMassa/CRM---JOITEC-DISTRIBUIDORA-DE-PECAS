import { memo, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { formatarMoeda as formatarMoedaBr } from '../lib/moeda'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/router/index'
import { trpc } from '../lib/trpc'
import { formatElapsed, formatarPercentual } from '../lib/utils'
import AvatarMeta from '../components/ui/AvatarMeta'
import { useCelebrarMeta } from '../lib/useCelebrarMeta'
import CelebracaoPopup from '../components/ui/CelebracaoPopup'
import PainelConfigModal from '../components/PainelConfigModal'
import { PainelMarketingConteudo } from './PainelTvMarketing'
import { BarraLinha, Card, Kpi, Linhas, NomeVendedor, Posicao, Selo, useEscala } from '../components/painelTv/BlocosTv'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PainelData = RouterOutputs['painel']['resumo']

// Formato telão (75", 16:9) — cada slide ocupa 100% da altura sem rolagem
// (antes o conteúdo passava da dobra e dependia do useAutoScroll), e tudo é
// em vh pra escalar com a resolução da TV (Full HD ou 4K), igual ao
// PainelTvMarketing. Gráfico de barras + tabela repetiam o mesmo número em
// dois lugares — agora é uma linha só por vendedor, com a barra embutida.
//
// Cores validadas (script do skill de dataviz) contra a superfície escura real
// dos cards (#111e2d): azul neutro pra magnitude (vendas), âmbar pra
// contatos/ligações e verde "good" só quando bate a meta (cor de status,
// nunca usada como identidade de série). Âmbar vs verde é praticamente
// idêntico pra daltonismo vermelho-verde — por isso status nunca vai só na
// cor: sempre tem número e emoji (🎯/🎉) junto.
const COR_VENDAS = '#3987e5'
const COR_CONTATOS = '#c2691a'
const COR_META_BATIDA = '#0ca30c'
const COR_RUIM = '#dc4444'

const SEGUNDOS_POR_SLIDE = 30
// Orçamentos em aberto pode ter dezenas de linhas — na TV não tem rolagem,
// então mostra os primeiros e resume o resto numa linha "+N".
const MAX_LINHAS_ORCAMENTOS = 12

function formatarMoeda(v: number): string {
  return formatarMoedaBr(v, { casas: 0 })
}

// Faturamento total da empresa / R$ por vendedor não podem aparecer no painel
// de TV (fica visível pra qualquer um que passar perto — pedido do João,
// 2026-09-11) — só % da meta, quantidade e ticket médio.
const SlideVisaoGeral = memo(function SlideVisaoGeral({ data }: { data: PainelData }) {
  const meta = data.metaEmpresa
  // A API devolve `vendedores` ordenado por R$ (pro Dashboard do admin) —
  // reordena por % porque cada um tem uma meta diferente.
  const porPercentual = [...data.vendedores].sort((a, b) => b.percentualMetaFaturamento - a.percentualMetaFaturamento)
  const noRitmo = data.vendedores.filter((v) => v.bateuMetaDia).length

  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <div className="col-span-4 flex flex-col gap-[2vh] min-h-0">
        {meta && (
          <Card titulo="🏢 Meta do mês" cor={meta.bateuMetaFaturamento ? COR_META_BATIDA : COR_VENDAS} className="flex-[1.4]">
            <div className="flex-1 flex flex-col justify-center">
              <p className="text-[13vh] leading-none font-bold font-mono tabular-nums text-dark-50">
                {formatarPercentual(meta.percentualMetaFaturamento)}%
              </p>
              <p className="text-[2.2vh] text-dark-400 mt-[1vh]">da meta da empresa {meta.bateuMetaFaturamento ? '🎉' : ''}</p>
              <div className="h-[2.2vh] bg-dark-900 rounded-full mt-[2.4vh] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, meta.percentualMetaFaturamento)}%`,
                    background: meta.bateuMetaFaturamento ? COR_META_BATIDA : COR_VENDAS,
                  }}
                />
              </div>
              <div className="mt-[2.4vh] flex flex-wrap gap-[1vh]">
                <Selo tom={meta.bateuMetaDia ? 'verde' : 'vermelho'}>
                  Ritmo do dia {formatarPercentual(meta.percentualMetaDia)}% {meta.bateuMetaDia ? '✅' : '❌'}
                </Selo>
              </div>
            </div>
          </Card>
        )}
        <div className="grid grid-cols-2 gap-[2vh] flex-1 min-h-0">
          <Kpi titulo="Vendas hoje" valor={data.vendasHoje.quantidade} sub="fechadas" cor={COR_VENDAS} />
          <Kpi titulo="Vendas no mês" valor={data.vendasMes.quantidade} sub="fechadas" cor={COR_VENDAS} />
        </div>
      </div>

      <Card
        titulo="🏆 Ranking do mês · % da meta"
        cor={COR_VENDAS}
        className="col-span-8"
        extra={
          <Selo tom="verde">
            🎯 {noRitmo} de {data.vendedores.length} no ritmo hoje
          </Selo>
        }
      >
        <div className="flex items-center gap-[1.4vh] text-[1.6vh] text-dark-400 uppercase tracking-wide pb-[0.8vh] border-b border-dark-600 shrink-0">
          <span className="flex-1">Vendedor</span>
          <span className="w-[9vh] text-right">Qtde</span>
          <span className="w-[16vh] text-right">Ticket médio</span>
          <span className="w-[34%] text-right">% da meta</span>
        </div>
        <Linhas
          itens={porPercentual}
          chave={(v) => v.id}
          render={(v, i, fonteVh) => (
            <>
              <Posicao i={i} />
              <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaFaturamento} festa={v.bateuMetaDia} tamanho={`${fonteVh * 1.9}vh`} />
              <div className="flex-1 min-w-0 flex items-center gap-[0.8vh]">
                <NomeVendedor nome={v.nome} fonteVh={fonteVh} />
                {v.sequenciaDiasVendendo >= 2 && (
                  <span className="text-[0.75em] font-bold text-amber-400 bg-amber-900/25 px-[0.5em] py-[0.1em] rounded-full shrink-0">
                    🔥{v.sequenciaDiasVendendo}
                  </span>
                )}
                {v.bateuMetaDia && <span title="No ritmo da meta do dia">🎯</span>}
                {v.bateuMetaFaturamento && <span>🎉</span>}
              </div>
              <span className="w-[9vh] text-right font-mono tabular-nums text-dark-300">{v.qtdVendasMes}</span>
              <span className="w-[16vh] text-right font-mono tabular-nums text-dark-300">{formatarMoeda(v.ticketMedioMes)}</span>
              <div className="w-[34%] flex">
                <BarraLinha
                  percentual={v.percentualMetaFaturamento}
                  cor={v.bateuMetaFaturamento ? COR_META_BATIDA : COR_VENDAS}
                  rotulo={`${formatarPercentual(v.percentualMetaFaturamento)}%`}
                />
              </div>
            </>
          )}
        />
      </Card>
    </div>
  )
})

// Ranking mensal reseta devagar — o da semana dá uma disputa nova a cada
// poucos dias. Sem meta semanal cadastrada (só mensal) e sem poder mostrar R$,
// compara relativo ao líder: "X% do líder da semana" (preserva a ordem por R$).
const SlideRankingSemanal = memo(function SlideRankingSemanal({ data }: { data: PainelData }) {
  const semanal = data.rankingSemanal
  const lider = semanal[0]
  const liderValor = lider?.valorFechadoSemana ?? 0
  const maiorEvolucao = data.rankingEvolucao[0]
  const percentualDoLider = (v: number) => (liderValor > 0 ? (v / liderValor) * 100 : 0)
  // Sem semana passada pra comparar (valor 0) não dá pra calcular crescimento.
  const evolucaoPercentual =
    maiorEvolucao && maiorEvolucao.valorFechadoSemanaPassada > 0
      ? ((maiorEvolucao.valorFechadoSemana - maiorEvolucao.valorFechadoSemanaPassada) / maiorEvolucao.valorFechadoSemanaPassada) * 100
      : null

  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <Card titulo="📅 Ranking da semana · segunda a hoje" cor={COR_VENDAS} className="col-span-8">
        {!semanal.length && <p className="text-[2.2vh] text-dark-500">Ninguém vendeu ainda essa semana.</p>}
        <Linhas
          itens={semanal}
          chave={(v) => v.id}
          render={(v, i, fonteVh) => (
            <>
              <Posicao i={i} />
              <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={i === 0 && v.valorFechadoSemana > 0} festa={v.bateuMetaDia} tamanho={`${fonteVh * 1.9}vh`} />
              <div className="flex items-center gap-[0.8vh] shrink-0">
                <NomeVendedor nome={v.nome} fonteVh={fonteVh} />
                {v.sequenciaDiasVendendo >= 2 && (
                  <span className="text-[0.75em] font-bold text-amber-400 bg-amber-900/25 px-[0.5em] py-[0.1em] rounded-full">🔥{v.sequenciaDiasVendendo}</span>
                )}
              </div>
              <BarraLinha
                percentual={percentualDoLider(v.valorFechadoSemana)}
                cor={liderValor > 0 && v.valorFechadoSemana === liderValor ? COR_META_BATIDA : COR_VENDAS}
                rotulo={`${formatarPercentual(percentualDoLider(v.valorFechadoSemana))}%`}
              />
            </>
          )}
        />
        <p className="text-[1.6vh] text-dark-500 mt-[1vh] shrink-0">% em relação ao líder da semana</p>
      </Card>

      <div className="col-span-4 flex flex-col gap-[2vh] min-h-0">
        <Card titulo="👑 Líder da semana" cor={COR_META_BATIDA} className="flex-1">
          {lider && liderValor > 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-[2vh]">
              <AvatarMeta nome={lider.nome} fotoUrl={lider.fotoUrl} destaque festa={lider.bateuMetaDia} tamanho="16vh" />
              <p className="text-[4.4vh] font-bold text-dark-50 text-center leading-tight">{lider.nome}</p>
            </div>
          ) : (
            <p className="text-[2.2vh] text-dark-500">Ainda sem vendas na semana.</p>
          )}
        </Card>
        <Card titulo="📈 Quem mais evoluiu" cor={COR_VENDAS} className="flex-1">
          {maiorEvolucao && maiorEvolucao.evolucaoSemana > 0 ? (
            <div className="flex-1 flex items-center gap-[2.4vh]">
              <AvatarMeta nome={maiorEvolucao.nome} fotoUrl={maiorEvolucao.fotoUrl} tamanho="11vh" />
              <div className="min-w-0">
                <p className="text-[3.6vh] font-bold text-dark-50 leading-tight truncate">{maiorEvolucao.nome}</p>
                {evolucaoPercentual != null && (
                  <p className="text-[5vh] font-bold font-mono tabular-nums text-green-400 leading-none mt-[1vh]">
                    +{formatarPercentual(evolucaoPercentual)}%
                  </p>
                )}
                <p className="text-[1.7vh] text-dark-400 mt-[0.8vh]">vs semana passada</p>
              </div>
            </div>
          ) : (
            <p className="text-[2.2vh] text-dark-500">Sem evolução pra destacar ainda.</p>
          )}
        </Card>
      </div>
    </div>
  )
})

const SlideLigacoes = memo(function SlideLigacoes({ data }: { data: PainelData }) {
  const lista = data.rankingLigacoes
  const tentativasHoje = lista.reduce((a, v) => a + v.ligacoesHoje, 0)
  const efetivasHoje = lista.reduce((a, v) => a + v.ligacoesEfetivasHoje, 0)
  const ligacoesMes = lista.reduce((a, v) => a + v.ligacoesMes, 0)
  const batendo = lista.filter((v) => v.bateuMetaLigacoes).length

  return (
    <div className="flex flex-col gap-[2vh] h-full">
      <div className="grid grid-cols-4 gap-[2vh] shrink-0 h-[15vh]">
        <Kpi titulo="Tentativas hoje" valor={tentativasHoje} cor={COR_CONTATOS} sub="todas as ligações do dia" />
        <Kpi
          titulo="Efetivas hoje"
          valor={efetivasHoje}
          cor={COR_CONTATOS}
          sub={tentativasHoje ? `${formatarPercentual((efetivasHoje / tentativasHoje) * 100)}% das tentativas` : 'nenhuma tentativa ainda'}
        />
        <Kpi titulo="Ligações no mês" valor={ligacoesMes} cor={COR_CONTATOS} sub="equipe toda" />
        <Kpi titulo="No ritmo da meta" valor={`${batendo}/${lista.length}`} cor={COR_META_BATIDA} sub="vendedores 🎉" />
      </div>

      <Card titulo="📞 Ranking de ligações · ritmo da meta do mês" cor={COR_CONTATOS} className="flex-1">
        <div className="flex items-center gap-[1.4vh] text-[1.6vh] text-dark-400 uppercase tracking-wide pb-[0.8vh] border-b border-dark-600 shrink-0">
          <span className="flex-1">Vendedor</span>
          <span className="w-[13vh] text-right">Tentat. hoje</span>
          <span className="w-[13vh] text-right">Efetivas hoje</span>
          <span className="w-[11vh] text-right">% efetiva</span>
          <span className="w-[16vh] text-right">Mês / meta</span>
          <span className="w-[30%] text-right">% da meta</span>
        </div>
        <Linhas
          itens={lista}
          chave={(v) => v.id}
          render={(v, i, fonteVh) => (
            <>
              <Posicao i={i} />
              <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} destaque={v.bateuMetaLigacoes} tamanho={`${fonteVh * 1.9}vh`} />
              <div className="flex-1 min-w-0 flex items-center gap-[0.8vh]">
                <NomeVendedor nome={v.nome} fonteVh={fonteVh} />
                {v.bateuMetaLigacoes && <span>🎉</span>}
              </div>
              <span className="w-[13vh] text-right font-mono tabular-nums text-dark-50 font-semibold">{v.ligacoesHoje}</span>
              <span className="w-[13vh] text-right font-mono tabular-nums text-dark-50 font-semibold">{v.ligacoesEfetivasHoje}</span>
              <span className="w-[11vh] text-right font-mono tabular-nums text-dark-300">{formatarPercentual(v.percentualEfetividadeHoje)}%</span>
              <span className="w-[16vh] text-right font-mono tabular-nums text-dark-400">
                {v.ligacoesMes} / {v.metaLigacoesAcumulada}
              </span>
              <div className="w-[30%] flex">
                <BarraLinha
                  percentual={v.percentualMetaLigacoes}
                  cor={v.bateuMetaLigacoes ? COR_META_BATIDA : COR_CONTATOS}
                  rotulo={`${formatarPercentual(v.percentualMetaLigacoes)}%`}
                />
              </div>
            </>
          )}
        />
      </Card>
    </div>
  )
})

// Fechados / (fechados + perdidos) — não fechados / total da carteira, que
// deixaria todo mundo com % minúsculo (a maioria dos leads ainda está em
// "Novo"). Só entra quem já decidiu pelo menos 1 negócio esse mês — sem isso,
// 1 venda solta vira "100%" e engana quem está vendo de longe.
const SlideConversao = memo(function SlideConversao({ data }: { data: PainelData }) {
  const conversao = data.rankingConversao
  const fechados = conversao.reduce((a, v) => a + v.qtdVendasMes, 0)
  const perdidos = conversao.reduce((a, v) => a + v.qtdPerdidosMes, 0)
  const taxaEquipe = fechados + perdidos > 0 ? (fechados / (fechados + perdidos)) * 100 : null

  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <Card titulo="🎯 Taxa de conversão do mês" cor={COR_META_BATIDA} className="col-span-8">
        {!conversao.length && <p className="text-[2.2vh] text-dark-500">Ninguém fechou ou perdeu negócio ainda esse mês.</p>}
        <Linhas
          itens={conversao}
          chave={(v) => v.id}
          render={(v, i, fonteVh) => (
            <>
              <Posicao i={i} />
              <AvatarMeta nome={v.nome} fotoUrl={v.fotoUrl} tamanho={`${fonteVh * 1.9}vh`} />
              <NomeVendedor nome={v.nome} fonteVh={fonteVh} />
              <span className="w-[10em] shrink-0 text-[0.8em] text-dark-400 font-mono">
                {v.qtdVendasMes}✔ · {v.qtdPerdidosMes}✖
              </span>
              <BarraLinha
                percentual={v.taxaConversao ?? 0}
                cor={(v.taxaConversao ?? 0) >= 50 ? COR_META_BATIDA : COR_VENDAS}
                rotulo={`${formatarPercentual(v.taxaConversao)}%`}
              />
            </>
          )}
        />
        <p className="text-[1.6vh] text-dark-500 mt-[1vh] shrink-0">
          Fechados ÷ (fechados + perdidos) · só quem já decidiu algum negócio esse mês · ✔ fechados ✖ perdidos
        </p>
      </Card>
      <div className="col-span-4 grid grid-rows-3 gap-[2vh] min-h-0">
        <Kpi
          titulo="Conversão da equipe"
          valor={taxaEquipe != null ? `${formatarPercentual(taxaEquipe)}%` : '—'}
          cor={taxaEquipe != null && taxaEquipe >= 50 ? COR_META_BATIDA : COR_VENDAS}
          sub="no mês"
        />
        <Kpi titulo="Negócios fechados" valor={fechados} cor={COR_META_BATIDA} sub="no mês" />
        <Kpi titulo="Negócios perdidos" valor={perdidos} cor={COR_RUIM} sub="no mês" />
      </div>
    </div>
  )
})

const GraficoHistorico = memo(function GraficoHistorico({
  data,
  chave,
  nome,
  cor,
  escala,
}: {
  data: PainelData['historico']
  chave: 'vendas' | 'contatos'
  nome: string
  cor: string
  escala: number
}) {
  const ultimo = data.length - 1
  const fonte = Math.round(17 * escala)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: Math.round(36 * escala), right: Math.round(28 * escala), bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${chave}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity={0.5} />
            <stop offset="100%" stopColor={cor} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3644" vertical={false} />
        <XAxis dataKey="dia" tick={{ fill: '#c3c2b7', fontSize: fonte }} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={{ fill: '#c3c2b7', fontSize: fonte }} tickLine={false} axisLine={false} width={Math.round(44 * escala)} allowDecimals={false} />
        <Area
          type="monotone"
          dataKey={chave}
          name={nome}
          stroke={cor}
          strokeWidth={Math.max(3, 4 * escala)}
          fill={`url(#grad-${chave})`}
          dot={{ r: 6 * escala, fill: cor, strokeWidth: 0 }}
          isAnimationActive={false}
          label={(props: any) =>
            props.index === ultimo && props.value != null ? (
              <text x={props.x} y={props.y - 16 * escala} textAnchor="middle" fill={cor} fontSize={Math.round(26 * escala)} fontWeight={700}>
                {props.value}
              </text>
            ) : null
          }
        />
      </AreaChart>
    </ResponsiveContainer>
  )
})

const SlideTendencias = memo(function SlideTendencias({ data, escala }: { data: PainelData; escala: number }) {
  return (
    <div className="grid grid-rows-2 gap-[2vh] h-full">
      <Card titulo="📈 Vendas por dia · últimos 14 dias" cor={COR_VENDAS}>
        <div className="flex-1 min-h-0">
          <GraficoHistorico data={data.historico} chave="vendas" nome="Vendas" cor={COR_VENDAS} escala={escala} />
        </div>
      </Card>
      <Card titulo="📞 Clientes chamados por dia · últimos 14 dias" cor={COR_CONTATOS}>
        <div className="flex-1 min-h-0">
          <GraficoHistorico data={data.historico} chave="contatos" nome="Contatos" cor={COR_CONTATOS} escala={escala} />
        </div>
      </Card>
    </div>
  )
})

const SlideNegociacoes = memo(function SlideNegociacoes({ data }: { data: PainelData }) {
  const visiveis = data.negociosAbertos.slice(0, MAX_LINHAS_ORCAMENTOS)
  const resto = data.negociosAbertos.length - visiveis.length

  return (
    <div className="grid grid-cols-12 gap-[2vh] h-full">
      <div className="col-span-3 grid grid-rows-2 gap-[2vh] min-h-0">
        <Kpi titulo="Orçamentos em aberto" valor={data.orcamentosAbertos.quantidade} cor={COR_CONTATOS} sub="propostas aguardando" />
        <Kpi
          titulo="Valor em aberto"
          valor={<span className="text-[5.4vh]">{formatarMoeda(data.orcamentosAbertos.valor)}</span>}
          cor={COR_CONTATOS}
          sub="soma dos orçamentos"
        />
      </div>
      <Card titulo="⏱ Orçamentos em aberto" cor={COR_CONTATOS} className="col-span-9">
        <div className="flex items-center gap-[1.4vh] text-[1.6vh] text-dark-400 uppercase tracking-wide pb-[0.8vh] border-b border-dark-600 shrink-0">
          <span className="flex-1">Cliente</span>
          <span className="w-[24vh]">Vendedor</span>
          <span className="w-[20vh] text-right">Orçamento</span>
          <span className="w-[18vh] text-right">Na etapa há</span>
        </div>
        {!data.negociosAbertos.length && <p className="text-[2.2vh] text-dark-500 mt-[1.4vh]">Nenhuma negociação em andamento.</p>}
        <Linhas
          itens={visiveis}
          minLinhas={MAX_LINHAS_ORCAMENTOS}
          chave={(n) => n.clienteId}
          render={(n) => (
            <>
              <span className="flex-1 min-w-0 truncate text-dark-100">{n.razaoSocial}</span>
              <span className="w-[24vh] truncate text-dark-400">{n.vendedorNome}</span>
              <span className="w-[20vh] text-right font-mono tabular-nums text-amber-400 font-semibold">
                {n.valorOrcado != null ? formatarMoeda(n.valorOrcado) : '—'}
              </span>
              <span className="w-[18vh] text-right font-mono tabular-nums text-blue-400">{formatElapsed(n.dataEntradaEtapa)}</span>
            </>
          )}
        />
        {resto > 0 && <p className="text-[1.8vh] text-dark-400 mt-[1vh] shrink-0">+ {resto} outro{resto !== 1 ? 's' : ''} orçamento{resto !== 1 ? 's' : ''} em aberto</p>}
      </Card>
    </div>
  )
})

type ChaveSlide = 'geral' | 'semana' | 'ligacoes' | 'conversao' | 'tendencias' | 'orcamentos' | 'marketing'

export default function PainelTV() {
  const [relogio, setRelogio] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const escala = useEscala()

  // `refetchIntervalInBackground: true` é essencial aqui — um painel de TV
  // fica ligado numa tela sem mouse/teclado, então a aba nunca recebe foco
  // de verdade. Sem isso, o react-query pausa o refetch automático e o
  // painel trava nos números do primeiro carregamento.
  const { data } = trpc.painel.resumo.useQuery(undefined, { refetchInterval: 15000, refetchIntervalInBackground: true })
  const { celebracao, fecharCelebracao } = useCelebrarMeta(data?.vendedores)

  // Slide "Marketing" (mesmo conteúdo do /painel-tv-marketing) entrou no
  // lugar do antigo "Leads aguardando" — pedido do João, 2026-10-19. A
  // query roda aqui também (react-query reaproveita a mesma) só pra o
  // slide já abrir com dado, sem "Carregando..." toda vez que entra.
  trpc.painelMarketing.resumo.useQuery(undefined, { refetchInterval: 15000, refetchIntervalInBackground: true, retry: false })

  const slides: { chave: ChaveSlide; titulo: string }[] = [
    { chave: 'geral', titulo: 'Visão geral' },
    { chave: 'semana', titulo: 'Semana' },
    { chave: 'ligacoes', titulo: 'Ligações' },
    { chave: 'conversao', titulo: 'Conversão' },
    { chave: 'tendencias', titulo: 'Tendências' },
    { chave: 'orcamentos', titulo: 'Orçamentos' },
    { chave: 'marketing', titulo: 'Marketing' },
  ]
  const [slideAtual, setSlideAtual] = useState(0)
  const [configAberta, setConfigAberta] = useState(false)
  const utils = trpc.useUtils()
  const { data: config } = trpc.configuracoes.painelTvConfig.useQuery()
  const segundos = config?.segundos ?? SEGUNDOS_POR_SLIDE
  const autoplay = config?.autoplay ?? true
  const salvarConfigMut = trpc.configuracoes.set.useMutation({
    onSuccess() {
      utils.configuracoes.painelTvConfig.invalidate()
      setConfigAberta(false)
    },
  })

  useEffect(() => {
    if (!autoplay) return
    const id = setInterval(() => setSlideAtual((s) => (s + 1) % slides.length), segundos * 1000)
    return () => clearInterval(id)
  }, [slides.length, segundos, autoplay])

  const atual = slides[slideAtual] ?? slides[0]

  function renderSlide() {
    if (!data) return <p className="text-dark-500 text-[2.4vh]">Carregando...</p>
    switch (atual.chave) {
      case 'geral':
        return <SlideVisaoGeral data={data} />
      case 'semana':
        return <SlideRankingSemanal data={data} />
      case 'ligacoes':
        return <SlideLigacoes data={data} />
      case 'conversao':
        return <SlideConversao data={data} />
      case 'tendencias':
        return <SlideTendencias data={data} escala={escala} />
      case 'orcamentos':
        return <SlideNegociacoes data={data} />
      case 'marketing':
        return (
          <div className="h-full flex flex-col">
            <PainelMarketingConteudo />
          </div>
        )
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-dark-950 text-dark-50 p-[2.4vh] flex flex-col gap-[2vh]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-[2vh]">
          <h1 className="font-heading text-[4vh] text-gold-400 font-bold leading-none">Painel de Vendas</h1>
          <span className="text-[3vh] font-semibold text-dark-100 leading-none">· {atual.titulo}</span>
          <span className="flex items-center gap-[0.8vh] text-[1.7vh] text-green-400 bg-green-900/25 px-[1.2vh] py-[0.5vh] rounded-full">
            <span className="w-[1vh] h-[1vh] rounded-full bg-green-400 animate-pulse" />
            ao vivo
          </span>
        </div>
        <div className="flex items-center gap-[1.6vh]">
          <div className="text-right">
            <p className="text-[4vh] font-mono leading-none tabular-nums">{relogio.toLocaleTimeString('pt-BR')}</p>
            <p className="text-[1.8vh] text-dark-400 mt-[0.4vh]">
              {relogio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
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
        onSalvar={({ segundos: s, autoplay: a }) =>
          salvarConfigMut.mutate({ painel_tv_segundos_por_slide: s, painel_tv_autoplay: a ? 1 : 0 })
        }
      />

      <div className="flex-1 min-h-0">{renderSlide()}</div>

      <div className="shrink-0 flex items-center gap-[1vh]">
        {slides.map((s, i) => (
          <button
            key={s.chave}
            onClick={() => setSlideAtual(i)}
            className={`relative flex-1 overflow-hidden rounded-full text-[1.7vh] py-[0.7vh] transition-colors ${
              s.chave === atual.chave ? 'bg-dark-700 text-dark-50 font-semibold' : 'bg-dark-800 text-dark-500'
            }`}
          >
            {/* Barra de progresso do slide — quem olha de longe vê quanto falta pra trocar. */}
            {s.chave === atual.chave && autoplay && (
              <span
                key={`${slideAtual}-${segundos}`}
                className="absolute inset-y-0 left-0 bg-gold-400/30 painel-progresso"
                style={{ animationDuration: `${segundos}s` }}
              />
            )}
            <span className="relative">{s.titulo}</span>
          </button>
        ))}
      </div>

      <CelebracaoPopup celebracao={celebracao} onFechar={fecharCelebracao} />
    </div>
  )
}
