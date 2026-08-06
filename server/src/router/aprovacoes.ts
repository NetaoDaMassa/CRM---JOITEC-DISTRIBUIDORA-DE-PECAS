import { z } from 'zod'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, solicitacoesCarteira, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { transferirCliente, validarVendedorDaEmpresa, moverClienteParaBanco } from './carteira.js'

// Pedidos do vendedor pra descartar ou transferir um cliente da própria
// carteira — ficam pendentes até o admin aprovar (aplica a ação de verdade)
// ou recusar (nada muda, cliente continua normal no Kanban de quem pediu).
export const aprovacoesRouter = router({
  solicitar: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        tipo: z.enum(['descartar', 'transferir']),
        motivo: z.string().min(1, 'Explique o motivo do pedido'),
        comprovantePath: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId), isNull(clientes.deletedAt)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')
      if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
      if (input.tipo === 'descartar' && !input.comprovantePath) {
        throw new Error('Anexe o print/imagem comprovando o motivo do descarte.')
      }

      const existente = await db.query.solicitacoesCarteira.findFirst({
        where: and(eq(solicitacoesCarteira.clienteId, input.clienteId), eq(solicitacoesCarteira.status, 'pendente')),
      })
      if (existente) throw new Error('Já existe um pedido pendente pra este cliente.')

      await db.insert(solicitacoesCarteira).values({
        clienteId: input.clienteId,
        vendedorSolicitanteId: ctx.user.id,
        tipo: input.tipo,
        motivo: input.motivo,
        comprovantePath: input.comprovantePath,
      })
      return { success: true }
    }),

  pendentePorCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ input }) => {
    return (
      (await db.query.solicitacoesCarteira.findFirst({
        where: and(eq(solicitacoesCarteira.clienteId, input.clienteId), eq(solicitacoesCarteira.status, 'pendente')),
      })) ?? null
    )
  }),

  listarPendentes: adminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: solicitacoesCarteira.id,
        tipo: solicitacoesCarteira.tipo,
        motivo: solicitacoesCarteira.motivo,
        comprovantePath: solicitacoesCarteira.comprovantePath,
        createdAt: solicitacoesCarteira.createdAt,
        clienteId: clientes.id,
        clienteRazaoSocial: clientes.razaoSocial,
        clienteCodigo: clientes.codigo,
        vendedorSolicitanteId: users.id,
        vendedorSolicitanteNome: users.name,
      })
      .from(solicitacoesCarteira)
      .innerJoin(clientes, eq(solicitacoesCarteira.clienteId, clientes.id))
      .innerJoin(users, eq(solicitacoesCarteira.vendedorSolicitanteId, users.id))
      .where(and(eq(solicitacoesCarteira.status, 'pendente'), eq(clientes.empresaId, ctx.empresaId)))
      .orderBy(asc(solicitacoesCarteira.createdAt))
  }),

  aprovar: adminProcedure
    .input(z.object({ id: z.number(), vendedorDestinoId: z.number().optional(), paraBanco: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesCarteira.findFirst({ where: eq(solicitacoesCarteira.id, input.id) })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, solicitacao.clienteId), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')

      if (solicitacao.tipo === 'descartar') {
        await db
          .update(clientes)
          .set({
            deletedAt: agoraSqlite(),
            motivoExclusao: solicitacao.motivo,
            comprovanteExclusaoPath: solicitacao.comprovantePath,
          })
          .where(eq(clientes.id, cliente.id))
        await registrarAuditoria({
          tabela: 'clientes',
          registroId: cliente.id,
          acao: 'excluir',
          campo: 'motivo_exclusao',
          valorNovo: solicitacao.motivo,
          alteradoPor: ctx.user.id,
        })
      } else if (input.paraBanco) {
        // Rotula com o nome de quem estava com o cliente antes — mesmo padrão
        // já usado quando o admin move manualmente em Carteira.tsx, pra dar
        // pra filtrar depois em Banco de Clientes "veio de quem".
        const vendedorAnterior = cliente.vendedorAtualId
          ? await db.query.users.findFirst({ where: eq(users.id, cliente.vendedorAtualId), columns: { name: true } })
          : null
        await moverClienteParaBanco(cliente.id, vendedorAnterior?.name, ctx.user.id)
      } else {
        if (!input.vendedorDestinoId) throw new Error('Escolha o vendedor de destino ou envie pro Banco de Clientes.')
        await validarVendedorDaEmpresa(input.vendedorDestinoId, ctx.empresaId)
        await transferirCliente(cliente.id, input.vendedorDestinoId, ctx.user.id)
      }

      await db
        .update(solicitacoesCarteira)
        .set({
          status: 'aprovado',
          vendedorDestinoId: solicitacao.tipo === 'transferir' ? input.vendedorDestinoId : null,
          decididoPor: ctx.user.id,
          decididoEm: agoraSqlite(),
        })
        .where(eq(solicitacoesCarteira.id, input.id))

      return { success: true }
    }),

  recusar: adminProcedure
    .input(z.object({ id: z.number(), respostaObservacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const solicitacao = await db.query.solicitacoesCarteira.findFirst({ where: eq(solicitacoesCarteira.id, input.id) })
      if (!solicitacao) throw new Error('Pedido não encontrado')
      if (solicitacao.status !== 'pendente') throw new Error('Este pedido já foi decidido.')

      await db
        .update(solicitacoesCarteira)
        .set({
          status: 'recusado',
          respostaObservacao: input.respostaObservacao,
          decididoPor: ctx.user.id,
          decididoEm: agoraSqlite(),
        })
        .where(eq(solicitacoesCarteira.id, input.id))

      return { success: true }
    }),
})
