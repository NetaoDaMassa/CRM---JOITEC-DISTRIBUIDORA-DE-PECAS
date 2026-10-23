// Abas novas de Relatórios Odin (pedido do João, 2026-10-23) — dados em
// server/src/lib/relatoriosOdinNovos.ts.
import type { ReactNode } from 'react'
import { AlertTriangle, Ban, Boxes, CalendarClock, CircleCheck, Clock, FileText, MapPin, Map as MapIcon, PackageX, Repeat, ShoppingCart, Target, Timer, TrendingDown, Users, Wrench } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Carregando, KpiCard, Secao, moeda, numero, pct } from '../relatorios/blocos'
import { PROPOSTA_STAGE_LABELS, type PropostaStage } from '../../lib/propostasShared'

type Filtro = { dataDe?: string; dataAte?: string; vendedorId?: number }

const pctOuTraco = (v: number | null | undefined) => (v == null ? '—' : pct(v))
const data = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

function Tabela({ colunas, linhas, vazio = 'Nada no período.' }: { colunas: { titulo: string; direita?: boolean }[]; linhas: { chave: string | number; celulas: ReactNode[] }[]; vazio?: string }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-dark-400 border-b border-dark-600">
            {colunas.map((c) => (
              <th key={c.titulo} className={`py-2 px-2 font-medium whitespace-nowrap ${c.direita ? 'text-right' : 'text-left'}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} className="border-b border-dark-700/60 last:border-0">
              {l.celulas.map((c, i) => (
                <td key={i} className={`py-2 px-2 ${colunas[i]?.direita ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!linhas.length && (
            <tr>
              <td colSpan={colunas.length} className="py-6 text-center text-dark-500">
                {vazio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// Barra horizontal simples (proporção dentro de uma lista).
function Barras({ itens, cor, formatar = numero }: { itens: { rotulo: ReactNode; valor: number; extra?: ReactNode }[]; cor: string; formatar?: (v: number) => string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  if (!itens.length) return <p className="text-sm text-dark-500">Nada no período.</p>
  return (
    <div className="space-y-2">
      {itens.map((i, idx) => (
        <div key={idx}>
          <div className="flex justify-between gap-2 text-sm mb-1">
            <span className="text-dark-200 truncate">{i.rotulo}</span>
            <span className="font-semibold text-dark-50 shrink-0">
              {formatar(i.valor)} {i.extra && <span className="text-dark-400 font-normal">{i.extra}</span>}
            </span>
          </div>
          <div className="h-2 bg-dark-900 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(i.valor / max) * 100}%`, background: cor }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Visitas por região/cidade ────────────────────────────────────────────
export function RelatorioVisitasRegiao({ filtro }: { filtro: Filtro }) {
  const { data: d, isLoading } = trpc.relatoriosOdin.visitasRegiao.useQuery(filtro)
  if (isLoading || !d) return <Carregando />
  const t = d.totais
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Visitas" icone={MapPin} cor="#8b6fd1" valor={numero(t.visitas)} detalhe={`${numero(t.clientes)} clientes diferentes`} />
        <KpiCard titulo="Cidades atendidas" icone={MapIcon} cor="#24aff4" valor={numero(t.cidades)} detalhe={`${numero(t.estados)} estados`} />
        <KpiCard titulo="Viraram proposta" icone={FileText} cor="#22a861" valor={numero(t.convertidas)} detalhe={`${pctOuTraco(t.visitas ? (t.convertidas / t.visitas) * 100 : null)} das visitas`} />
        <KpiCard titulo="Sem GPS" icone={AlertTriangle} cor="#c2691a" valor={numero(t.semGps)} detalhe="visitas lançadas à mão" destaque={t.semGps ? 'ruim' : undefined} />
        <KpiCard titulo="Sem check-out" icone={Clock} cor="#e5534b" valor={numero(t.semCheckout)} detalhe="entrou e não registrou saída" destaque={t.semCheckout ? 'ruim' : undefined} />
      </div>
      {t.semCidade > 0 && (
        <p className="text-xs text-dark-400">
          ⚠ {numero(t.semCidade)} visita(s) sem cidade no cadastro do cliente da visita — aparecem como "Sem cidade". Completar o cadastro melhora este relatório.
        </p>
      )}
      <div className="grid xl:grid-cols-3 gap-4 items-start">
        <Secao titulo="Por estado">
          <Barras cor="#8b6fd1" itens={d.porEstado.map((e) => ({ rotulo: e.estado, valor: e.visitas, extra: `· ${numero(e.clientes)} clientes` }))} />
        </Secao>
        <Secao className="xl:col-span-2" titulo="Cidades mais visitadas" subtitulo="Até 40 cidades">
          <Tabela
            colunas={[{ titulo: 'Cidade' }, { titulo: 'Visitas', direita: true }, { titulo: 'Clientes', direita: true }, { titulo: 'Viraram proposta', direita: true }, { titulo: 'Última visita', direita: true }, { titulo: 'Vendedores' }]}
            linhas={d.porCidade.map((c) => ({
              chave: `${c.cidade}-${c.estado}`,
              celulas: [
                <span className="text-dark-100">
                  {c.cidade} <span className="text-dark-500">/{c.estado}</span>
                </span>,
                numero(c.visitas),
                numero(c.clientes),
                `${numero(c.convertidas)} (${pctOuTraco(c.conversao)})`,
                data(c.ultimaVisita),
                <span className="text-xs text-dark-400">{c.vendedores.join(', ')}</span>,
              ],
            }))}
          />
        </Secao>
      </div>
      <Secao titulo="Por vendedor">
        <Tabela
          colunas={[{ titulo: 'Vendedor' }, { titulo: 'Visitas', direita: true }, { titulo: 'Cidades', direita: true }, { titulo: 'Estados', direita: true }, { titulo: 'Sem GPS', direita: true }, { titulo: 'Sem check-out', direita: true }, { titulo: 'Visita → proposta', direita: true }]}
          linhas={d.porVendedor.map((v) => ({
            chave: v.id,
            celulas: [
              <span className="font-medium text-dark-100">{v.nome}</span>,
              numero(v.visitas),
              numero(v.cidades),
              numero(v.estados),
              <span className={v.semGps ? 'text-amber-400' : ''}>{numero(v.semGps)}</span>,
              <span className={v.semCheckout ? 'text-red-400' : ''}>{numero(v.semCheckout)}</span>,
              pctOuTraco(v.conversao),
            ],
          }))}
        />
      </Secao>
      <Secao titulo="Clientes visitados que não viraram proposta" subtitulo="Os mais visitados primeiro — vale cobrar o retorno">
        <Tabela
          colunas={[{ titulo: 'Cliente' }, { titulo: 'Cidade' }, { titulo: 'Visitas', direita: true }, { titulo: 'Última visita', direita: true }, { titulo: 'Vendedor' }]}
          linhas={d.semProposta.map((c, i) => ({
            chave: i,
            celulas: [<span className="text-dark-100">{c.nome}</span>, `${c.cidade}/${c.estado}`, numero(c.visitas), data(c.ultima), c.vendedor],
          }))}
          vazio="Todas as visitas viraram proposta."
        />
      </Secao>
    </div>
  )
}

// ── Propostas: perdas e prazos ───────────────────────────────────────────
export function RelatorioPropostasPerdas({ filtro }: { filtro: Filtro }) {
  const { data: d, isLoading } = trpc.relatoriosOdin.propostasPerdas.useQuery(filtro)
  if (isLoading || !d) return <Carregando />
  const t = d.totais
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Propostas criadas" icone={FileText} cor="#24aff4" valor={numero(t.criadas)} detalhe={`${numero(t.emAberto)} ainda em aberto`} />
        <KpiCard titulo="Ganhas" icone={CircleCheck} cor="#22a861" valor={numero(t.ganhas)} detalhe={`taxa de ganho ${pctOuTraco(t.taxaGanho)}`} ajuda="Ganhas ÷ (ganhas + perdidas) — as em aberto ficam de fora" />
        <KpiCard titulo="Perdidas" icone={Ban} cor="#e5534b" valor={numero(t.perdidas)} />
        <KpiCard titulo="Tempo até fechar" icone={Timer} cor="#c2691a" valor={t.diasMedioAteFechar == null ? '—' : `${t.diasMedioAteFechar.toLocaleString('pt-BR')} dias`} detalhe="da proposta ao pedido" />
        <KpiCard
          titulo="Paradas agora"
          icone={CalendarClock}
          cor="#e5534b"
          valor={numero(t.paradas15)}
          detalhe={`há mais de 15 dias sem mexer · ${numero(t.retornosVencidos)} com retorno vencido`}
          destaque={t.paradas15 || t.retornosVencidos ? 'ruim' : 'bom'}
        />
      </div>
      <div className="grid xl:grid-cols-3 gap-4 items-start">
        <Secao titulo="Por que perdemos" subtitulo="Motivos informados ao marcar a proposta como perdida">
          <Barras cor="#e5534b" itens={d.motivos.slice(0, 12).map((m) => ({ rotulo: m.texto, valor: m.qtd }))} />
        </Secao>
        <Secao className="xl:col-span-2" titulo="Por vendedor">
          <Tabela
            colunas={[{ titulo: 'Vendedor' }, { titulo: 'Criadas', direita: true }, { titulo: 'Ganhas', direita: true }, { titulo: 'Perdidas', direita: true }, { titulo: 'Taxa de ganho', direita: true }, { titulo: 'Abertas agora', direita: true }, { titulo: 'Paradas +15d', direita: true }]}
            linhas={d.porVendedor.map((v) => ({
              chave: v.id,
              celulas: [
                <span className="font-medium text-dark-100">{v.nome}</span>,
                numero(v.criadas),
                numero(v.ganhas),
                numero(v.perdidas),
                pctOuTraco(v.taxaGanho),
                numero(v.abertasAgora),
                <span className={v.paradas15 ? 'text-red-400 font-semibold' : ''}>{numero(v.paradas15)}</span>,
              ],
            }))}
          />
        </Secao>
      </div>
      <Secao titulo="Propostas em aberto — da mais esquecida pra mais recente" subtitulo="Retorno vencido primeiro, depois dias sem nenhuma mudança">
        <Tabela
          colunas={[{ titulo: 'Cliente' }, { titulo: 'Vendedor' }, { titulo: 'Etapa' }, { titulo: 'Sem mexer há', direita: true }, { titulo: 'Criada há', direita: true }, { titulo: 'Retorno', direita: true }]}
          linhas={d.paradas.map((p) => ({
            chave: p.id,
            celulas: [
              <span className="text-dark-100">
                {p.cliente} {p.prioridade === 'urgente' && <span className="text-[11px] text-red-400 ml-1">urgente</span>}
              </span>,
              p.vendedor,
              PROPOSTA_STAGE_LABELS[p.etapa as PropostaStage] ?? p.etapa,
              <span className={p.diasParada > 15 ? 'text-red-400 font-semibold' : p.diasParada > 7 ? 'text-amber-400' : ''}>{numero(p.diasParada)} dias</span>,
              `${numero(p.idadeDias)} dias`,
              <span className={p.retornoVencido ? 'text-red-400 font-semibold' : ''}>{p.dataRetorno ? `${data(p.dataRetorno)}${p.retornoVencido ? ' ⚠' : ''}` : '—'}</span>,
            ],
          }))}
          vazio="Nenhuma proposta em aberto."
        />
      </Secao>
    </div>
  )
}

// ── Máquinas por modelo ──────────────────────────────────────────────────
export function RelatorioMaquinasModelo({ filtro }: { filtro: Filtro }) {
  const { data: d, isLoading } = trpc.relatoriosOdin.maquinasModelo.useQuery(filtro)
  if (isLoading || !d) return <Carregando />
  const t = d.totais
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Máquinas vendidas" icone={ShoppingCart} cor="#22a861" valor={numero(t.vendidas)} detalhe={`${numero(t.modelosVendidos)} modelos diferentes`} />
        <KpiCard titulo="Pedidas em propostas" icone={FileText} cor="#24aff4" valor={numero(t.procuraPropostas)} detalhe="quantidade nos itens das propostas" />
        <KpiCard titulo="Em estoque" icone={Boxes} cor="#8b6fd1" valor={numero(t.emEstoque)} />
        <KpiCard titulo="Paradas no estoque" icone={PackageX} cor="#e5534b" valor={numero(t.estoqueParado90)} detalhe="há mais de 90 dias" destaque={t.estoqueParado90 ? 'ruim' : undefined} />
        <KpiCard titulo="Demonstração → venda" icone={Target} cor="#c2691a" valor={pctOuTraco(t.conversaoDemonstracao)} detalhe={`${numero(t.demonstracoesVendidas)} de ${numero(t.demonstracoes)} · ${numero(t.demonstracoesAtrasadas)} com retorno atrasado`} />
      </div>
      <Secao titulo="Por modelo" subtitulo="Vendidas (pedidos do período) × procura (propostas do período) × estoque de hoje">
        <Tabela
          colunas={[{ titulo: 'Modelo' }, { titulo: 'Vendidas', direita: true }, { titulo: 'Em propostas', direita: true }, { titulo: 'Perdidas em propostas', direita: true }, { titulo: 'Em estoque', direita: true }, { titulo: 'Paradas +90d', direita: true }, { titulo: 'Quem mais vendeu' }, { titulo: 'Onde mais vendeu' }]}
          linhas={d.porModelo.map((m) => ({
            chave: m.modelo,
            celulas: [
              <span className="font-medium text-dark-100">{m.modelo}</span>,
              <span className="font-semibold text-dark-50">{numero(m.vendidas)}</span>,
              numero(m.procuraPropostas),
              numero(m.perdidasPropostas),
              numero(m.emEstoque),
              <span className={m.estoqueParado90 ? 'text-red-400 font-semibold' : ''} title={m.idadeMaxEstoque != null ? `Mais antiga: ${m.idadeMaxEstoque} dias` : undefined}>
                {numero(m.estoqueParado90)}
              </span>,
              <span className="text-xs text-dark-300">{m.topVendedores.map((v) => `${v.nome} (${v.qtd})`).join(', ') || '—'}</span>,
              <span className="text-xs text-dark-300">{m.topEstados.map((e) => `${e.uf} (${e.qtd})`).join(', ') || '—'}</span>,
            ],
          }))}
        />
      </Secao>
      <Secao titulo="Demonstrações com retorno atrasado" subtitulo="Máquina ainda no cliente depois da data prevista de volta">
        <Tabela
          colunas={[{ titulo: 'Produto' }, { titulo: 'Cliente' }, { titulo: 'Vendedor' }, { titulo: 'Retorno previsto', direita: true }, { titulo: 'Atraso', direita: true }]}
          linhas={d.demonstracoesAtrasadas.map((x, i) => ({
            chave: i,
            celulas: [x.produto, x.cliente, x.vendedor, data(x.retornoPrevisto), <span className="text-red-400 font-semibold">{numero(x.diasAtraso)} dias</span>],
          }))}
          vazio="Nenhuma demonstração atrasada."
        />
      </Secao>
    </div>
  )
}

// ── Peças: recompra da carteira ──────────────────────────────────────────
const STATUS_RECOMPRA = {
  ativo: { rotulo: 'Ativo', classe: 'text-green-400' },
  esfriando: { rotulo: 'Esfriando', classe: 'text-amber-400' },
  parado: { rotulo: 'Parado', classe: 'text-red-400' },
}

export function RelatorioPecasRecompra({ filtro }: { filtro: Filtro }) {
  const { data: d, isLoading } = trpc.relatoriosOdin.pecasRecompra.useQuery({ vendedorId: filtro.vendedorId })
  if (isLoading || !d) return <Carregando />
  const t = d.totais
  return (
    <div className="space-y-4">
      <p className="text-xs text-dark-400">
        Olha o histórico inteiro de compras (vendas do Kanban). <b>Ativo</b> = comprou nos últimos 60 dias · <b>Esfriando</b> = 61 a 120 dias · <b>Parado</b> = mais de 120 dias.
        <b> Passou do costume</b> = já faz 1,5× mais tempo que o intervalo normal entre as compras dele.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Já compraram peça" icone={Users} cor="#24aff4" valor={numero(t.compradores)} detalhe={`de ${numero(t.carteira)} clientes da carteira`} />
        <KpiCard titulo="Ativos" icone={Repeat} cor="#22a861" valor={numero(t.ativos)} />
        <KpiCard titulo="Esfriando" icone={TrendingDown} cor="#c2691a" valor={numero(t.esfriando)} />
        <KpiCard titulo="Parados" icone={Ban} cor="#e5534b" valor={numero(t.parados)} detalhe={`${numero(t.atrasadosNoCostume)} passaram do costume`} destaque={t.parados ? 'ruim' : undefined} />
        <KpiCard titulo="Máquina sem peça" icone={Wrench} cor="#8b6fd1" valor={numero(t.maquinaSemPeca)} detalhe="compraram máquina e nunca peça" />
      </div>
      <Secao titulo="Por vendedor da carteira">
        <Tabela
          colunas={[{ titulo: 'Vendedor' }, { titulo: 'Compradores', direita: true }, { titulo: 'Ativos', direita: true }, { titulo: 'Esfriando', direita: true }, { titulo: 'Parados', direita: true }, { titulo: 'Passaram do costume', direita: true }]}
          linhas={d.porVendedor.map((v) => ({
            chave: v.nome,
            celulas: [<span className="font-medium text-dark-100">{v.nome}</span>, numero(v.compradores), numero(v.ativos), numero(v.esfriando), numero(v.parados), numero(v.atrasadosNoCostume)],
          }))}
        />
      </Secao>
      <Secao titulo="Pra ligar primeiro" subtitulo="Quem passou do costume de compra, depois os parados que mais compravam (até 80)">
        <Tabela
          colunas={[{ titulo: 'Cliente' }, { titulo: 'Cidade' }, { titulo: 'Vendedor' }, { titulo: 'Situação' }, { titulo: 'Compras', direita: true }, { titulo: 'Total comprado', direita: true }, { titulo: 'Última compra', direita: true }, { titulo: 'Costume', direita: true }]}
          linhas={d.paraLigar.map((c) => ({
            chave: c.clienteId,
            celulas: [
              <span className="text-dark-100">{c.cliente}</span>,
              <span className="text-xs text-dark-400">{c.cidade}</span>,
              c.vendedor,
              <span className={STATUS_RECOMPRA[c.status].classe}>
                {STATUS_RECOMPRA[c.status].rotulo}
                {c.atrasadoNoCostume && <span className="ml-1 text-[11px] text-red-400">· passou do costume</span>}
              </span>,
              numero(c.compras),
              moeda(c.valorTotal),
              `${data(c.ultima)} (${numero(c.diasSemComprar)}d)`,
              c.intervaloMedio == null ? '1 compra' : `a cada ${numero(c.intervaloMedio)}d`,
            ],
          }))}
          vazio="Ninguém pra ligar — todo mundo comprando em dia."
        />
      </Secao>
      <Secao titulo="Compraram máquina e nunca compraram peça" subtitulo="Oportunidade de pós-venda (filtro, óleo, manutenção)">
        <Tabela
          colunas={[{ titulo: 'Cliente' }, { titulo: 'Cidade' }, { titulo: 'Vendedor da carteira' }, { titulo: 'Comprou a máquina em', direita: true }, { titulo: 'Há', direita: true }]}
          linhas={d.maquinaSemPeca.map((c) => ({
            chave: c.clienteId,
            celulas: [<span className="text-dark-100">{c.cliente}</span>, <span className="text-xs text-dark-400">{c.cidade}</span>, c.vendedor, data(c.compraMaquina), `${numero(c.diasDesde)} dias`],
          }))}
          vazio="Todo cliente de máquina já comprou peça."
        />
      </Secao>
    </div>
  )
}
