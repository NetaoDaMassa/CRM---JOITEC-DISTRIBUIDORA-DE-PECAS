import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funilMensal, clientes, itensPedido, vendas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { validarClienteFaturamento } from './vinculos.js'

export const vendasRouter = router({
  // Cliente já fechou esse mês e comprou de novo — em vez de reabrir/mudar
  // etapa (o card continua "Fechado", é o mesmo relacionamento), só soma
  // mais uma venda ao mês dele. `moverEtapa` continua sendo o único jeito de
  // registrar a *primeira* venda (é o que efetivamente muda a etapa pra
  // "Fechado" e dispara a validação de "Novo" etc.).
  registrar: protectedProcedure
    .input(
      z.object({
        funilMensalId: z.number(),
        valorFechado: z.number(),
        condicaoPagamento: z.string().optional(),
        pdfPedidoPath: z.string(),
        clienteIdFaturamento: z.number().optional(),
        itens: z
          .array(
            z.object({
              descricao: z.string().min(1),
              quantidade: z.number().optional(),
              valorUnitario: z.number().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const funil = await db.query.funilMensal.findFirst({ where: eq(funilMensal.id, input.funilMensalId) })
      if (!funil) throw new Error('Card não encontrado')
      if (ctx.user.role !== 'admin' && funil.vendedorId !== ctx.user.id) throw new Error('Acesso negado')
      if (funil.etapa !== 'fechado') {
        throw new Error('Só é possível registrar uma venda adicional em um cliente que já fechou esse mês.')
      }

      const clienteFaturamentoId = input.clienteIdFaturamento ?? funil.clienteId
      if (clienteFaturamentoId !== funil.clienteId) {
        await validarClienteFaturamento(funil.clienteId, clienteFaturamentoId, ctx.empresaId)
      }

      const vendaResult = await db.insert(vendas).values({
        funilMensalId: funil.id,
        clienteId: clienteFaturamentoId,
        vendedorId: funil.vendedorId,
        mesReferencia: funil.mesReferencia,
        valorFechado: input.valorFechado,
        condicaoPagamento: input.condicaoPagamento ?? null,
        pdfPedidoPath: input.pdfPedidoPath,
      })
      const vendaId = Number(vendaResult.lastInsertRowid)

      if (input.itens?.length) {
        await db.insert(itensPedido).values(
          input.itens.map((item) => ({
            vendaId,
            clienteId: clienteFaturamentoId,
            descricao: item.descricao,
            quantidade: item.quantidade ?? null,
            valorUnitario: item.valorUnitario ?? null,
            valorTotal: item.quantidade != null && item.valorUnitario != null ? item.quantidade * item.valorUnitario : null,
          }))
        )
      }

      await db.update(clientes).set({ dataUltimaCompra: agoraSqlite() }).where(eq(clientes.id, clienteFaturamentoId))

      return { id: vendaId }
    }),

  // Corrige dados de uma venda já lançada (valor, condição de pagamento) —
  // pedido direto do João, pra não precisar apagar/refazer quando o
  // vendedor erra ou o valor muda depois do fechamento.
  editar: protectedProcedure
    .input(
      z.object({
        vendaId: z.number(),
        valorFechado: z.number().optional(),
        condicaoPagamento: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, input.vendaId) })
      if (!venda) throw new Error('Venda não encontrada')
      if (ctx.user.role !== 'admin' && venda.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db
        .update(vendas)
        .set({
          valorFechado: input.valorFechado ?? venda.valorFechado,
          condicaoPagamento: input.condicaoPagamento !== undefined ? input.condicaoPagamento || null : venda.condicaoPagamento,
        })
        .where(eq(vendas.id, input.vendaId))

      return { success: true }
    }),
})
