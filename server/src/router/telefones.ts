import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, clienteTelefones } from '../db/schema.js'

// Confere que o cliente existe, pertence à empresa do contexto, e que quem
// chamou pode mexer nele (admin, ou o vendedor dono da carteira) — mesma
// regra já usada em `clientes.update`.
async function autorizarCliente(clienteId: number, ctx: { empresaId: number; user: { id: number; role: string } }) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, ctx.empresaId)),
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
  return cliente
}

export const telefonesRouter = router({
  listarPorCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await autorizarCliente(input.clienteId, ctx)
    return db.query.clienteTelefones.findMany({
      where: eq(clienteTelefones.clienteId, input.clienteId),
      orderBy: (t, { asc }) => [asc(t.id)],
    })
  }),

  adicionar: protectedProcedure
    .input(z.object({ clienteId: z.number(), numero: z.string().min(8, 'Informe um telefone válido'), rotulo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await autorizarCliente(input.clienteId, ctx)
      const result = await db.insert(clienteTelefones).values({
        clienteId: input.clienteId,
        numero: input.numero,
        rotulo: input.rotulo || null,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizar: protectedProcedure
    .input(z.object({ id: z.number(), numero: z.string().min(8, 'Informe um telefone válido'), rotulo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const telefone = await db.query.clienteTelefones.findFirst({ where: eq(clienteTelefones.id, input.id) })
      if (!telefone) throw new Error('Telefone não encontrado')
      await autorizarCliente(telefone.clienteId, ctx)

      await db
        .update(clienteTelefones)
        .set({ numero: input.numero, rotulo: input.rotulo || null })
        .where(eq(clienteTelefones.id, input.id))
      return { success: true }
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const telefone = await db.query.clienteTelefones.findFirst({ where: eq(clienteTelefones.id, input.id) })
    if (!telefone) throw new Error('Telefone não encontrado')
    await autorizarCliente(telefone.clienteId, ctx)

    await db.delete(clienteTelefones).where(eq(clienteTelefones.id, input.id))
    return { success: true }
  }),
})
