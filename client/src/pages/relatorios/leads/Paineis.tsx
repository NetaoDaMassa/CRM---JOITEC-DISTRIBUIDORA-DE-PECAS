import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BadgeDollarSign, Clock, Handshake, Inbox, PhoneCall, Receipt, Target, TrendingDown } from 'lucide-react'
import { formatarDataCurta, somarDias } from '../../../components/relatorios/filtros'
import { Abas, BarraSegmentada, Etiqueta, KpiCard, Ranking, Secao, moeda, numero, pct } from '../../../components/relatorios/blocos'
import TabelaDados from '../../../components/relatorios/TabelaDados'
import type { Coluna } from '../../../components/relatorios/TabelaDados'
import { CANAIS, ETAPAS, REGIOES_BR, SEGMENTOS, agrupar, grupoMotivo, horasUteis } from './base'
import type { Canal, FiltrosLeads, Grupo, LinhaLead, Metricas } from './base'

const estiloTooltip = { background: 'var(--color-dark-900)', border: '1px solid var(--color-dark-600)', borderRadius: 8, fontSize: 12 }
const tick = { fill: 'var(--color-dark-400)', fontSize: 11 }
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export type PropsPainel = { f: FiltrosLeads; m: Metricas; ant: Metricas }

// ── Visão geral ─────────────────────────────────────────────────────────
export function VisaoGeral({ f, m, ant }: PropsPainel) {
  const [visao, setVisao] = useState<'canal' | 'etapa'>('canal')

  // Leads por dia (ou por semana, em período longo), empilhado por canal ou
  // pela etapa de hoje.
  const { serie, chaves, porSemana } = useMemo(() => {
    const dias: string[] = []
    for (let d = f.inicio; d <= f.fim && dias.length < 800; d = somarDias(d, 1)) dias.push(d)
    const porSemana = dias.length > 62
    const balde = (d: string) => {
      if (!porSemana) return d
      const dt = new Date(`${d}T12:00:00Z`)
      return somarDias(d, -((dt.getUTCDay() + 6) % 7))
    }
    const linhas = new Map<string, Record<string, number | string>>()
    for (const d of dias) {
      const b = balde(d)
      if (!linhas.has(b)) linhas.set(b, { data: b })
    }
    const usadas = new Set<string>()
    for (const l of m.safra) {
      const k = visao === 'canal' ? l.canal : l.status
      usadas.add(k)
      const linha = linhas.get(balde(l.dataEntrada))
      if (linha) linha[k] = ((linha[k] as number) ?? 0) + 1
    }
    const ordem = visao === 'canal' ? Object.keys(CANAIS) : Object.keys(ETAPAS)
    return { serie: [...linhas.values()], chaves: ordem.filter((k) => usadas.has(k)), porSemana }
  }, [m.safra, f.inicio, f.fim, visao])

  const funil = [
    { rotulo: 'Recebidos', valor: m.recebidos, cor: '#3b82f6', ajuda: 'Leads que entraram no período' },
    { rotulo: 'Contatados', valor: m.safra.filter((l) => l.contatado).length, cor: '#eab308', ajuda: 'Tiveram contato confirmado' },
    { rotulo: 'Qualificados', valor: m.safra.filter((l) => l.etapaMax >= 2).length, cor: '#a855f7', ajuda: 'Chegaram em Qualificado (mesmo que depois tenham sido perdidos)' },
    { rotulo: 'Negociação', valor: m.safra.filter((l) => l.etapaMax >= 3).length, cor: '#f97316', ajuda: 'Chegaram a receber orçamento' },
    { rotulo: 'Ganhos', valor: m.ganhosSafra, cor: '#22a861', ajuda: 'Viraram venda' },
  ]

  const porCanal = agrupar(m, (l) => l.canal).sort((a, b) => b.recebidos - a.recebidos)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard titulo="Leads recebidos" icone={Inbox} valor={numero(m.recebidos)} atual={m.recebidos} anterior={ant.recebidos} ajuda="Leads que entraram no CRM no período." />
        <KpiCard
          titulo="Atendidos"
          icone={PhoneCall}
          cor="#eab308"
          valor={pct(m.pctAtendidos, 0)}
          atual={m.pctAtendidos}
          anterior={ant.pctAtendidos}
          detalhe={`${numero(m.atendidos)} de ${numero(m.recebidos)} · ${numero(m.semContato)} ainda sem contato`}
          ajuda="Quantos dos leads recebidos já tiveram um contato confirmado."
        />
        <KpiCard
          titulo="Tempo até o 1º contato"
          icone={Clock}
          cor="#0ea5a4"
          valor={horasUteis(m.amostraTempo ? m.primeiroContatoHoras : null)}
          atual={m.primeiroContatoHoras}
          anterior={ant.amostraTempo ? ant.primeiroContatoHoras : undefined}
          inverter
          detalhe={`${numero(m.atendidosAte1h)} atendidos em até 1h útil`}
          ajuda="Média, em horas úteis, entre o lead chegar e o 1º contato confirmado."
        />
        <KpiCard
          titulo="Taxa de conversão"
          icone={Target}
          cor="#22a861"
          valor={pct(m.conversao)}
          atual={m.conversao}
          anterior={ant.conversao}
          detalhe={`${numero(m.ganhosSafra)} dos leads do período já viraram venda`}
          ajuda="Leads recebidos no período que já foram ganhos ÷ leads recebidos."
        />
        <KpiCard
          titulo="Vendas fechadas"
          icone={BadgeDollarSign}
          cor="#22a861"
          valor={moeda(m.valorVendas)}
          atual={m.valorVendas}
          anterior={ant.valorVendas}
          detalhe={`${numero(m.qtdVendas)} venda(s) · ${m.qtdVendas ? `${m.diasAteFechar.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} dias em média até fechar` : ''}`}
          ajuda="Leads marcados como Ganho no período (pela data do fechamento, mesmo que tenham chegado antes)."
        />
        <KpiCard titulo="Ticket médio" icone={Receipt} cor="#8b5cf6" valor={moeda(m.ticket)} atual={m.ticket} anterior={ant.ticket} ajuda="Valor médio de cada venda fechada no período." />
        <KpiCard
          titulo="Em negociação"
          icone={Handshake}
          cor="#f97316"
          valor={moeda(m.valorNegociando)}
          detalhe={`${numero(m.negociando)} lead(s) do período com orçamento em aberto`}
          ajuda="Soma dos valores orçados dos leads do período que estão hoje em Negociação."
        />
        <KpiCard
          titulo="Perdidos / desqualificados"
          icone={TrendingDown}
          cor="#e5534b"
          valor={pct(m.pctPerdidos, 0)}
          atual={m.pctPerdidos}
          anterior={ant.pctPerdidos}
          inverter
          detalhe={`${numero(m.perdidos)} dos leads do período`}
          ajuda="Leads recebidos no período que hoje estão como Perdido ou Desqualificado."
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <Secao titulo="Funil dos leads do período" subtitulo="Até onde cada lead já chegou (não só a etapa de hoje)" className="lg:col-span-2">
          <div className="space-y-2.5">
            {funil.map((e, i) => {
              const base = funil[0].valor || 1
              const anterior = i ? funil[i - 1].valor : 0
              return (
                <div key={e.rotulo} title={e.ajuda}>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <span className="text-dark-200 font-medium">{e.rotulo}</span>
                    <span className="text-dark-50 font-semibold tabular-nums">
                      {numero(e.valor)}
                      <span className="text-dark-400 font-normal text-xs ml-1.5">
                        {pct((e.valor / base) * 100, 0)}
                        {i > 0 && anterior > 0 && ` · ${pct((e.valor / anterior) * 100, 0)} da etapa anterior`}
                      </span>
                    </span>
                  </div>
                  <div className="h-7 rounded-lg bg-dark-700 overflow-hidden">
                    <div className="h-full rounded-lg transition-all duration-700" style={{ width: `${Math.max((e.valor / base) * 100, e.valor ? 2 : 0)}%`, background: e.cor }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Secao>
        <Secao
          titulo={porSemana ? 'Leads recebidos por semana' : 'Leads recebidos por dia'}
          subtitulo={`${formatarDataCurta(f.inicio)} a ${formatarDataCurta(f.fim)}`}
          className="lg:col-span-3"
          acoes={
            <Abas<'canal' | 'etapa'>
              valor={visao}
              onChange={setVisao}
              opcoes={[
                { valor: 'canal', rotulo: 'Por canal' },
                { valor: 'etapa', rotulo: 'Por etapa de hoje' },
              ]}
            />
          }
        >
          {m.recebidos ? (
            <div className="h-72 -ml-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
                  <XAxis dataKey="data" tickFormatter={diaMes} tick={tick} axisLine={false} tickLine={false} minTickGap={14} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
                  <Tooltip
                    labelFormatter={(d) => (porSemana ? `Semana de ${formatarDataCurta(String(d))}` : formatarDataCurta(String(d)))}
                    contentStyle={estiloTooltip}
                    cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }}
                  />
                  {chaves.map((k) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="l"
                      name={visao === 'canal' ? CANAIS[k as Canal].rotulo : ETAPAS[k]?.rotulo ?? k}
                      fill={visao === 'canal' ? CANAIS[k as Canal].cor : ETAPAS[k]?.cor ?? '#94a3b8'}
                    />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-dark-500 py-16 text-center">Nenhum lead no período.</p>
          )}
        </Secao>
      </div>

      <Secao titulo="De onde vêm os leads" subtitulo="Clique num canal pra filtrar o relatório inteiro por ele">
        <BarraSegmentada
          segmentos={porCanal.map((g) => ({ chave: g.chave, rotulo: CANAIS[g.chave as Canal].rotulo, valor: g.recebidos, cor: CANAIS[g.chave as Canal].cor, ajuda: CANAIS[g.chave as Canal].ajuda }))}
          selecionado={f.canal || null}
          aoClicar={(c) => f.setCanal(f.canal === c ? '' : c)}
        />
      </Secao>
    </div>
  )
}

// ── Colunas "por X" (canal, campanha, vendedor, estado...) ─────────────
function colunasGrupo(rotulo: string, render?: (g: Grupo) => ReactNode, extra?: Coluna<Grupo>[]): Coluna<Grupo>[] {
  return [
    { id: 'chave', rotulo, valor: (g) => g.chave, render: render ?? ((g) => <span className="font-medium text-dark-50">{g.chave}</span>), quebrar: true },
    { id: 'recebidos', rotulo: 'Leads', valor: (g) => g.recebidos, formato: 'numero', somar: true },
    { id: 'share', rotulo: '% dos leads', valor: (g) => Math.round(g.share * 10) / 10, formato: 'pct' },
    { id: 'pctAtendidos', rotulo: 'Atendidos', valor: (g) => Math.round(g.pctAtendidos), formato: 'pct' },
    { id: 'primeiroContato', rotulo: '1º contato', valor: (g) => g.primeiroContato, render: (g) => horasUteis(g.primeiroContato) },
    ...(extra ?? []),
    { id: 'ganhosSafra', rotulo: 'Ganhos', valor: (g) => g.ganhosSafra, formato: 'numero', somar: true },
    { id: 'conversao', rotulo: 'Conversão', valor: (g) => Math.round(g.conversao * 10) / 10, formato: 'pct' },
    { id: 'valorVendas', rotulo: 'Vendas fechadas', valor: (g) => g.valorVendas, formato: 'moeda', somar: true },
    { id: 'vendas', rotulo: 'Nº vendas', valor: (g) => g.vendas, formato: 'numero', somar: true, oculta: true },
    { id: 'ticket', rotulo: 'Ticket médio', valor: (g) => g.ticket, formato: 'moeda', oculta: true },
    { id: 'valorNegociando', rotulo: 'Em negociação', valor: (g) => g.valorNegociando, formato: 'moeda', somar: true },
    { id: 'perdidos', rotulo: 'Perdidos', valor: (g) => g.perdidos, formato: 'numero', somar: true, oculta: true },
  ]
}

const pontoCanal = (c: string) => (
  <span className="inline-flex items-center gap-2 font-medium text-dark-50">
    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CANAIS[c as Canal]?.cor }} />
    {CANAIS[c as Canal]?.rotulo ?? c}
  </span>
)

// ── Origem e campanhas ──────────────────────────────────────────────────
export function Origem({ f, m }: PropsPainel) {
  const porCanal = agrupar(m, (l) => l.canal)
  const porCampanha = agrupar(m, (l) => l.campanha ?? '(sem campanha)')
  const [quando, setQuando] = useState<'hora' | 'dia'>('hora')

  const chegada = useMemo(() => {
    if (quando === 'hora') {
      const h = Array.from({ length: 24 }, (_, i) => ({ rotulo: `${i}h`, leads: 0, ganhos: 0 }))
      for (const l of m.safra) {
        h[l.horaEntrada].leads++
        if (l.status === 'ganho') h[l.horaEntrada].ganhos++
      }
      return h.filter((x, i) => x.leads > 0 || (i >= 7 && i <= 20))
    }
    const d = DIAS_SEMANA.map((r) => ({ rotulo: r, leads: 0, ganhos: 0 }))
    for (const l of m.safra) {
      d[l.diaSemanaEntrada].leads++
      if (l.status === 'ganho') d[l.diaSemanaEntrada].ganhos++
    }
    return [...d.slice(1), d[0]]
  }, [m.safra, quando])

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-2 gap-5">
        <Secao titulo="Conversão por canal" subtitulo="Dos leads que chegaram por cada canal, quantos % já viraram venda">
          <Ranking
            itens={porCanal
              .filter((g) => g.recebidos > 0)
              .sort((a, b) => b.conversao - a.conversao)
              .map((g) => ({ rotulo: CANAIS[g.chave as Canal].rotulo, valor: g.conversao, extra: `${numero(g.ganhosSafra)} de ${numero(g.recebidos)}` }))}
            formatar={(v) => pct(v)}
            cor="#22a861"
            vazio="Nenhum lead no período."
          />
        </Secao>
        <Secao titulo="Vendas fechadas por canal" subtitulo="Valor dos leads ganhos no período, por canal de origem">
          <Ranking
            itens={porCanal
              .filter((g) => g.valorVendas > 0)
              .sort((a, b) => b.valorVendas - a.valorVendas)
              .map((g) => ({ rotulo: CANAIS[g.chave as Canal].rotulo, valor: g.valorVendas, extra: `${numero(g.vendas)} venda(s)` }))}
            formatar={moeda}
            cor="#24aff4"
            vazio="Nenhuma venda fechada no período."
          />
        </Secao>
      </div>

      <Secao titulo="Por canal" subtitulo="Clique num canal pra filtrar o relatório inteiro por ele">
        <TabelaDados
          id="leads-canal"
          linhas={porCanal}
          colunas={colunasGrupo('Canal', (g) => (
            <button type="button" onClick={() => f.setCanal(f.canal === g.chave ? '' : g.chave)} className="hover:underline">
              {pontoCanal(g.chave)}
            </button>
          ))}
          chave={(g) => g.chave}
          nomeArquivo="leads-por-canal"
          ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
          porPaginaInicial={20}
        />
      </Secao>

      <Secao titulo="Por campanha" subtitulo="Nome da campanha do anúncio (Meta) ou do link (UTM). Lead sem campanha = digitado à mão ou sem rastreio.">
        <TabelaDados
          id="leads-campanha"
          linhas={porCampanha}
          colunas={colunasGrupo('Campanha', (g) => (
            <button type="button" onClick={() => f.setCampanha(f.campanha === g.chave ? '' : g.chave)} className="font-medium text-dark-50 hover:underline text-left">
              {g.chave}
            </button>
          ))}
          chave={(g) => g.chave}
          buscaEm={(g) => g.chave}
          placeholderBusca="Buscar campanha..."
          nomeArquivo="leads-por-campanha"
          ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
          porPaginaInicial={20}
        />
      </Secao>

      <Secao
        titulo="Quando os leads chegam"
        subtitulo="Ajuda a decidir horário de anúncio e de plantão de atendimento"
        acoes={
          <Abas<'hora' | 'dia'>
            valor={quando}
            onChange={setQuando}
            opcoes={[
              { valor: 'hora', rotulo: 'Por hora' },
              { valor: 'dia', rotulo: 'Por dia da semana' },
            ]}
          />
        }
      >
        <div className="h-64 -ml-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chegada} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-dark-700)" vertical={false} />
              <XAxis dataKey="rotulo" tick={tick} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={estiloTooltip} cursor={{ fill: 'var(--color-dark-700)', opacity: 0.4 }} />
              <Bar dataKey="leads" name="Leads" fill="#3b82f6" radius={[5, 5, 0, 0]} />
              <Bar dataKey="ganhos" name="Viraram venda" fill="#22a861" radius={[5, 5, 0, 0]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Secao>
    </div>
  )
}

// ── Vendedores ──────────────────────────────────────────────────────────
export function Vendedores({ f, m }: PropsPainel) {
  const porVendedor = agrupar(m, (l) => `${l.vendedorId ?? 0}|${l.vendedor}`)
  const nome = (g: Grupo) => g.chave.split('|')[1]
  const id = (g: Grupo) => g.chave.split('|')[0]
  const comLeads = porVendedor.filter((g) => g.recebidos > 0)

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-2 gap-5">
        <Secao titulo="Mais rápido no 1º contato" subtitulo="Média em horas úteis — quanto menor, melhor">
          <Ranking
            itens={comLeads
              .filter((g) => g.primeiroContato !== null)
              .sort((a, b) => (a.primeiroContato ?? 0) - (b.primeiroContato ?? 0))
              .map((g) => ({ rotulo: nome(g), valor: g.primeiroContato ?? 0, extra: `${numero(g.tempos.length)} lead(s)` }))}
            formatar={(v) => horasUteis(v)}
            cor="#0ea5a4"
            vazio="Nenhum contato confirmado no período."
          />
        </Secao>
        <Secao titulo="Conversão por vendedor" subtitulo="Leads recebidos no período que já viraram venda">
          <Ranking
            itens={comLeads
              .sort((a, b) => b.conversao - a.conversao)
              .map((g) => ({ rotulo: nome(g), valor: g.conversao, extra: `${numero(g.ganhosSafra)} de ${numero(g.recebidos)}` }))}
            formatar={(v) => pct(v)}
            cor="#22a861"
          />
        </Secao>
      </div>
      <Secao titulo="Por vendedor" subtitulo="Clique no nome pra ver o relatório só dele">
        <TabelaDados
          id="leads-vendedor"
          linhas={porVendedor}
          colunas={colunasGrupo(
            'Vendedor',
            (g) => (
              <button type="button" onClick={() => f.setVendedor(f.vendedor === id(g) ? '' : id(g))} className="font-medium text-dark-50 hover:underline text-left">
                {nome(g)}
              </button>
            ),
            [
              {
                id: 'atrasados',
                rotulo: 'Retorno atrasado',
                valor: (g) => g.atrasados,
                formato: 'numero',
                somar: true,
                render: (g) => (g.atrasados ? <Etiqueta cor="#e5534b">{numero(g.atrasados)}</Etiqueta> : <span className="text-dark-500">0</span>),
              },
            ]
          )}
          chave={(g) => g.chave}
          buscaEm={nome}
          nomeArquivo="leads-por-vendedor"
          ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
        />
      </Secao>
    </div>
  )
}

// ── Regiões e segmentos ─────────────────────────────────────────────────
const CORES_REGIAO: Record<string, string> = { norte: '#22a861', nordeste: '#f2a516', centro_oeste: '#f97316', sudeste: '#3b82f6', sul: '#8b5cf6', '': '#94a3b8' }

export function Regioes({ f, m }: PropsPainel) {
  const porRegiao = agrupar(m, (l) => l.regiaoBr ?? '')
  const porUf = agrupar(m, (l) => l.uf ?? '(sem DDD)')
  const porSegmento = agrupar(m, (l) => l.segmento)
  const porCidade = agrupar(m, (l) => (l.cidade ? `${l.cidade.trim()}${l.uf ? ` - ${l.uf}` : ''}` : '(cidade não informada)'))

  return (
    <div className="space-y-5">
      <Secao titulo="Leads por região" subtitulo="Pelo DDD do telefone. Clique numa região pra filtrar.">
        <BarraSegmentada
          segmentos={porRegiao
            .sort((a, b) => b.recebidos - a.recebidos)
            .map((g) => ({ chave: g.chave, rotulo: REGIOES_BR[g.chave] ?? 'Sem DDD', valor: g.recebidos, cor: CORES_REGIAO[g.chave] ?? '#94a3b8' }))}
          selecionado={f.regiao || null}
          aoClicar={(r) => r && f.setRegiao(f.regiao === r ? '' : r)}
        />
      </Secao>
      <div className="grid lg:grid-cols-2 gap-5">
        <Secao titulo="Por estado">
          <TabelaDados
            id="leads-uf"
            linhas={porUf}
            colunas={colunasGrupo('Estado', (g) => (
              <button type="button" onClick={() => g.chave.length === 2 && f.setUf(f.uf === g.chave ? '' : g.chave)} className="font-medium text-dark-50 hover:underline">
                {g.chave}
              </button>
            )).filter((c) => !['primeiroContato', 'valorNegociando', 'pctAtendidos'].includes(c.id))}
            chave={(g) => g.chave}
            nomeArquivo="leads-por-estado"
            ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
            porPaginaInicial={10}
          />
        </Secao>
        <Secao titulo="Por segmento" subtitulo="O que o lead faz (preenchido pelo vendedor)">
          <TabelaDados
            id="leads-segmento"
            linhas={porSegmento}
            colunas={colunasGrupo('Segmento', (g) => (
              <button type="button" onClick={() => f.setSegmento(f.segmento === g.chave ? '' : g.chave)} className="font-medium text-dark-50 hover:underline text-left">
                {SEGMENTOS[g.chave] ?? g.chave}
              </button>
            )).filter((c) => !['primeiroContato', 'valorNegociando', 'pctAtendidos'].includes(c.id))}
            chave={(g) => g.chave}
            nomeArquivo="leads-por-segmento"
            ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
            porPaginaInicial={10}
          />
        </Secao>
      </div>
      <Secao titulo="Por cidade" subtitulo="Só quando a cidade foi preenchida">
        <TabelaDados
          id="leads-cidade"
          linhas={porCidade}
          colunas={colunasGrupo('Cidade').filter((c) => !['primeiroContato', 'valorNegociando'].includes(c.id))}
          chave={(g) => g.chave}
          buscaEm={(g) => g.chave}
          placeholderBusca="Buscar cidade..."
          nomeArquivo="leads-por-cidade"
          ordemInicial={{ coluna: 'recebidos', direcao: 'desc' }}
          porPaginaInicial={10}
        />
      </Secao>
    </div>
  )
}

// ── Perdas ──────────────────────────────────────────────────────────────
const ETAPA_MAX = ['Novo', 'Abordagem', 'Qualificado', 'Negociação', 'Ganho']

export function Perdas({ m, leadsBase }: PropsPainel & { leadsBase: string }) {
  const [tipo, setTipo] = useState<'todos' | 'perdido' | 'desqualificado' | 'consumidor_final'>('todos')
  const linhas = m.perdasPeriodo.filter((l) => tipo === 'todos' || l.status === tipo)
  const grupos = new Map<string, number>()
  for (const l of linhas) grupos.set(grupoMotivo(l.motivo), (grupos.get(grupoMotivo(l.motivo)) ?? 0) + 1)
  const ondeParou = new Map<string, number>()
  for (const l of linhas) ondeParou.set(ETAPA_MAX[l.etapaMax] ?? 'Novo', (ondeParou.get(ETAPA_MAX[l.etapaMax] ?? 'Novo') ?? 0) + 1)
  const contar = (s: string) => m.perdasPeriodo.filter((l) => l.status === s).length

  const colunas: Coluna<LinhaLead>[] = [
    { id: 'dataFechamento', rotulo: 'Encerrado em', valor: (l) => l.dataFechamento, formato: 'data' },
    { id: 'nome', rotulo: 'Lead', valor: (l) => l.nome, render: (l) => <span className="font-medium text-dark-50">{l.nome}</span> },
    { id: 'status', rotulo: 'Como terminou', valor: (l) => ETAPAS[l.status]?.rotulo ?? l.status, render: (l) => <Etiqueta cor={ETAPAS[l.status]?.cor ?? '#94a3b8'}>{ETAPAS[l.status]?.rotulo ?? l.status}</Etiqueta> },
    { id: 'grupo', rotulo: 'Motivo (agrupado)', valor: (l) => grupoMotivo(l.motivo) },
    { id: 'motivo', rotulo: 'O que o vendedor escreveu', valor: (l) => l.motivo, quebrar: true },
    { id: 'etapaMax', rotulo: 'Chegou até', valor: (l) => ETAPA_MAX[l.etapaMax] },
    { id: 'valorOrcado', rotulo: 'Valor orçado', valor: (l) => l.valorOrcado, formato: 'moeda', somar: true },
    { id: 'vendedor', rotulo: 'Vendedor', valor: (l) => l.vendedor },
    { id: 'canal', rotulo: 'Canal', valor: (l) => CANAIS[l.canal].rotulo, render: (l) => pontoCanal(l.canal) },
    { id: 'tentativas', rotulo: 'Tentativas de contato', valor: (l) => l.tentativas, formato: 'numero', oculta: true },
  ]

  return (
    <div className="space-y-5">
      <Abas
        valor={tipo}
        onChange={setTipo}
        opcoes={[
          { valor: 'todos', rotulo: 'Todos', contagem: m.perdasPeriodo.length },
          { valor: 'perdido', rotulo: 'Perdidos', contagem: contar('perdido') },
          { valor: 'desqualificado', rotulo: 'Desqualificados', contagem: contar('desqualificado') },
          { valor: 'consumidor_final', rotulo: 'Consumidor final / repassado', contagem: contar('consumidor_final') },
        ]}
      />
      <div className="grid lg:grid-cols-2 gap-5">
        <Secao titulo="Por que não deu certo" subtitulo="Motivos escritos pelo vendedor, juntados por assunto">
          <Ranking itens={[...grupos.entries()].sort((a, b) => b[1] - a[1]).map(([rotulo, valor]) => ({ rotulo, valor, extra: pct((valor / (linhas.length || 1)) * 100, 0) }))} cor="#e5534b" vazio="Nenhuma perda no período." />
        </Secao>
        <Secao titulo="Até onde chegaram antes de perder" subtitulo="Perda em Negociação dói mais: já tinha orçamento">
          <Ranking itens={ETAPA_MAX.filter((e) => ondeParou.has(e)).map((rotulo) => ({ rotulo, valor: ondeParou.get(rotulo) ?? 0 }))} cor="#f97316" vazio="Nenhuma perda no período." />
        </Secao>
      </div>
      <Secao titulo="Leads encerrados sem venda no período">
        <TabelaDados
          id="leads-perdas"
          linhas={linhas}
          colunas={colunas}
          chave={(l) => l.id}
          buscaEm={(l) => `${l.nome} ${l.motivo ?? ''} ${l.vendedor}`}
          placeholderBusca="Buscar lead, motivo ou vendedor..."
          nomeArquivo="leads-perdas"
          link={(l) => `${leadsBase}/${l.id}`}
          ordemInicial={{ coluna: 'dataFechamento', direcao: 'desc' }}
        />
      </Secao>
    </div>
  )
}

// ── Lista de leads ──────────────────────────────────────────────────────
export function Lista({ m, leadsBase }: PropsPainel & { leadsBase: string }) {
  const [qual, setQual] = useState<'entraram' | 'vendas'>('entraram')
  const colunas: Coluna<LinhaLead>[] = [
    { id: 'dataEntrada', rotulo: 'Chegou em', valor: (l) => l.dataEntrada, formato: 'data' },
    { id: 'nome', rotulo: 'Lead', valor: (l) => l.nome, render: (l) => <span className="font-medium text-dark-50">{l.nome}</span> },
    { id: 'empresa', rotulo: 'Empresa', valor: (l) => l.empresa, oculta: true },
    { id: 'cidade', rotulo: 'Cidade', valor: (l) => (l.cidade ? `${l.cidade}${l.uf ? ` - ${l.uf}` : ''}` : l.uf) },
    { id: 'canal', rotulo: 'Canal', valor: (l) => CANAIS[l.canal].rotulo, render: (l) => pontoCanal(l.canal) },
    { id: 'campanha', rotulo: 'Campanha', valor: (l) => l.campanha, oculta: true },
    { id: 'origemTexto', rotulo: 'Origem digitada', valor: (l) => l.origemTexto, oculta: true },
    { id: 'segmento', rotulo: 'Segmento', valor: (l) => SEGMENTOS[l.segmento] ?? l.segmento, oculta: true },
    { id: 'vendedor', rotulo: 'Vendedor', valor: (l) => l.vendedor },
    { id: 'status', rotulo: 'Etapa hoje', valor: (l) => ETAPAS[l.status]?.rotulo ?? l.status, render: (l) => <Etiqueta cor={ETAPAS[l.status]?.cor ?? '#94a3b8'}>{ETAPAS[l.status]?.rotulo ?? l.status}</Etiqueta> },
    { id: 'primeiroContatoHoras', rotulo: '1º contato', valor: (l) => l.primeiroContatoHoras, render: (l) => (l.primeiroContatoHoras === null ? <span className="text-red-500">sem contato</span> : horasUteis(l.primeiroContatoHoras)) },
    { id: 'tentativas', rotulo: 'Tentativas', valor: (l) => l.tentativas, formato: 'numero' },
    { id: 'valorOrcado', rotulo: 'Valor orçado', valor: (l) => l.valorOrcado, formato: 'moeda', somar: true, oculta: true },
    { id: 'valorFinal', rotulo: 'Valor da venda', valor: (l) => l.valorFinal, formato: 'moeda', somar: true },
    { id: 'dataFechamento', rotulo: 'Encerrado em', valor: (l) => l.dataFechamento, formato: 'data', oculta: true },
    { id: 'transferencias', rotulo: 'Trocas de vendedor', valor: (l) => l.transferencias, formato: 'numero', oculta: true },
    {
      id: 'atrasado',
      rotulo: 'Retorno',
      valor: (l) => (l.atrasado ? 'Atrasado' : l.proximoContato ? 'Em dia' : ''),
      render: (l) => (l.atrasado ? <Etiqueta cor="#e5534b">Atrasado</Etiqueta> : l.proximoContato ? <span className="text-dark-400">{formatarDataCurta(l.proximoContato)}</span> : '—'),
      oculta: true,
    },
  ]
  const linhas = qual === 'entraram' ? m.safra : m.vendas
  return (
    <Secao
      titulo={qual === 'entraram' ? 'Leads que chegaram no período' : 'Vendas fechadas no período'}
      acoes={
        <Abas
          valor={qual}
          onChange={setQual}
          opcoes={[
            { valor: 'entraram', rotulo: 'Chegaram', contagem: m.safra.length },
            { valor: 'vendas', rotulo: 'Vendas fechadas', contagem: m.vendas.length },
          ]}
        />
      }
    >
      <TabelaDados
        key={qual}
        id="leads-lista"
        linhas={linhas}
        colunas={colunas}
        chave={(l) => l.id}
        buscaEm={(l) => `${l.nome} ${l.empresa ?? ''} ${l.cidade ?? ''} ${l.vendedor} ${l.campanha ?? ''}`}
        placeholderBusca="Buscar lead, empresa, cidade, vendedor..."
        nomeArquivo={qual === 'entraram' ? 'leads-do-periodo' : 'vendas-de-leads'}
        link={(l) => `${leadsBase}/${l.id}`}
        ordemInicial={{ coluna: qual === 'entraram' ? 'dataEntrada' : 'valorFinal', direcao: 'desc' }}
      />
    </Secao>
  )
}
