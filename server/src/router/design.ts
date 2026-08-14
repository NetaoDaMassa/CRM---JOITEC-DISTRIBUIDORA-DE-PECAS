import { z } from 'zod'
import { and, asc, desc, eq } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { solicitacoesDesign, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'

// Pedidos do vendedor pra equipe de marketing criar uma arte (comunicado,
// oferta ou banner) — ficam pendentes até o admin aprovar (libera pra
// marketing) ou recusar. Mesmo fluxo de `aprovacoes.ts`, só que sem nenhuma
// ação automática de sistema no aprovar (quem cria a arte é a marketing,
// fora daqui).
export const designRouter = router({
  solicitar: protectedProcedure
    .input(
      z.object({
        tipo: z.enum(['comunicado', 'oferta', 'banner']),
        descricao: z.string().min(1, 'Explique o que a arte precisa transmitir'),
        preco: z.string().optional(),
        produto: z.string().optional(),
        quantidade: z.string().optional(),
        dataLimiteEntrega: z.string().optional(),
        dataLimiteValidade: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.insert(solicitacoesDesign).values({
        vendedorSolicitanteId: ctx.user.id,
        tipo: input.tipo,
        descricao: input.descricao,
        preco: input.preco || null,
        produto: input.produto || null,
        quantidade: input.quantidade || null,
        dataLimiteEntrega: input.dataLimiteEntrega || null,
        dataLimiteValidade: input.dataLimiteValidade || null,
        observacoes: input.observacoes || null,
      })
      return { success: true }
    }),

  // Próprios pedidos do vendedor logado, mais recentes primeiro — pra ele
  // acompanhar o status sem precisar perguntar pro admin.
  minhas: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(solicitacoesDesign)
      .where(eq(solicitacoesDesign.vendedorSolicitanteId, ctx.user.id))
      .orderBy(desc(solicitacoesDesign.createdAt))
  }),

  listarPendentes: adminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: solicitacoesDesign.id,
        tipo: solicitacoesDesign.tipo,
        descricao: solicitacoesDesign.descricao,
        preco: solicitacoesDesign.preco,
        produto: solicitacoesDesign.produto,
        quantidade: solicitacoesDesign.quantidade,
        dataLimiteEntrega: solicitacoesDesign.dataLimiteEntrega,
        dataLimiteValidade: solicitacoesDesign.dataLimiteValidade,
        observacoes: solicitacoesDesign.observacoes,
        createdAt: solicitacoesDesign.createdAt,
        vendedorSolicitanteId: users.id,
        vendedorSolicitanteNome: users.name,
      })
      .from(solicitacoesDesign)
      .innerJoin(users, eq(solicitacoesDesign.vendedorSolicitanteId, users.id))
      .where(and(eq(solicitacoesDesign.status, 'pendente'), eq(users.empresaId, ctx.empresaId)))
      .orderBy(asc(solicitacoesDesign.createdAt))
  }),

  aprovar: adminProcedure
    .input(z.object({ id: z.number(), respostaObservacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({ where: eq(solicitacoesDesign.id, input.id) })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      await db
        .update(solicitacoesDesign)
        .set({
          status: 'aprovado',
          respostaObservacao: input.respostaObservacao,
          decididoPor: ctx.user.id,
          decididoEm: agoraSqlite(),
        })
        .where(eq(solicitacoesDesign.id, input.id))
      return { success: true }
    }),

  recusar: adminProcedure
    .input(z.object({ id: z.number(), respostaObservacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesDesign.findFirst({ where: eq(solicitacoesDesign.id, input.id) })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      await db
        .update(solicitacoesDesign)
        .set({
          status: 'recusado',
          respostaObservacao: input.respostaObservacao,
          decididoPor: ctx.user.id,
          decididoEm: agoraSqlite(),
        })
        .where(eq(solicitacoesDesign.id, input.id))
      return { success: true }
    }),
})
