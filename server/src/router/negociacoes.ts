import { z } from 'zod'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { cobrancasRegistro, clientesCartorio, clientesRc, clientes } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'

async function validarCliente(clienteId: number, empresaId: number) {
  const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, clienteId), eq(clientes.empresaId, empresaId)) })
  if (!cliente) throw new Error('Cliente não encontrado')
}

// 3 planilhas do dia a dia de cobrança (Financeiro), pedido do João — todas
// cliente-scoped, sem empresaId próprio (isolamento vem do join em
// clientes.empresaId, mesmo padrão de boletos.ts).
export const negociacoesRouter = router({
  cobrancasListar: featureProcedure('negociacoes')
    .input(z.object({ dataDe: z.string().optional(), dataAte: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const condicoes = [eq(clientes.empresaId, ctx.empresaId)]
      if (input?.dataDe) condicoes.push(gte(cobrancasRegistro.dataVencimento, input.dataDe))
      if (input?.dataAte) condicoes.push(lte(cobrancasRegistro.dataVencimento, input.dataAte))

      const linhas = await db
        .select({
          id: cobrancasRegistro.id,
          canal: cobrancasRegistro.canal,
          retornoCliente: cobrancasRegistro.retornoCliente,
          valor: cobrancasRegistro.valor,
          dataVencimento: cobrancasRegistro.dataVencimento,
          status: cobrancasRegistro.status,
          createdAt: cobrancasRegistro.createdAt,
          clienteId: clientes.id,
          clienteNome: clientes.razaoSocial,
          registradoPorId: cobrancasRegistro.registradoPorId,
        })
        .from(cobrancasRegistro)
        .innerJoin(clientes, eq(cobrancasRegistro.clienteId, clientes.id))
        .where(and(...condicoes))
        .orderBy(desc(cobrancasRegistro.createdAt))
      return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
    }),

  cobrancaCriar: featureProcedure('negociacoes')
    .input(
      z.object({
        clienteId: z.number(),
        canal: z.enum(['whatsapp', 'ligacao', 'email']),
        retornoCliente: z.string().min(1),
        valor: z.number().positive().optional(),
        dataVencimento: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(cobrancasRegistro).values({
        clienteId: input.clienteId,
        canal: input.canal,
        retornoCliente: input.retornoCliente.trim(),
        valor: input.valor ?? null,
        dataVencimento: input.dataVencimento || null,
        registradoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  // Fecha o ciclo da cobrança: pago (encerra) ou movida pra Cartório/RC —
  // nesses 2 últimos casos já cria a linha correspondente lá, pra não
  // precisar cadastrar o cliente de novo na outra planilha.
  cobrancaMarcarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['pendente', 'pago', 'cartorio', 'rc']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.cobrancasRegistro.findFirst({ where: eq(cobrancasRegistro.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')

      await db.update(cobrancasRegistro).set({ status: input.status }).where(eq(cobrancasRegistro.id, input.id))

      if (input.status === 'cartorio') {
        await db.insert(clientesCartorio).values({
          clienteId: registro.clienteId,
          valor: registro.valor,
          enviadoEm: hojeBrString(),
          criadoPorId: ctx.user.id,
        })
      }
      if (input.status === 'rc') {
        await db.insert(clientesRc).values({
          clienteId: registro.clienteId,
          valor: registro.valor,
          enviadoEm: hojeBrString(),
          criadoPorId: ctx.user.id,
        })
      }
      return { success: true }
    }),

  cobrancaExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.cobrancasRegistro.findFirst({ where: eq(cobrancasRegistro.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(cobrancasRegistro).where(eq(cobrancasRegistro.id, input.id))
    return { success: true }
  }),

  cartorioListar: featureProcedure('negociacoes').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: clientesCartorio.id,
        valor: clientesCartorio.valor,
        enviadoEm: clientesCartorio.enviadoEm,
        status: clientesCartorio.status,
        observacoes: clientesCartorio.observacoes,
        updatedAt: clientesCartorio.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
      })
      .from(clientesCartorio)
      .innerJoin(clientes, eq(clientesCartorio.clienteId, clientes.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(clientesCartorio.updatedAt))
    return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
  }),

  cartorioCriar: featureProcedure('negociacoes')
    .input(z.object({ clienteId: z.number(), valor: z.number().positive().optional(), enviadoEm: z.string(), observacoes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(clientesCartorio).values({
        clienteId: input.clienteId,
        valor: input.valor ?? null,
        enviadoEm: input.enviadoEm,
        observacoes: input.observacoes || null,
        criadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  cartorioAtualizarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['aguardando', 'voltou_cobrar', 'cobranca_feita']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.clientesCartorio.findFirst({ where: eq(clientesCartorio.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(clientesCartorio).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(clientesCartorio.id, input.id))
      return { success: true }
    }),

  cartorioExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.clientesCartorio.findFirst({ where: eq(clientesCartorio.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(clientesCartorio).where(eq(clientesCartorio.id, input.id))
    return { success: true }
  }),

  rcListar: featureProcedure('negociacoes').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: clientesRc.id,
        valor: clientesRc.valor,
        enviadoEm: clientesRc.enviadoEm,
        status: clientesRc.status,
        observacoes: clientesRc.observacoes,
        updatedAt: clientesRc.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
      })
      .from(clientesRc)
      .innerJoin(clientes, eq(clientesRc.clienteId, clientes.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(clientesRc.updatedAt))
    return linhas.map((l) => ({ ...l, cliente: { id: l.clienteId, razaoSocial: l.clienteNome } }))
  }),

  rcCriar: featureProcedure('negociacoes')
    .input(z.object({ clienteId: z.number(), valor: z.number().positive().optional(), enviadoEm: z.string(), observacoes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await validarCliente(input.clienteId, ctx.empresaId)
      await db.insert(clientesRc).values({
        clienteId: input.clienteId,
        valor: input.valor ?? null,
        enviadoEm: input.enviadoEm,
        observacoes: input.observacoes || null,
        criadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  rcAtualizarStatus: featureProcedure('negociacoes')
    .input(z.object({ id: z.number(), status: z.enum(['em_negociacao', 'acordo_fechado', 'nao_fechou']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.clientesRc.findFirst({ where: eq(clientesRc.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(clientesRc).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(clientesRc.id, input.id))
      return { success: true }
    }),

  rcExcluir: featureProcedure('negociacoes').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.clientesRc.findFirst({ where: eq(clientesRc.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(clientesRc).where(eq(clientesRc.id, input.id))
    return { success: true }
  }),
})
