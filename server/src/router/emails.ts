import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, clienteEmails } from '../db/schema.js'

// Confere que o cliente existe, pertence à empresa do contexto, e que quem
// chamou pode mexer nele (admin, ou o vendedor dono da carteira) — mesma
// regra já usada em `clientes.update`/`telefones.ts`.
async function autorizarCliente(clienteId: number, ctx: { empresaId: number; user: { id: number; role: string } }) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, ctx.empresaId)),
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
  return cliente
}

export const emailsRouter = router({
  listarPorCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await autorizarCliente(input.clienteId, ctx)
    return db.query.clienteEmails.findMany({
      where: eq(clienteEmails.clienteId, input.clienteId),
      orderBy: (e, { asc }) => [asc(e.id)],
    })
  }),

  adicionar: protectedProcedure
    .input(z.object({ clienteId: z.number(), email: z.string().email('Informe um e-mail válido'), rotulo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await autorizarCliente(input.clienteId, ctx)
      const result = await db.insert(clienteEmails).values({
        clienteId: input.clienteId,
        email: input.email,
        rotulo: input.rotulo || null,
      })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizar: protectedProcedure
    .input(z.object({ id: z.number(), email: z.string().email('Informe um e-mail válido'), rotulo: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const email = await db.query.clienteEmails.findFirst({ where: eq(clienteEmails.id, input.id) })
      if (!email) throw new Error('E-mail não encontrado')
      await autorizarCliente(email.clienteId, ctx)

      await db
        .update(clienteEmails)
        .set({ email: input.email, rotulo: input.rotulo || null })
        .where(eq(clienteEmails.id, input.id))
      return { success: true }
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const email = await db.query.clienteEmails.findFirst({ where: eq(clienteEmails.id, input.id) })
    if (!email) throw new Error('E-mail não encontrado')
    await autorizarCliente(email.clienteId, ctx)

    await db.delete(clienteEmails).where(eq(clienteEmails.id, input.id))
    return { success: true }
  }),
})
