import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { boletos, boletoAlteracoes, boletoPedidosAlteracao, clientes, users } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(d: string): string {
  const [ano, mes, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

export const boletosRouter = router({
  // Isolamento por empresa vem do join em clientes.empresaId (mesmo padrão
  // do resto do schema) — boletos não tem empresaId próprio.
  listar: featureProcedure('boletos').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: boletos.id,
        numeroBoleto: boletos.numeroBoleto,
        valorOriginal: boletos.valorOriginal,
        valorAtual: boletos.valorAtual,
        vencimento: boletos.vencimento,
        status: boletos.status,
        observacoes: boletos.observacoes,
        updatedAt: boletos.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
      })
      .from(boletos)
      .innerJoin(clientes, eq(boletos.clienteId, clientes.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(boletos.updatedAt))

    const hoje = hojeBrString()
    return linhas.map((b) => ({
      ...b,
      cliente: { id: b.clienteId, razaoSocial: b.clienteNome },
      vencido: b.status !== 'pago' && b.vencimento < hoje,
    }))
  }),

  historico: featureProcedure('boletos').input(z.object({ boletoId: z.number() })).query(async ({ input }) => {
    return db.query.boletoAlteracoes.findMany({
      where: eq(boletoAlteracoes.boletoId, input.boletoId),
      with: { alteradoPor: { columns: { id: true, name: true } } },
      orderBy: [desc(boletoAlteracoes.createdAt)],
    })
  }),

  criar: featureProcedure('boletos')
    .input(
      z.object({
        clienteId: z.number(),
        numeroBoleto: z.string().optional(),
        valorOriginal: z.number().positive(),
        vencimento: z.string(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
      if (!cliente) throw new Error('Cliente não encontrado')

      const result = await db.insert(boletos).values({
        clienteId: input.clienteId,
        numeroBoleto: input.numeroBoleto || null,
        valorOriginal: input.valorOriginal,
        valorAtual: input.valorOriginal,
        vencimento: input.vencimento,
        observacoes: input.observacoes || null,
        criadoPorId: ctx.user.id,
      })
      const boletoId = Number(result.lastInsertRowid)
      await db.insert(boletoAlteracoes).values({
        boletoId,
        tipo: 'criacao',
        valorNovo: formatarMoeda(input.valorOriginal),
        alteradoPorId: ctx.user.id,
      })
      return { success: true, id: boletoId }
    }),

  // Muda o valor atual (renegociação/desconto) — vira `status: 'renegociado'`
  // e fica registrado em boletoAlteracoes o de/para.
  alterarValor: featureProcedure('boletos')
    .input(z.object({ id: z.number(), novoValor: z.number().positive(), observacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const boleto = await db.query.boletos.findFirst({ where: eq(boletos.id, input.id), with: { cliente: true } })
      if (!boleto || boleto.cliente.empresaId !== ctx.empresaId) throw new Error('Boleto não encontrado')

      await db
        .update(boletos)
        .set({ valorAtual: input.novoValor, status: 'renegociado', updatedAt: agoraSqlite() })
        .where(eq(boletos.id, input.id))

      await db.insert(boletoAlteracoes).values({
        boletoId: input.id,
        tipo: 'valor',
        valorAnterior: formatarMoeda(boleto.valorAtual),
        valorNovo: formatarMoeda(input.novoValor),
        observacao: input.observacao || null,
        alteradoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  alterarVencimento: featureProcedure('boletos')
    .input(z.object({ id: z.number(), novoVencimento: z.string(), observacao: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const boleto = await db.query.boletos.findFirst({ where: eq(boletos.id, input.id), with: { cliente: true } })
      if (!boleto || boleto.cliente.empresaId !== ctx.empresaId) throw new Error('Boleto não encontrado')

      await db.update(boletos).set({ vencimento: input.novoVencimento, updatedAt: agoraSqlite() }).where(eq(boletos.id, input.id))

      await db.insert(boletoAlteracoes).values({
        boletoId: input.id,
        tipo: 'vencimento',
        valorAnterior: formatarData(boleto.vencimento),
        valorNovo: formatarData(input.novoVencimento),
        observacao: input.observacao || null,
        alteradoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  marcarPago: featureProcedure('boletos').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const boleto = await db.query.boletos.findFirst({ where: eq(boletos.id, input.id), with: { cliente: true } })
    if (!boleto || boleto.cliente.empresaId !== ctx.empresaId) throw new Error('Boleto não encontrado')

    await db.update(boletos).set({ status: 'pago', updatedAt: agoraSqlite() }).where(eq(boletos.id, input.id))
    await db.insert(boletoAlteracoes).values({
      boletoId: input.id,
      tipo: 'status',
      valorAnterior: boleto.status,
      valorNovo: 'pago',
      alteradoPorId: ctx.user.id,
    })
    return { success: true }
  }),

  excluir: featureProcedure('boletos').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const boleto = await db.query.boletos.findFirst({ where: eq(boletos.id, input.id), with: { cliente: true } })
    if (!boleto || boleto.cliente.empresaId !== ctx.empresaId) throw new Error('Boleto não encontrado')
    await db.delete(boletos).where(eq(boletos.id, input.id))
    return { success: true }
  }),

  // ── Pedidos de alteração (planilha do dia a dia) ─────────────────────
  // Cliente ou vendedor pede pra mudar data/valor ou cancelar um boleto,
  // fica registrado aqui como uma linha de planilha até o Financeiro
  // executar — diferente de `boletoAlteracoes`, que é o histórico do que já
  // foi de fato mudado num boleto formal.
  pedidosListar: featureProcedure('boletos').query(async ({ ctx }) => {
    const linhas = await db
      .select({
        id: boletoPedidosAlteracao.id,
        numeroBoleto: boletoPedidosAlteracao.numeroBoleto,
        valor: boletoPedidosAlteracao.valor,
        tipoAlteracao: boletoPedidosAlteracao.tipoAlteracao,
        descricao: boletoPedidosAlteracao.descricao,
        dataTroca: boletoPedidosAlteracao.dataTroca,
        status: boletoPedidosAlteracao.status,
        createdAt: boletoPedidosAlteracao.createdAt,
        updatedAt: boletoPedidosAlteracao.updatedAt,
        clienteId: clientes.id,
        clienteNome: clientes.razaoSocial,
        vendedorId: users.id,
        vendedorNome: users.name,
      })
      .from(boletoPedidosAlteracao)
      .innerJoin(clientes, eq(boletoPedidosAlteracao.clienteId, clientes.id))
      .innerJoin(users, eq(boletoPedidosAlteracao.criadoPorId, users.id))
      .where(eq(clientes.empresaId, ctx.empresaId))
      .orderBy(desc(boletoPedidosAlteracao.createdAt))
    return linhas.map((l) => ({
      ...l,
      cliente: { id: l.clienteId, razaoSocial: l.clienteNome },
      vendedor: { id: l.vendedorId, name: l.vendedorNome },
    }))
  }),

  pedidosCriar: featureProcedure('boletos')
    .input(
      z.object({
        clienteId: z.number(),
        numeroBoleto: z.string().optional(),
        valor: z.number().positive().optional(),
        tipoAlteracao: z.enum(['data', 'valor', 'cancelamento']),
        descricao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
      if (!cliente) throw new Error('Cliente não encontrado')
      await db.insert(boletoPedidosAlteracao).values({
        clienteId: input.clienteId,
        numeroBoleto: input.numeroBoleto || null,
        valor: input.valor,
        tipoAlteracao: input.tipoAlteracao,
        descricao: input.descricao?.trim() || null,
        criadoPorId: ctx.user.id,
      })
      return { success: true }
    }),

  // Data em que a troca foi de fato feita — separado do status pra não
  // obrigar preencher na hora de marcar "Finalizado" (o Financeiro às vezes
  // sabe a data exata só depois).
  pedidosAtualizarDataTroca: featureProcedure('boletos')
    .input(z.object({ id: z.number(), dataTroca: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.boletoPedidosAlteracao.findFirst({ where: eq(boletoPedidosAlteracao.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(boletoPedidosAlteracao).set({ dataTroca: input.dataTroca, updatedAt: agoraSqlite() }).where(eq(boletoPedidosAlteracao.id, input.id))
      return { success: true }
    }),

  pedidosAtualizarStatus: featureProcedure('boletos')
    .input(z.object({ id: z.number(), status: z.enum(['lancado', 'em_execucao', 'concluido']) }))
    .mutation(async ({ ctx, input }) => {
      const registro = await db.query.boletoPedidosAlteracao.findFirst({ where: eq(boletoPedidosAlteracao.id, input.id), with: { cliente: true } })
      if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
      await db.update(boletoPedidosAlteracao).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(boletoPedidosAlteracao.id, input.id))
      return { success: true }
    }),

  pedidosExcluir: featureProcedure('boletos').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const registro = await db.query.boletoPedidosAlteracao.findFirst({ where: eq(boletoPedidosAlteracao.id, input.id), with: { cliente: true } })
    if (!registro || registro.cliente.empresaId !== ctx.empresaId) throw new Error('Registro não encontrado')
    await db.delete(boletoPedidosAlteracao).where(eq(boletoPedidosAlteracao.id, input.id))
    return { success: true }
  }),
})
