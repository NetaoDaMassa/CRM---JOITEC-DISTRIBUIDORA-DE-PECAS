import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sapImportacoes } from '../db/schema.js'

// Itens das notas de venda do SAP (sap_itens_historico) x itens lançados no
// CRM (itens_pedido): são as MESMAS vendas. Pra um item não contar 2x, no
// período que os lotes de itens do SAP cobrem (primeira até última nota
// importada da empresa) vale só o SAP — o item digitado/extraído do PDF no
// CRM fica de fora; fora desse período vale o CRM. Pedido do João,
// 2026-10-21.
export async function coberturaItensSap(empresaId: number): Promise<{ de: string; ate: string } | null> {
  const [r] = await db
    .select({ de: sql<string | null>`min(${sapImportacoes.dataInicio})`, ate: sql<string | null>`max(${sapImportacoes.dataFim})` })
    .from(sapImportacoes)
    .where(and(eq(sapImportacoes.empresaId, empresaId), eq(sapImportacoes.tipo, 'itens'), eq(sapImportacoes.ativo, true)))
  return r?.de && r?.ate ? { de: r.de, ate: r.ate } : null
}

// Data (YYYY-MM-DD, horário de Brasília) de um timestamp UTC do CRM cai
// dentro da cobertura?
export function dentroDaCobertura(cobertura: { de: string; ate: string } | null, dataUtc: string | null | undefined): boolean {
  if (!cobertura || !dataUtc) return false
  const d = new Date(`${dataUtc.replace(' ', 'T')}${dataUtc.length > 10 && !dataUtc.endsWith('Z') ? 'Z' : ''}`)
  if (Number.isNaN(d.getTime())) return false
  const dia = new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10)
  return dia >= cobertura.de && dia <= cobertura.ate
}

export function chaveItem(descricao: string): string {
  return descricao.trim().toUpperCase().replace(/\s+/g, ' ')
}
