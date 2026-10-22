import { and, count, eq, gte, inArray, isNull, lt, notInArray, sql, sum } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, compromissos, funilMensal, leads, registroContato, sapImportacoes, sapVendasHistorico, vendas } from '../db/schema.js'
import { toLocalDateKey, toUtcISO } from './businessHours.js'
import { diasUteisDecorridos, diasUteisNoMes, ehDiaNaoUtil, hojeBr, hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { metasVigentesPorVendedor } from './metasVigentes.js'
import { coberturaContatosEmpresa, coberturaContatosVendedor } from './coberturaContatos.js'
import { dataSapComoDatetime, pedidosPorCliente } from '../router/reports.js'

// "Painel do dia" no topo do Kanban (pedido do João, 2026-10-22 — opção A
// do mockup): o mês (cobertura + faturamento x meta), hoje (ligações x meta,
// 🔥 dias seguidos vendendo, agenda) e "precisa de você agora". O que dá pra
// tirar dos próprios cards do Kanban (orçamentos parados, WhatsApp sem
// confirmar, valor em negociação) é calculado no front, em cima dos cards
// que já estão na tela — aqui só vem o que não está nos cards.

const TERMINAIS_LEAD = ['ganho', 'perdido', 'desqualificado', 'consumidor_final'] as const
const localDe = (raw: string) => toLocalDateKey(toUtcISO(raw))

function mesAnterior(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`
}

// Mesma regra do 🔥 do Dashboard/Painel de TV (painel.ts): dias úteis
// seguidos com pelo menos 1 venda, contando pra trás a partir de hoje, dentro
// do mês. Hoje sem venda ainda não quebra a sequência.
function sequenciaDiasVendendo(dias: Set<string>, mes: string) {
  const [ano, m] = mes.split('-').map(Number)
  const inicioMes = new Date(Date.UTC(ano, m - 1, 1))
  const hoje = hojeBr()
  const chaveHoje = hoje.toISOString().slice(0, 10)
  let seq = 0
  const cursor = new Date(hoje)
  while (cursor >= inicioMes) {
    if (!ehDiaNaoUtil(cursor)) {
      const chave = cursor.toISOString().slice(0, 10)
      if (dias.has(chave)) seq++
      else if (chave !== chaveHoje) break
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return seq
}

export async function painelDoDia(empresaId: number, alvo: { vendedorId?: number; todos?: boolean }, mes: string = mesReferenciaAtual()) {
  const mesAtual = mes === mesReferenciaAtual()
  const hoje = hojeBrString()

  // Vendedores do painel: um só, ou (admin em "Todos") todos os donos de
  // carteira da empresa — mesmo conjunto de coberturaContatosEmpresa.
  let vendedorIds: number[]
  if (alvo.todos) {
    const donos = await db
      .selectDistinct({ id: clientes.vendedorAtualId })
      .from(clientes)
      .where(and(eq(clientes.empresaId, empresaId), eq(clientes.emProspeccao, false), isNull(clientes.deletedAt)))
    vendedorIds = donos.map((d) => d.id).filter((id): id is number => id != null)
  } else {
    vendedorIds = alvo.vendedorId ? [alvo.vendedorId] : []
  }
  const ids = vendedorIds.length ? vendedorIds : [-1]

  const cobertura = alvo.todos ? await coberturaContatosEmpresa(empresaId, mes) : await coberturaContatosVendedor(empresaId, ids[0], mes)

  // ── Faturamento x meta ────────────────────────────────────────────────
  // Mesma conta do Dashboard/Painel de TV: vendas do mês dos cards do
  // vendedor (funil_mensal.vendedorId).
  const vendasDoMes = async (m: string) => {
    const [r] = await db
      .select({ qtd: count(), valor: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(inArray(funilMensal.vendedorId, ids), eq(vendas.mesReferencia, m), isNull(vendas.deletedAt)))
    return { qtd: r?.qtd ?? 0, valor: r?.valor ?? 0 }
  }
  const perdidosDoMes = async (m: string) => {
    const [r] = await db
      .select({ qtd: count() })
      .from(funilMensal)
      .where(and(inArray(funilMensal.vendedorId, ids), eq(funilMensal.etapa, 'perdido'), eq(funilMensal.mesReferencia, m), isNull(funilMensal.deletedAt)))
    return r?.qtd ?? 0
  }
  const [vMes, vAnt, pMes, pAnt, metas] = await Promise.all([vendasDoMes(mes), vendasDoMes(mesAnterior(mes)), perdidosDoMes(mes), perdidosDoMes(mesAnterior(mes)), metasVigentesPorVendedor(mes)])
  const metaFaturamento = vendedorIds.reduce((s, id) => s + (metas.get(id)?.metaFaturamento ?? 0), 0) || null
  const metaLigacoesDia = vendedorIds.reduce((s, id) => s + (metas.get(id)?.metaLigacoesDia ?? 25), 0)
  const diasUteisMes = diasUteisNoMes(mes)
  const diasUteisAteHoje = Math.min(diasUteisMes, diasUteisDecorridos(mes))
  // Dias úteis que ainda sobram contando hoje (hoje ainda dá pra vender).
  const diasUteisRestantes = mesAtual ? Math.max(1, diasUteisMes - diasUteisAteHoje + 1) : 0
  const falta = metaFaturamento ? Math.max(0, metaFaturamento - vMes.valor) : 0
  // Taxa de conversão do Dashboard: vendas ÷ (vendas + perdidos) do mês.
  const conversao = (v: number, p: number) => (v + p > 0 ? (v / (v + p)) * 100 : null)

  // ── Hoje ──────────────────────────────────────────────────────────────
  // registro_contato.dataHora e compromissos.dataHora são UTC — busca uma
  // janela folgada e filtra pela data de Brasília.
  const desdeUtc = new Date(Date.now() - 36 * 3600000).toISOString().replace('T', ' ').slice(0, 19)
  const contatosRecentes = mesAtual
    ? await db
        .select({ tipo: registroContato.tipo, origem: registroContato.origem, resultado: registroContato.resultado, dataHora: registroContato.dataHora })
        .from(registroContato)
        .where(and(inArray(registroContato.vendedorId, ids), gte(registroContato.dataHora, desdeUtc), isNull(registroContato.deletedAt)))
    : []
  // Clique no WhatsApp/ligação automática só conta depois de confirmado
  // (mesma regra da cobertura).
  const deHoje = contatosRecentes.filter((c) => localDe(c.dataHora) === hoje && (c.origem === 'manual' || c.resultado != null))
  const ligacoesHoje = deHoje.filter((c) => c.tipo === 'ligacao').length

  let sequencia: number | null = null
  if (mesAtual && !alvo.todos) {
    const dias = await db
      .select({ dia: sql<string>`substr(${vendas.dataFechamento}, 1, 10)` })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(inArray(funilMensal.vendedorId, ids), gte(vendas.dataFechamento, `${mes.slice(0, 7)}-01 00:00:00`), isNull(vendas.deletedAt)))
      .groupBy(sql`substr(${vendas.dataFechamento}, 1, 10)`)
    sequencia = sequenciaDiasVendendo(new Set(dias.map((d) => d.dia)), mes)
  }

  const agoraUtc = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const compromissosAbertos = mesAtual
    ? await db.query.compromissos.findMany({
        where: and(
          inArray(compromissos.vendedorId, ids),
          isNull(compromissos.deletedAt),
          // hoje inteiro (feitos ou não) + atrasados não concluídos dos últimos 30 dias
          gte(compromissos.dataHora, new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19)),
          lt(compromissos.dataHora, new Date(Date.now() + 36 * 3600000).toISOString().replace('T', ' ').slice(0, 19)),
        ),
        columns: { id: true, titulo: true, tipo: true, dataHora: true, concluido: true, clienteId: true },
        with: { cliente: { columns: { razaoSocial: true } } },
        orderBy: (c, { asc }) => [asc(c.dataHora)],
      })
    : []
  const agendaHoje = compromissosAbertos
    .filter((c) => localDe(c.dataHora) === hoje)
    .map((c) => ({ id: c.id, titulo: c.titulo, tipo: c.tipo, dataHora: toUtcISO(c.dataHora), concluido: c.concluido, cliente: c.cliente?.razaoSocial ?? null, clienteId: c.clienteId }))
  const atrasados = compromissosAbertos.filter((c) => !c.concluido && c.dataHora < agoraUtc)

  // ── Leads do vendedor ─────────────────────────────────────────────────
  const leadsAbertos = mesAtual
    ? await db
        .select({ status: leads.status, nextContactAt: leads.nextContactAt })
        .from(leads)
        .where(and(eq(leads.empresaId, empresaId), inArray(leads.vendorId, ids), isNull(leads.deletedAt), notInArray(leads.status, [...TERMINAIS_LEAD])))
    : []
  const leadsNovos = leadsAbertos.filter((l) => l.status === 'novo').length
  const leadsAtrasados = leadsAbertos.filter((l) => l.status !== 'novo' && l.nextContactAt && l.nextContactAt.slice(0, 10) < hoje).length

  // ── Carteira: quem comprou no mês e quem parou de comprar ─────────────
  // Compras = vendas do CRM + histórico SAP + Pedidos da Odin +
  // clientes.dataUltimaCompra (mesma base da Positivação dos relatórios).
  const carteira = await db.query.clientes.findMany({
    where: and(eq(clientes.empresaId, empresaId), inArray(clientes.vendedorAtualId, ids), eq(clientes.emProspeccao, false), isNull(clientes.deletedAt)),
    columns: { id: true, dataUltimaCompra: true },
  })
  const ultima = new Map<number, string>()
  const comprouNoMes = new Set<number>()
  const fimMes = `${mes.slice(0, 7)}-31`
  const registrar = (id: number, dataLocal: string) => {
    if (dataLocal > fimMes) return
    if (dataLocal >= mes) comprouNoMes.add(id)
    if (!ultima.has(id) || dataLocal > ultima.get(id)!) ultima.set(id, dataLocal)
  }
  for (const c of carteira) if (c.dataUltimaCompra) registrar(c.id, localDe(c.dataUltimaCompra))
  const idsCarteira = carteira.map((c) => c.id)
  for (let i = 0; i < idsCarteira.length; i += 900) {
    const lote = idsCarteira.slice(i, i + 900)
    const crm = await db
      .select({ clienteId: vendas.clienteId, data: vendas.dataFechamento })
      .from(vendas)
      .where(and(inArray(vendas.clienteId, lote), isNull(vendas.deletedAt)))
    for (const v of crm) if (v.data) registrar(v.clienteId, localDe(v.data))
    const sap = await db
      .select({ clienteId: sapVendasHistorico.clienteId, data: sapVendasHistorico.dataPedido })
      .from(sapVendasHistorico)
      .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapVendasHistorico.importacaoId))
      .where(and(inArray(sapVendasHistorico.clienteId, lote), eq(sapImportacoes.ativo, true)))
    for (const v of sap) registrar(v.clienteId, dataSapComoDatetime(v.data).slice(0, 10))
    for (const v of await pedidosPorCliente(lote)) registrar(v.clienteId, v.data.slice(0, 10))
  }
  // "Parou de comprar": comprou nos últimos 12 meses, mas não nos últimos 60 dias.
  const dia = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
  const pararamDeComprar = [...ultima.entries()].filter(([, d]) => d < dia(60) && d >= dia(365)).map(([id]) => id)

  return {
    mesAtual,
    hoje,
    cobertura,
    faturamento: {
      valor: vMes.valor,
      qtdVendas: vMes.qtd,
      ticket: vMes.qtd ? vMes.valor / vMes.qtd : 0,
      meta: metaFaturamento,
      percentualMeta: metaFaturamento ? (vMes.valor / metaFaturamento) * 100 : null,
      percentualIdealHoje: diasUteisMes ? (diasUteisAteHoje / diasUteisMes) * 100 : 0,
      falta,
      diasUteisRestantes,
      faltaPorDia: diasUteisRestantes ? falta / diasUteisRestantes : 0,
    },
    conversao: { atual: conversao(vMes.qtd, pMes), anterior: conversao(vAnt.qtd, pAnt) },
    positivacao: { compraram: comprouNoMes.size, carteira: carteira.length },
    hojeInfo: {
      ligacoes: ligacoesHoje,
      contatos: deHoje.length,
      metaLigacoesDia,
      sequenciaDiasVendendo: sequencia,
      diaUtil: !ehDiaNaoUtil(hojeBr()),
    },
    agendaHoje,
    urgencias: {
      leadsNovos,
      leadsAtrasados,
      compromissosAtrasados: atrasados.length,
      clientesCompromissosAtrasados: [...new Set(atrasados.map((c) => c.clienteId).filter((id): id is number => id != null))],
      pararamDeComprar,
    },
  }
}
