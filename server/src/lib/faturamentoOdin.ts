// Regra única de "Faturamento" da Odin Compressores — pedido do João
// 2026-08-31/2026-09-04: um pedido (ordens) conta como faturado quando sua
// etapa atual é Faturamento ou qualquer etapa posterior do funil. O mês/dia
// de referência do faturamento é a data em que ENTROU na etapa Faturamento
// (ordemHistorico stage_change→faturamento), com fallback pro createdAt do
// pedido quando não existe esse registro (pedidos antigos, criados antes de
// esse histórico existir, ou que pularam a etapa).
//
// Extraído de financeiro.ts (calcularFaturamentoOrdensOdin) pra ser
// reaproveitado também pelo Dashboard Odin e pelo Painel de TV — mesma
// fonte de verdade em vez de duas contas que podem divergir (ver memória
// odin-faturamento-regra-migracao, que já corrigiu um desalinho desse
// tipo).
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { ordens, ordemDetalhes, ordemHistorico } from '../db/schema.js'

export const STAGES_FATURAMENTO_OU_DEPOIS = ['faturamento', 'conferencia', 'coleta', 'rastreio', 'qualidade', 'concluido', 'pos_venda']

export type OrdemFaturada = {
  id: number
  vendedorId: number | null
  valor: number
  /** Data/datetime em que o pedido entrou na etapa Faturamento (fallback createdAt) — usar pra filtrar por período/mês. */
  dataRef: string
}

// Busca TODOS os pedidos faturados (ou além) da empresa, sem filtro de
// período — quem chama filtra por `dataRef` conforme a necessidade (mês
// corrente, intervalo De/Até, por vendedor, etc.).
export async function buscarOrdensFaturadas(empresaId: number): Promise<OrdemFaturada[]> {
  const faturaveis = await db
    .select({ id: ordens.id, vendedorId: ordens.vendedorId, valor: ordemDetalhes.valorPedido, createdAt: ordens.createdAt })
    .from(ordens)
    .leftJoin(ordemDetalhes, eq(ordemDetalhes.ordemId, ordens.id))
    .where(and(eq(ordens.empresaId, empresaId), inArray(ordens.stage, STAGES_FATURAMENTO_OU_DEPOIS), ne(ordens.status, 'cancelado')))

  const ids = faturaveis.map((o) => o.id)
  const entradas = ids.length
    ? await db
        .select({ ordemId: ordemHistorico.ordemId, entrouEm: sql<string>`MIN(${ordemHistorico.createdAt})`.as('entrou_em') })
        .from(ordemHistorico)
        .where(
          and(
            inArray(ordemHistorico.ordemId, ids),
            eq(ordemHistorico.action, 'stage_change'),
            eq(ordemHistorico.fieldName, 'stage'),
            eq(ordemHistorico.newValue, 'faturamento')
          )
        )
        .groupBy(ordemHistorico.ordemId)
    : []
  const entrouEmPorOrdem = new Map(entradas.map((e) => [e.ordemId, e.entrouEm]))

  return faturaveis.map((o) => ({
    id: o.id,
    vendedorId: o.vendedorId,
    valor: o.valor ?? 0,
    dataRef: entrouEmPorOrdem.get(o.id) ?? o.createdAt,
  }))
}
