import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { funilMensal, clientes, itensPedido, vendas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

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

      const vendaResult = await db.insert(vendas).values({
        funilMensalId: funil.id,
        clienteId: funil.clienteId,
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
            clienteId: funil.clienteId,
            descricao: item.descricao,
            quantidade: item.quantidade ?? null,
            valorUnitario: item.valorUnitario ?? null,
            valorTotal: item.quantidade != null && item.valorUnitario != null ? item.quantidade * item.valorUnitario : null,
          }))
        )
      }

      await db.update(clientes).set({ dataUltimaCompra: agoraSqlite() }).where(eq(clientes.id, funil.clienteId))

      return { id: vendaId }
    }),
})
