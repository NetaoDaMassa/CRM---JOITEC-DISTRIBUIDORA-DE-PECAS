// Odin Compressores — Carteira da Bruna ("Pedido de Peças"): toda venda
// fechada por lá também vira um Pedido de verdade no módulo Pedidos
// (ordens, orderType='peca'), pra entrar no funil de Preparação → Frete →
// Faturamento → Coleta → Rastreio → Concluído → Pós-venda, e contar no
// faturamento da empresa (que já soma só por `ordens`, não por `vendas` —
// ver server/src/router/financeiro.ts). Pedido do João, 2026-09-01: antes
// os pedidos de peça da Bruna ficavam presos na Carteira, invisíveis pro
// resto do fluxo/faturamento.
import { db } from '../db/client.js'
import { empresas, ordens, ordemDetalhes, vendas } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { registrarHistoricoOrdem } from './ordensGates.js'
import { getStageSequence } from './ordensStages.js'

const SLUG_ODIN_COMPRESSORES = 'odin-compressores'

export async function criarOrdemPecaSeOdinCompressores(params: {
  empresaId: number
  vendaId: number
  clienteId: number
  vendedorId: number
  criadoPorId: number
  valorFechado: number
  numeroPedido: string | null
}): Promise<void> {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, params.empresaId) })
  if (empresa?.slug !== SLUG_ODIN_COMPRESSORES) return

  const stageInicial = getStageSequence('peca')[0]
  const result = await db.insert(ordens).values({
    empresaId: params.empresaId,
    clienteId: params.clienteId,
    vendedorId: params.vendedorId,
    criadoPor: params.criadoPorId,
    orderType: 'peca',
    stage: stageInicial,
  })
  const ordemId = Number(result.lastInsertRowid)

  await db.insert(ordemDetalhes).values({
    ordemId,
    numeroPedido: params.numeroPedido,
    valorPedido: params.valorFechado,
  })

  await registrarHistoricoOrdem({
    ordemId,
    userId: params.criadoPorId,
    action: 'create',
    description: 'Pedido criado automaticamente a partir da venda fechada na Carteira',
    stage: stageInicial,
  })

  await db.update(vendas).set({ convertidoParaOrdemId: ordemId }).where(eq(vendas.id, params.vendaId))
}
