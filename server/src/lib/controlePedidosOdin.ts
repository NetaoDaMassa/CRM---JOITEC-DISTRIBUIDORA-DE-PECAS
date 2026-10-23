// Controle de Pedidos (Odin Compressores) — tela operacional, refeita a
// pedido do João (2026-10-23). Era o "Dashboard Odin", que misturava
// resultado de vendas com operação; resultado foi pra "Resultados Odin"
// (lib/resultadosOdin.ts) e aqui ficou só a pergunta do dia a dia:
// "onde está cada pedido AGORA, o que está parado e o que andou".
//
//  - Em andamento: TODOS os pedidos ativos, de qualquer data (antes o filtro
//    do mês escondia pedido criado no mês passado que ainda não saiu).
//  - Tempo na etapa: desde a última mudança pra etapa atual
//    (ordem_historico); sem histórico, desde a criação. Mesmos limites de
//    alerta do Kanban (OrdensBoard.nivelAlerta): coleta > 24h e preparação
//    > 72h = vermelho; qualquer etapa > 48h = laranja.
//  - No período: entraram, faturados (mesma regra do Painel Financeiro,
//    lib/faturamentoOdin.ts), concluídos, cancelados e ciclo médio.
import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { ordemDetalhes, ordemHistorico, ordens, users } from '../db/schema.js'
import { buscarOrdensFaturadas } from './faturamentoOdin.js'

const ETAPA_FINAL = 'pos_venda'
const ETAPAS_EXPEDICAO = ['coleta', 'rastreio']

const utcParaMs = (s: string) => new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime()
const proximoDia = (dia: string) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)

function nivelAlerta(stage: string, horas: number): 'vermelho' | 'laranja' | null {
  if (stage === 'coleta' && horas > 24) return 'vermelho'
  if (stage === 'preparacao' && horas > 72) return 'vermelho'
  if (horas > 48) return 'laranja'
  return null
}

export async function controlePedidosOdin(empresaId: number, de: string, ate: string, vendedorId?: number) {
  const utc = { de: `${de} 03:00:00`, ate: `${proximoDia(ate)} 03:00:00` }
  const agora = Date.now()
  const doVendedor = vendedorId ? [eq(ordens.vendedorId, vendedorId)] : []

  const ativos = await db.query.ordens.findMany({
    where: and(eq(ordens.empresaId, empresaId), eq(ordens.status, 'ativo'), ne(ordens.stage, ETAPA_FINAL), ...doVendedor),
    columns: { id: true, stage: true, orderType: true, createdAt: true, pausadoEm: true, pausadoMotivo: true },
    with: { cliente: { columns: { razaoSocial: true } }, vendedor: { columns: { name: true } } },
  })
  const idsAtivos = ativos.map((o) => o.id)
  const [detalhes, entradas] = idsAtivos.length
    ? await Promise.all([
        db.query.ordemDetalhes.findMany({
          where: inArray(ordemDetalhes.ordemId, idsAtivos),
          columns: { ordemId: true, valorPedido: true, numeroPedido: true, prioridadeDespacho: true },
        }),
        db
          .select({ ordemId: ordemHistorico.ordemId, novo: ordemHistorico.newValue, em: ordemHistorico.createdAt })
          .from(ordemHistorico)
          .where(and(inArray(ordemHistorico.ordemId, idsAtivos), eq(ordemHistorico.action, 'stage_change'), eq(ordemHistorico.fieldName, 'stage'))),
      ])
    : [[], []]
  const detalhePor = new Map(detalhes.map((d) => [d.ordemId, d]))
  // Última vez que o pedido entrou na etapa em que está agora.
  const entrouPor = new Map<number, string>()
  for (const e of entradas) {
    const o = ativos.find((x) => x.id === e.ordemId)
    if (!o || e.novo !== o.stage) continue
    if (e.em > (entrouPor.get(e.ordemId) ?? '')) entrouPor.set(e.ordemId, e.em)
  }

  const emAndamento = ativos
    .map((o) => {
      const d = detalhePor.get(o.id)
      const entrou = entrouPor.get(o.id) ?? o.createdAt
      const horasNaEtapa = Math.max(0, Math.round(((agora - utcParaMs(entrou)) / 3_600_000) * 10) / 10)
      return {
        id: o.id,
        numeroPedido: d?.numeroPedido ?? null,
        tipo: o.orderType,
        stage: o.stage,
        clienteNome: o.cliente?.razaoSocial ?? '—',
        vendedorNome: o.vendedor?.name ?? '—',
        valor: d?.valorPedido ?? null,
        prioridade: d?.prioridadeDespacho ?? null,
        pausado: !!o.pausadoEm,
        pausadoMotivo: o.pausadoMotivo,
        criadoEm: o.createdAt,
        diasDesdeCriacao: Math.floor((agora - utcParaMs(o.createdAt)) / 86_400_000),
        horasNaEtapa,
        alerta: o.pausadoEm ? null : nivelAlerta(o.stage, horasNaEtapa),
      }
    })
    .sort((a, b) => b.horasNaEtapa - a.horasNaEtapa)

  // ── No período ─────────────────────────────────────────────────────────
  const [novos, faturadasTodas, conclusoes, cancelados] = await Promise.all([
    db
      .select({ id: ordens.id, valor: ordemDetalhes.valorPedido })
      .from(ordens)
      .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
      .where(and(eq(ordens.empresaId, empresaId), ne(ordens.status, 'cancelado'), gte(ordens.createdAt, utc.de), lt(ordens.createdAt, utc.ate), ...doVendedor)),
    buscarOrdensFaturadas(empresaId),
    // Concluído = entrou em "Concluído" (entregue) no período.
    db
      .select({ ordemId: ordemHistorico.ordemId, em: ordemHistorico.createdAt, criadoEm: ordens.createdAt })
      .from(ordemHistorico)
      .innerJoin(ordens, eq(ordens.id, ordemHistorico.ordemId))
      .where(
        and(
          eq(ordens.empresaId, empresaId),
          eq(ordemHistorico.action, 'stage_change'),
          eq(ordemHistorico.fieldName, 'stage'),
          eq(ordemHistorico.newValue, 'concluido'),
          gte(ordemHistorico.createdAt, utc.de),
          lt(ordemHistorico.createdAt, utc.ate),
          ...doVendedor,
        ),
      ),
    db.query.ordens.findMany({
      where: and(eq(ordens.empresaId, empresaId), eq(ordens.status, 'cancelado'), gte(ordens.canceladoEm, utc.de), lt(ordens.canceladoEm, utc.ate), ...doVendedor),
      columns: { id: true },
    }),
  ])
  const faturadas = faturadasTodas.filter((o) => (!vendedorId || o.vendedorId === vendedorId) && o.dataRef >= utc.de && o.dataRef < utc.ate)
  const concluidosUnicos = new Map<number, { em: string; criadoEm: string }>()
  for (const c of conclusoes) if (!concluidosUnicos.has(c.ordemId)) concluidosUnicos.set(c.ordemId, c)
  const ciclos = [...concluidosUnicos.values()].map((c) => (utcParaMs(c.em) - utcParaMs(c.criadoEm)) / 86_400_000)

  // ── Últimas movimentações ──────────────────────────────────────────────
  const movs = await db
    .select({
      ordemId: ordemHistorico.ordemId,
      de: ordemHistorico.oldValue,
      para: ordemHistorico.newValue,
      em: ordemHistorico.createdAt,
      quem: users.name,
      tipo: ordens.orderType,
    })
    .from(ordemHistorico)
    .innerJoin(ordens, eq(ordens.id, ordemHistorico.ordemId))
    .leftJoin(users, eq(users.id, ordemHistorico.userId))
    .where(and(eq(ordens.empresaId, empresaId), eq(ordemHistorico.action, 'stage_change'), eq(ordemHistorico.fieldName, 'stage'), ...doVendedor))
    .orderBy(desc(ordemHistorico.createdAt))
    .limit(12)
  const idsMov = [...new Set(movs.map((m) => m.ordemId))]
  const clientesMov = idsMov.length
    ? await db.query.ordens.findMany({
        where: inArray(ordens.id, idsMov),
        columns: { id: true },
        with: { cliente: { columns: { razaoSocial: true } }, detalhes: { columns: { numeroPedido: true } } },
      })
    : []
  const clientePor = new Map(clientesMov.map((o) => [o.id, o.cliente?.razaoSocial ?? '—']))
  const numeroPor = new Map(clientesMov.map((o) => [o.id, o.detalhes?.numeroPedido ?? null]))

  const soma = (l: { valor: number | null }[]) => l.reduce((a, x) => a + (x.valor ?? 0), 0)
  return {
    agora: {
      total: emAndamento.length,
      maquinas: emAndamento.filter((o) => o.tipo === 'maquina').length,
      pecas: emAndamento.filter((o) => o.tipo === 'peca').length,
      valor: soma(emAndamento),
      parados: emAndamento.filter((o) => o.alerta === 'vermelho').length,
      demorando: emAndamento.filter((o) => o.alerta === 'laranja').length,
      pausados: emAndamento.filter((o) => o.pausado).length,
      emFaturamento: emAndamento.filter((o) => o.stage === 'faturamento').length,
      emExpedicao: emAndamento.filter((o) => ETAPAS_EXPEDICAO.includes(o.stage)).length,
      lista: emAndamento,
    },
    periodo: {
      de,
      ate,
      novos: { qtd: novos.length, valor: soma(novos) },
      faturados: { qtd: faturadas.length, valor: faturadas.reduce((a, o) => a + o.valor, 0) },
      concluidos: concluidosUnicos.size,
      cancelados: cancelados.length,
      cicloMedioDias: ciclos.length ? Math.round((ciclos.reduce((a, b) => a + b, 0) / ciclos.length) * 10) / 10 : null,
    },
    movimentacoes: movs.map((m) => ({ ...m, clienteNome: clientePor.get(m.ordemId) ?? '—', numeroPedido: numeroPor.get(m.ordemId) ?? null })),
  }
}
