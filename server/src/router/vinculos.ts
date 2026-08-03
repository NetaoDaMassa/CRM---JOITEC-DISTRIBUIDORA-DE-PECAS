import { z } from 'zod'
import { and, eq, or } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, clienteVinculos } from '../db/schema.js'

// Vínculo entre dois cadastros que são, na prática, a mesma empresa/pessoa
// (ex: matriz e filial, ou o mesmo cliente com CNPJs diferentes) — pedido
// direto do João pra não perder a visão de que são "o mesmo cliente" mesmo
// estando em cadastros separados. É só informativo: não mistura carteira,
// funil nem histórico dos dois.
async function autorizarCliente(clienteId: number, ctx: { empresaId: number; user: { id: number; role: string } }) {
  const cliente = await db.query.clientes.findFirst({
    where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, ctx.empresaId)),
  })
  if (!cliente) throw new Error('Cliente não encontrado')
  if (ctx.user.role !== 'admin' && cliente.vendedorAtualId !== ctx.user.id) throw new Error('Acesso negado')
  return cliente
}

export const vinculosRouter = router({
  listar: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    await autorizarCliente(input.clienteId, ctx)

    const linhas = await db.query.clienteVinculos.findMany({
      where: or(eq(clienteVinculos.clienteId, input.clienteId), eq(clienteVinculos.clienteVinculadoId, input.clienteId)),
    })

    const idsVinculados = linhas.map((l) => (l.clienteId === input.clienteId ? l.clienteVinculadoId : l.clienteId))
    if (idsVinculados.length === 0) return []

    const outros = await db.query.clientes.findMany({
      where: and(eq(clientes.empresaId, ctx.empresaId), or(...idsVinculados.map((id) => eq(clientes.id, id)))!),
      columns: { id: true, razaoSocial: true, codigo: true, cnpj: true },
      with: { vendedorAtual: { columns: { id: true, name: true } } },
    })

    return linhas.map((l) => {
      const outroId = l.clienteId === input.clienteId ? l.clienteVinculadoId : l.clienteId
      const outro = outros.find((o) => o.id === outroId)!
      return { vinculoId: l.id, ...outro }
    })
  }),

  vincular: protectedProcedure
    .input(z.object({ clienteId: z.number(), clienteVinculadoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (input.clienteId === input.clienteVinculadoId) throw new Error('Não é possível vincular o cliente a ele mesmo.')

      await autorizarCliente(input.clienteId, ctx)
      const outro = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteVinculadoId), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!outro) throw new Error('Cliente pra vincular não encontrado.')

      const existente = await db.query.clienteVinculos.findFirst({
        where: or(
          and(eq(clienteVinculos.clienteId, input.clienteId), eq(clienteVinculos.clienteVinculadoId, input.clienteVinculadoId)),
          and(eq(clienteVinculos.clienteId, input.clienteVinculadoId), eq(clienteVinculos.clienteVinculadoId, input.clienteId))
        ),
      })
      if (existente) throw new Error('Esses clientes já estão vinculados.')

      await db.insert(clienteVinculos).values({ clienteId: input.clienteId, clienteVinculadoId: input.clienteVinculadoId })
      return { success: true }
    }),

  desvincular: protectedProcedure.input(z.object({ vinculoId: z.number() })).mutation(async ({ ctx, input }) => {
    const vinculo = await db.query.clienteVinculos.findFirst({ where: eq(clienteVinculos.id, input.vinculoId) })
    if (!vinculo) throw new Error('Vínculo não encontrado')
    await autorizarCliente(vinculo.clienteId, ctx)

    await db.delete(clienteVinculos).where(eq(clienteVinculos.id, input.vinculoId))
    return { success: true }
  }),
})
