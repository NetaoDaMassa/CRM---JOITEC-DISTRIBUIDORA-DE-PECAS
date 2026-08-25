import { count } from 'drizzle-orm'
import { db } from '../db/client.js'
import { devolucaoChamados } from '../db/schema.js'
import { hojeBr } from './dataBr.js'

// Prefixo por empresa, igual ao sistema original (JOI/ODTC/ODC/CPT) — só
// muda o id de referência (lá era slug fixo, aqui é o empresaId real do
// CRM). Liberado pra todas as empresas a pedido do João — as 3 últimas
// (Joitec Automação, Comprefer, Compretec E-commerce) nunca tinham usado
// esse fluxo antes.
const PREFIXO_POR_EMPRESA: Record<number, string> = {
  1: 'JOI', // Joitec Distribuidora de Peças
  2: 'ODTC', // Odin Tubos e Conexões
  3: 'JTA', // Joitec Automação
  4: 'ODC', // Odin Compressores
  5: 'CPR', // Comprefer
  6: 'CPE', // Compretec E-commerce
  7: 'CPT', // Compretec Loja Física
}

export const EMPRESAS_DEVOLUCAO = Object.keys(PREFIXO_POR_EMPRESA).map(Number)

export function prefixoDevolucao(empresaId: number): string {
  return PREFIXO_POR_EMPRESA[empresaId] ?? 'DEV'
}

// Sequência global (não por empresa/ano, igual ao original) — conta quantos
// chamados já existem e usa +1. Corrida rara nesse volume de uso (poucos
// usuários internos), sem fila de espera formal como um pedido de venda.
export async function gerarProtocoloDevolucao(empresaId: number): Promise<string> {
  const [{ total }] = await db.select({ total: count() }).from(devolucaoChamados)
  const ano = hojeBr().getUTCFullYear()
  const seq = String(total + 1).padStart(5, '0')
  return `${prefixoDevolucao(empresaId)}-${ano}-${seq}`
}
