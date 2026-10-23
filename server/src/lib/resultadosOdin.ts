// "Resultados Odin" — tela única de resultado da Odin Compressores, por
// frente de venda (pedido do João, 2026-10-23: os números estavam
// espalhados entre Dashboard Odin, Relatórios Odin e Relatórios, e ninguém
// sabia onde olhar). Cada frente vende de um jeito (users.canalVenda):
//   Externos ('visitas'): visitas → propostas → pedidos. Sem meta individual.
//   Interno leads ('leads'): leads → atendidos → propostas → pedidos.
//   Interno peças ('pecas'): carteira → contatados → orçamentos → vendas.
// Geral = faturamento da empresa × meta (meta_faturamento_empresa_<id>).
//
// Mesmas regras de "venda" do dashboardOdin.equipes e do painel de TV:
// externos/leads = pedido (ordens) não cancelado criado no período, valor
// de ordem_detalhes.valorPedido; peças = venda do Kanban (tabela `vendas`).
// Período em dia de Brasília; colunas datetime('now') em UTC → +3h.
import { and, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { funilMensal, leadContactAttempts, leads, ordemDetalhes, ordens, propostas, registroContato, users, vendas, visitas } from '../db/schema.js'
import { coberturaContatosVendedor } from './coberturaContatos.js'
import { getConfigNumero } from './configuracoes.js'
import { diasUteisDecorridos, diasUteisNoMes, mesReferenciaAtual } from './dataBr.js'
import { metasVigentesPorVendedor } from './metasVigentes.js'

const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null)
const soma = <T>(l: T[], f: (x: T) => number) => l.reduce((a, x) => a + f(x), 0)

export type FrenteOdin = 'externos' | 'leads' | 'pecas'
const CANAL: Record<FrenteOdin, 'visitas' | 'leads' | 'pecas'> = { externos: 'visitas', leads: 'leads', pecas: 'pecas' }

// `somenteVendedorId`: vendedor (role vendor) só vê os próprios números.
export async function resultadosOdin(empresaId: number, de: string, ate: string, somenteVendedorId?: number) {
  const fimExclusivo = proximoDia(ate)
  const utc = { de: `${de} 03:00:00`, ate: `${fimExclusivo} 03:00:00` }
  // Meta e cobertura são mensais — usa o mês do início do período.
  const mes = `${de.slice(0, 7)}-01`
  const periodoEhMesCheio = de === mes && (ate.slice(0, 7) === de.slice(0, 7))

  const todos = await db.query.users.findMany({
    where: and(eq(users.empresaId, empresaId), eq(users.isActive, true), ne(users.canalVenda, 'nenhum')),
    columns: { id: true, name: true, fotoUrl: true, canalVenda: true },
  })
  const membros = somenteVendedorId ? todos.filter((m) => m.id === somenteVendedorId) : todos
  const ids = membros.map((m) => m.id)
  const vazio = !ids.length

  const [ordensP, ordensEmpresa, visitasP, propostasP, leadsP, aguardando, tentativas, vendasP, contatosP, orcamentos, metas, metaEmpresa] = await Promise.all([
    vazio
      ? []
      : db
          .select({ vendedorId: ordens.vendedorId, valor: ordemDetalhes.valorPedido })
          .from(ordens)
          .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
          .where(and(eq(ordens.empresaId, empresaId), inArray(ordens.vendedorId, ids), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, utc.de), lt(ordens.createdAt, utc.ate))),
    somenteVendedorId
      ? []
      : db
          .select({ vendedorId: ordens.vendedorId, valor: ordemDetalhes.valorPedido })
          .from(ordens)
          .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
          .where(and(eq(ordens.empresaId, empresaId), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, utc.de), lt(ordens.createdAt, utc.ate))),
    vazio
      ? []
      : db.query.visitas.findMany({
          where: and(eq(visitas.empresaId, empresaId), inArray(visitas.vendedorId, ids), gte(visitas.dataVisita, de), lt(visitas.dataVisita, fimExclusivo)),
          columns: { vendedorId: true, latCheckin: true, convertidoParaPropostaId: true },
        }),
    vazio
      ? []
      : db.query.propostas.findMany({
          where: and(eq(propostas.empresaId, empresaId), inArray(propostas.vendedorId, ids), gte(propostas.createdAt, utc.de), lt(propostas.createdAt, utc.ate)),
          columns: { vendedorId: true, convertidoParaOrdemId: true },
        }),
    vazio
      ? []
      : db.query.leads.findMany({
          where: and(eq(leads.empresaId, empresaId), inArray(leads.vendorId, ids), gte(leads.createdAt, utc.de), lt(leads.createdAt, utc.ate)),
          columns: { id: true, vendorId: true, status: true },
        }),
    vazio
      ? []
      : db.query.leads.findMany({
          where: and(eq(leads.empresaId, empresaId), inArray(leads.vendorId, ids), inArray(leads.status, ['novo', 'novo_consumidor_final'])),
          columns: { vendorId: true },
        }),
    vazio
      ? []
      : db.query.leadContactAttempts.findMany({
          where: and(inArray(leadContactAttempts.userId, ids), gte(leadContactAttempts.createdAt, utc.de), lt(leadContactAttempts.createdAt, utc.ate)),
          columns: { userId: true, leadId: true },
        }),
    vazio
      ? []
      : db.query.vendas.findMany({
          where: and(inArray(vendas.vendedorId, ids), isNull(vendas.deletedAt), gte(vendas.dataFechamento, utc.de), lt(vendas.dataFechamento, utc.ate)),
          columns: { vendedorId: true, valorFechado: true, clienteId: true },
        }),
    vazio
      ? []
      : db
          .select({ vendedorId: registroContato.vendedorId, tipo: registroContato.tipo, clienteId: funilMensal.clienteId })
          .from(registroContato)
          .innerJoin(funilMensal, eq(funilMensal.id, registroContato.funilMensalId))
          .where(and(inArray(registroContato.vendedorId, ids), isNull(registroContato.deletedAt), gte(registroContato.dataHora, utc.de), lt(registroContato.dataHora, utc.ate))),
    vazio
      ? []
      : db.query.funilMensal.findMany({
          where: and(inArray(funilMensal.vendedorId, ids), eq(funilMensal.etapa, 'negociacao'), eq(funilMensal.mesReferencia, mes), isNull(funilMensal.deletedAt)),
          columns: { vendedorId: true, valorOrcado: true },
        }),
    metasVigentesPorVendedor(mes),
    getConfigNumero(`meta_faturamento_empresa_${empresaId}`, 0),
  ])

  const doVendedor = <T, K extends keyof T>(l: T[], campo: K, id: number) => l.filter((x) => x[campo] === (id as T[K]))
  const meta = (id: number) => {
    const m = metas.get(id)?.metaFaturamento
    return m && m > 0 ? m : null
  }
  const base = (m: (typeof membros)[number]) => ({ id: m.id, nome: m.name, fotoUrl: m.fotoUrl })
  const daFrente = (f: FrenteOdin) => membros.filter((m) => m.canalVenda === CANAL[f])

  const externos = daFrente('externos').map((m) => {
    const vis = doVendedor(visitasP, 'vendedorId', m.id)
    const props = doVendedor(propostasP, 'vendedorId', m.id)
    const peds = doVendedor(ordensP, 'vendedorId', m.id)
    return {
      ...base(m),
      visitas: vis.length,
      visitasGps: vis.filter((v) => v.latCheckin != null).length,
      propostas: props.length,
      pedidos: peds.length,
      valorVendido: soma(peds, (o) => o.valor ?? 0),
      conversaoVisitaProposta: pct(vis.filter((v) => v.convertidoParaPropostaId != null).length, vis.length),
      conversaoPropostaPedido: pct(props.filter((p) => p.convertidoParaOrdemId != null).length, props.length),
    }
  })

  const leadsFrente = daFrente('leads').map((m) => {
    const recebidos = doVendedor(leadsP, 'vendorId', m.id)
    const tent = doVendedor(tentativas, 'userId', m.id)
    const idsRecebidos = new Set(recebidos.map((l) => l.id))
    const atendidos = new Set(tent.filter((t) => idsRecebidos.has(t.leadId)).map((t) => t.leadId)).size
    const props = doVendedor(propostasP, 'vendedorId', m.id)
    const peds = doVendedor(ordensP, 'vendedorId', m.id)
    const vendido = soma(peds, (o) => o.valor ?? 0)
    const metaDele = meta(m.id)
    return {
      ...base(m),
      leadsRecebidos: recebidos.length,
      leadsAtendidos: atendidos,
      aguardando: doVendedor(aguardando, 'vendorId', m.id).length,
      desqualificados: recebidos.filter((l) => l.status === 'desqualificado').length,
      contatos: tent.length,
      propostas: props.length,
      pedidos: peds.length,
      valorVendido: vendido,
      meta: metaDele,
      percentualMeta: metaDele ? pct(vendido, metaDele) : null,
      conversaoLeadPedido: pct(peds.length, recebidos.length),
    }
  })

  const pecas = await Promise.all(
    daFrente('pecas').map(async (m) => {
      const cont = doVendedor(contatosP, 'vendedorId', m.id)
      const vend = doVendedor(vendasP, 'vendedorId', m.id)
      const orcs = doVendedor(orcamentos, 'vendedorId', m.id)
      const cobertura = await coberturaContatosVendedor(empresaId, m.id, mes)
      const vendido = soma(vend, (v) => v.valorFechado)
      const metaDele = meta(m.id)
      return {
        ...base(m),
        carteira: cobertura.total,
        clientesContatados: cobertura.contatados,
        coberturaPercentual: cobertura.percentual,
        contatos: cont.length,
        ligacoes: cont.filter((c) => c.tipo === 'ligacao').length,
        whatsapp: cont.filter((c) => c.tipo === 'whatsapp').length,
        orcamentosAbertos: orcs.length,
        valorOrcamentosAbertos: soma(orcs, (o) => o.valorOrcado ?? 0),
        vendas: vend.length,
        clientesCompraram: new Set(vend.map((v) => v.clienteId)).size,
        valorVendido: vendido,
        meta: metaDele,
        percentualMeta: metaDele ? pct(vendido, metaDele) : null,
      }
    }),
  )

  const ordenarValor = <T extends { valorVendido: number; nome: string }>(l: T[]) => l.sort((a, b) => b.valorVendido - a.valorVendido || a.nome.localeCompare(b.nome))

  // Geral (só admin — vendedor não recebe o total da empresa).
  const diasUteisMes = diasUteisNoMes(mes)
  const ehMesAtual = mes === mesReferenciaAtual()
  const diasUteisAteHoje = ehMesAtual ? Math.min(diasUteisMes, diasUteisDecorridos(mes)) : diasUteisMes
  const faturamento = soma(ordensEmpresa, (o) => o.valor ?? 0)
  const canalDe = new Map(todos.map((m) => [m.id, m.canalVenda]))
  const somaCanal = (canal: string) => soma(ordensEmpresa.filter((o) => o.vendedorId != null && canalDe.get(o.vendedorId) === canal), (o) => o.valor ?? 0)
  const geral = somenteVendedorId
    ? null
    : {
        faturamento,
        pedidos: ordensEmpresa.length,
        ticketMedio: ordensEmpresa.length ? faturamento / ordensEmpresa.length : 0,
        meta: metaEmpresa > 0 && periodoEhMesCheio ? metaEmpresa : null,
        percentualMeta: metaEmpresa > 0 && periodoEhMesCheio ? pct(faturamento, metaEmpresa) : null,
        percentualIdealHoje: pct(diasUteisAteHoje, diasUteisMes),
        porFrente: {
          externos: somaCanal('visitas'),
          leads: somaCanal('leads'),
          // Venda de peças no Kanban vira pedido de peça (ordens) — no
          // faturamento da empresa ela já está somada por aqui.
          pecas: somaCanal('pecas'),
          semFrente: faturamento - somaCanal('visitas') - somaCanal('leads') - somaCanal('pecas'),
        },
      }

  return {
    de,
    ate,
    mes,
    geral,
    externos: ordenarValor(externos),
    leads: ordenarValor(leadsFrente),
    pecas: ordenarValor(pecas),
  }
}

// Só os totais (pra comparação com o período anterior).
export async function totaisResultadosOdin(empresaId: number, de: string, ate: string, somenteVendedorId?: number) {
  const r = await resultadosOdin(empresaId, de, ate, somenteVendedorId)
  return {
    geral: r.geral ? { faturamento: r.geral.faturamento, pedidos: r.geral.pedidos, ticketMedio: r.geral.ticketMedio } : null,
    externos: { visitas: soma(r.externos, (v) => v.visitas), propostas: soma(r.externos, (v) => v.propostas), pedidos: soma(r.externos, (v) => v.pedidos), valorVendido: soma(r.externos, (v) => v.valorVendido) },
    leads: {
      leadsRecebidos: soma(r.leads, (v) => v.leadsRecebidos),
      contatos: soma(r.leads, (v) => v.contatos),
      propostas: soma(r.leads, (v) => v.propostas),
      pedidos: soma(r.leads, (v) => v.pedidos),
      valorVendido: soma(r.leads, (v) => v.valorVendido),
    },
    pecas: { contatos: soma(r.pecas, (v) => v.contatos), ligacoes: soma(r.pecas, (v) => v.ligacoes), vendas: soma(r.pecas, (v) => v.vendas), valorVendido: soma(r.pecas, (v) => v.valorVendido) },
  }
}
