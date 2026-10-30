import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { sapConferenciaIgnorados, vendas } from '../db/schema.js'
import { conferenciaVendasSap, excluirVendaConferencia, ligarVendaAoPedido, pedidoSap } from '../lib/conferenciaVendasSap.js'
import { sincronizarVendasSap } from '../lib/sapVendasAuto.js'
import { dataSap } from '../lib/sapServiceLayer.js'

// Conferência SAP × CRM (ver lib/conferenciaVendasSap.ts). O vendedor vê e
// liga só as próprias vendas; excluir, criar e ignorar é do admin.
const mesInput = z.string().regex(/^\d{4}-\d{2}$/)

export const conferenciaSapRouter = router({
  obter: protectedProcedure
    .input(z.object({ mes: mesInput, vendedorId: z.number().optional(), atualizar: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const vendedorId = ctx.user.role === 'admin' ? input.vendedorId : ctx.user.id
      return conferenciaVendasSap(ctx.empresaId, input.mes, { vendedorId, atualizar: input.atualizar })
    }),

  ligar: protectedProcedure.input(z.object({ vendaId: z.number(), docEntry: z.number() })).mutation(async ({ ctx, input }) => {
    const venda = await db.query.vendas.findFirst({ where: eq(vendas.id, input.vendaId) })
    if (!venda) throw new Error('Venda não encontrada')
    if (ctx.user.role !== 'admin' && venda.vendedorId !== ctx.user.id) throw new Error('Acesso negado')
    return ligarVendaAoPedido(input.vendaId, input.docEntry, ctx.user.id)
  }),

  excluirVenda: adminProcedure.input(z.object({ vendaId: z.number(), motivo: z.string().trim().min(3, 'Escreva o motivo.') })).mutation(async ({ ctx, input }) => {
    return excluirVendaConferencia(input.vendaId, input.motivo, ctx.user.id)
  }),

  // Cria a venda a partir do pedido, com a mesma regra da venda automática
  // (card do mês do dono do cliente; liga se já houver venda manual parecida).
  criarVenda: adminProcedure.input(z.object({ docEntry: z.number() })).mutation(async ({ input }) => {
    const p = await pedidoSap(input.docEntry)
    if (p.Cancelled === 'tYES') throw new Error(`O pedido ${p.DocNum} está cancelado no SAP.`)
    const r = await sincronizarVendasSap({ desde: dataSap(p.DocDate), docEntries: [input.docEntry] })
    if (!r) throw new Error('Não deu pra ler o pedido no SAP.')
    if (r.semCliente.length) throw new Error(`O cliente ${r.semCliente[0].codigo} ${r.semCliente[0].nome} não está cadastrado na ${r.semCliente[0].empresa} — cadastre primeiro.`)
    if (r.semVendedor.length) throw new Error(`O cliente ${r.semVendedor[0].cliente} está sem vendedor na carteira — defina o vendedor primeiro.`)
    if (!r.criadas && !r.ligadas) throw new Error('Esse pedido já tem venda no CRM ou não é desta empresa.')
    return { criada: r.criadas > 0, ligada: r.ligadas > 0 }
  }),

  ignorar: adminProcedure
    .input(z.object({ tipo: z.enum(['venda', 'pedido']), referencia: z.number(), motivo: z.string().trim().min(3, 'Escreva o motivo.') }))
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(sapConferenciaIgnorados)
        .values({ empresaId: ctx.empresaId, tipo: input.tipo, referencia: input.referencia, motivo: input.motivo, ignoradoPor: ctx.user.id })
        .onConflictDoUpdate({ target: [sapConferenciaIgnorados.tipo, sapConferenciaIgnorados.referencia], set: { motivo: input.motivo, ignoradoPor: ctx.user.id } })
      return { ok: true }
    }),

  desfazerIgnorar: adminProcedure.input(z.object({ tipo: z.enum(['venda', 'pedido']), referencia: z.number() })).mutation(async ({ ctx, input }) => {
    await db
      .delete(sapConferenciaIgnorados)
      .where(and(eq(sapConferenciaIgnorados.empresaId, ctx.empresaId), eq(sapConferenciaIgnorados.tipo, input.tipo), eq(sapConferenciaIgnorados.referencia, input.referencia)))
    return { ok: true }
  }),
})
