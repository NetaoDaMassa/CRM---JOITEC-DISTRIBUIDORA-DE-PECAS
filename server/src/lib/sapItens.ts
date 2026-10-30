import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { empresas, sapImportacoes, sapItensHistorico } from '../db/schema.js'

// Itens das notas de venda do SAP (sap_itens_historico) x itens lançados no
// CRM (itens_pedido): são as MESMAS vendas. Pra um item não contar 2x, no
// período que os lotes de itens do SAP cobrem (primeira até última nota
// importada da empresa) vale só o SAP — o item digitado/extraído do PDF no
// CRM fica de fora; fora desse período vale o CRM. Pedido do João,
// 2026-10-21.
//
// Na Odin Compressores o SAP só cobre a carteira da Bruna (ver
// lib/sapCompressores.ts): lá a regra vale só pros clientes que têm item do
// SAP (`clientes`) — o item do CRM dos outros continua contando.
export interface CoberturaItensSap {
  de: string
  ate: string
  clientes?: Set<number>
}

export async function coberturaItensSap(empresaId: number): Promise<CoberturaItensSap | null> {
  const [r] = await db
    .select({ de: sql<string | null>`min(${sapImportacoes.dataInicio})`, ate: sql<string | null>`max(${sapImportacoes.dataFim})` })
    .from(sapImportacoes)
    .where(and(eq(sapImportacoes.empresaId, empresaId), eq(sapImportacoes.tipo, 'itens'), eq(sapImportacoes.ativo, true)))
  if (!r?.de || !r?.ate) return null
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  if (empresa?.slug !== 'odin-compressores') return { de: r.de, ate: r.ate }
  const comItem = await db
    .selectDistinct({ clienteId: sapItensHistorico.clienteId })
    .from(sapItensHistorico)
    .innerJoin(sapImportacoes, eq(sapImportacoes.id, sapItensHistorico.importacaoId))
    .where(and(eq(sapItensHistorico.empresaId, empresaId), eq(sapImportacoes.ativo, true)))
  return { de: r.de, ate: r.ate, clientes: new Set(comItem.map((c) => c.clienteId)) }
}

// Data (YYYY-MM-DD, horário de Brasília) de um timestamp UTC do CRM cai
// dentro da cobertura (e, na Odin Compressores, o cliente é um dos cobertos)?
export function dentroDaCobertura(cobertura: CoberturaItensSap | null, dataUtc: string | null | undefined, clienteId?: number): boolean {
  if (!cobertura || !dataUtc) return false
  if (cobertura.clientes && (clienteId === undefined || !cobertura.clientes.has(clienteId))) return false
  const d = new Date(`${dataUtc.replace(' ', 'T')}${dataUtc.length > 10 && !dataUtc.endsWith('Z') ? 'Z' : ''}`)
  if (Number.isNaN(d.getTime())) return false
  const dia = new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10)
  return dia >= cobertura.de && dia <= cobertura.ate
}

export function chaveItem(descricao: string): string {
  return descricao.trim().toUpperCase().replace(/\s+/g, ' ')
}
