import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { REGIAO_VALUES } from '../lib/regiao.js'

export async function validarVendedorDaEmpresa(vendedorId: number, empresaId: number) {
  const vendedor = await db.query.users.findFirst({ where: eq(users.id, vendedorId) })
  if (!vendedor || vendedor.empresaId !== empresaId) throw new Error('Vendedor inválido')
}

export async function transferirCliente(clienteId: number, novoVendedorId: number, alteradoPor: number) {
  const mesAtual = mesReferenciaAtual()
  await db.update(clientes).set({ vendedorAtualId: novoVendedorId }).where(eq(clientes.id, clienteId))
  await db.insert(carteiraHistorico).values({ clienteId, vendedorId: novoVendedorId })

  // O card do mês precisa acompanhar a transferência — senão o cliente some
  // do Kanban de todo mundo (o vendedor antigo não devia mais ver, e o novo
  // nunca chegava a ver, já que o card ficava com o vendedor_id de quem não
  // é mais o dono da carteira).
  const funilExistente = await db.query.funilMensal.findFirst({
    where: and(eq(funilMensal.clienteId, clienteId), eq(funilMensal.mesReferencia, mesAtual), isNull(funilMensal.deletedAt)),
  })
  if (funilExistente) {
    if (funilExistente.vendedorId !== novoVendedorId) {
      await db.update(funilMensal).set({ vendedorId: novoVendedorId }).where(eq(funilMensal.id, funilExistente.id))
    }
  } else {
    await db.insert(funilMensal).values({ clienteId, vendedorId: novoVendedorId, mesReferencia: mesAtual })
  }

  await registrarAuditoria({
    tabela: 'clientes',
    registroId: clienteId,
    acao: 'transferir_carteira',
    campo: 'vendedor_atual_id',
    valorNovo: String(novoVendedorId),
    alteradoPor,
  })
}

export const carteiraRouter = router({
  atribuirPorRegiao: adminProcedure
    .input(z.object({ regiao: z.enum(REGIAO_VALUES), vendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await validarVendedorDaEmpresa(input.vendedorId, ctx.empresaId)
      const semDono = await db.query.clientes.findMany({
        where: and(
          eq(clientes.regiao, input.regiao),
          isNull(clientes.vendedorAtualId),
          isNull(clientes.deletedAt),
          eq(clientes.empresaId, ctx.empresaId)
        ),
      })
      for (const cliente of semDono) {
        await transferirCliente(cliente.id, input.vendedorId, ctx.user.id)
      }
      return { quantidade: semDono.length }
    }),

  redistribuirCompleta: adminProcedure
    .input(z.object({ deVendedorId: z.number(), paraVendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await validarVendedorDaEmpresa(input.deVendedorId, ctx.empresaId)
      await validarVendedorDaEmpresa(input.paraVendedorId, ctx.empresaId)
      const clientesDoVendedor = await db.query.clientes.findMany({
        where: and(
          eq(clientes.vendedorAtualId, input.deVendedorId),
          isNull(clientes.deletedAt),
          eq(clientes.empresaId, ctx.empresaId)
        ),
      })
      for (const cliente of clientesDoVendedor) {
        await transferirCliente(cliente.id, input.paraVendedorId, ctx.user.id)
      }
      return { quantidade: clientesDoVendedor.length }
    }),

  transferirIndividual: adminProcedure
    .input(z.object({ clienteId: z.number(), vendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({
        where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)),
      })
      if (!cliente) throw new Error('Cliente não encontrado')
      await validarVendedorDaEmpresa(input.vendedorId, ctx.empresaId)

      await transferirCliente(input.clienteId, input.vendedorId, ctx.user.id)
      return { success: true }
    }),

  desativarVendedor: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await validarVendedorDaEmpresa(input.id, ctx.empresaId)

    const ativos = await db.query.clientes.findMany({
      where: and(eq(clientes.vendedorAtualId, input.id), isNull(clientes.deletedAt)),
      columns: { id: true },
    })
    if (ativos.length > 0) {
      throw new Error(`Este vendedor ainda tem ${ativos.length} cliente(s) na carteira. Redistribua antes de desativar.`)
    }

    await db.update(users).set({ isActive: false }).where(eq(users.id, input.id))
    return { success: true }
  }),
})
