import { z } from 'zod'
import { desc, eq, inArray } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { alias } from 'drizzle-orm/sqlite-core'
import { router, featureProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, linksPagamento, notifications, users } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { buscarCep } from '../lib/brasilApi.js'
import { noPiloto } from '../lib/pilotoFinanceiro.js'

// Solicitação de link de pagamento (financeiro, 2026-11-13): o vendedor pede
// pelo CRM, o financeiro cria o link (beluíno) e cola aqui, o vendedor copia e
// manda pro cliente. Tela do financeiro é cross-empresa (igual Registros de
// liberação); o vendedor vê só os pedidos dele.
const FEATURE = 'link_pagamento'

const vendedor = alias(users, 'vendedor')
const criador = alias(users, 'criador')

const STATUS_POR_ABA = {
  solicitado: ['solicitado'],
  criado: ['criado'],
  finalizado: ['pago', 'cancelado'],
} as const

const campos = {
  id: linksPagamento.id,
  empresaNome: empresas.nome,
  clienteId: linksPagamento.clienteId,
  clienteNome: linksPagamento.clienteNome,
  documento: linksPagamento.documento,
  vendedorNome: vendedor.name,
  vendedorId: linksPagamento.vendedorId,
  valor: linksPagamento.valor,
  parcelas: linksPagamento.parcelas,
  numeroPedido: linksPagamento.numeroPedido,
  descricao: linksPagamento.descricao,
  emailCliente: linksPagamento.emailCliente,
  telefoneCliente: linksPagamento.telefoneCliente,
  observacaoVendedor: linksPagamento.observacaoVendedor,
  telefoneFixo: linksPagamento.telefoneFixo,
  enderecoEntrega: linksPagamento.enderecoEntrega,
  itens: linksPagamento.itens,
  cartao: linksPagamento.cartao,
  bandeira: linksPagamento.bandeira,
  pix: linksPagamento.pix,
  status: linksPagamento.status,
  link: linksPagamento.link,
  criadoPorNome: criador.name,
  criadoEm: linksPagamento.criadoEm,
  observacaoFinanceiro: linksPagamento.observacaoFinanceiro,
  pagoEm: linksPagamento.pagoEm,
  canceladoEm: linksPagamento.canceladoEm,
  motivoCancelamento: linksPagamento.motivoCancelamento,
  createdAt: linksPagamento.createdAt,
}

function consulta() {
  return db
    .select(campos)
    .from(linksPagamento)
    .innerJoin(empresas, eq(empresas.id, linksPagamento.empresaId))
    .innerJoin(vendedor, eq(vendedor.id, linksPagamento.vendedorId))
    .leftJoin(criador, eq(criador.id, linksPagamento.criadoPor))
}

async function acharPedido(id: number) {
  const l = await db.query.linksPagamento.findFirst({ where: eq(linksPagamento.id, id) })
  if (!l) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido de link não encontrado' })
  return l
}

async function avisar(vendedorId: number, titulo: string, mensagem: string) {
  try {
    await db.insert(notifications).values({ vendedorId, type: 'link_pagamento', title: titulo, message: mensagem })
  } catch (e) {
    console.error('[link-pagamento] aviso falhou', e)
  }
}

export const linksPagamentoRouter = router({
  // ── Vendedor ──
  // Mesmos campos do formulário do beluíno (print do João, 2026-11-16).
  solicitar: protectedProcedure
    .input(
      z
        .object({
          clienteId: z.number().optional(),
          documento: z.string().trim().refine((v) => [11, 14].includes(v.replace(/\D/g, '').length), 'CPF/CNPJ inválido'),
          clienteNome: z.string().trim().min(2, 'Informe o nome do cliente').max(200),
          emailCliente: z.string().trim().email('E-mail inválido').max(200),
          telefoneFixo: z.string().trim().max(30).optional(),
          telefoneCliente: z.string().trim().max(30).optional(),
          observacaoVendedor: z.string().trim().max(1000).optional(),
          numeroPedido: z.string().trim().max(40).optional(),
          endereco: z
            .object({
              cep: z.string().trim().refine((v) => v.replace(/\D/g, '').length === 8, 'CEP inválido'),
              numero: z.string().trim().min(1, 'Informe o número'),
              endereco: z.string().trim().min(2, 'Informe o endereço'),
              cidade: z.string().trim().min(2, 'Informe a cidade'),
              estado: z.string().trim().length(2, 'Informe a UF'),
              complemento: z.string().trim().max(200).optional(),
            })
            .nullable(),
          itens: z.array(z.object({ produto: z.string().trim().min(1, 'Informe o produto/serviço').max(200), preco: z.number().positive('Preço inválido'), qtd: z.number().positive('Qtd inválida') })).min(1, 'Informe ao menos um produto/serviço').max(50),
          cartao: z.boolean(),
          parcelas: z.number().int().min(1).max(24),
          bandeira: z.string().trim().max(40).optional(),
          pix: z.boolean(),
        })
        .refine((v) => v.cartao || v.pix, { message: 'Escolha ao menos uma forma de pagamento (cartão ou PIX)' })
    )
    .mutation(async ({ ctx, input }) => {
      // Piloto do financeiro (2026-11-16): por enquanto só quem está no piloto pede link.
      if (!ctx.user.superAdmin && !(await noPiloto(ctx.user.id))) throw new TRPCError({ code: 'FORBIDDEN', message: 'O pedido de link de pagamento ainda está em teste e não foi liberado para você.' })
      const valor = Math.round(input.itens.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100
      const r = await db.insert(linksPagamento).values({
        empresaId: ctx.empresaId,
        vendedorId: ctx.user.id,
        clienteId: input.clienteId ?? null,
        clienteNome: input.clienteNome,
        documento: input.documento,
        emailCliente: input.emailCliente,
        telefoneFixo: input.telefoneFixo || null,
        telefoneCliente: input.telefoneCliente || null,
        observacaoVendedor: input.observacaoVendedor || null,
        numeroPedido: input.numeroPedido || null,
        enderecoEntrega: input.endereco ? JSON.stringify(input.endereco) : null,
        itens: JSON.stringify(input.itens),
        descricao: input.itens.map((i) => `${i.qtd}x ${i.produto}`).join('; ').slice(0, 500),
        valor,
        cartao: input.cartao,
        parcelas: input.cartao ? input.parcelas : 1,
        bandeira: input.cartao ? input.bandeira || null : null,
        pix: input.pix,
      })
      return { id: Number(r.lastInsertRowid) }
    }),

  buscarCep: protectedProcedure.input(z.object({ cep: z.string() })).query(({ input }) => buscarCep(input.cep)),

  meus: protectedProcedure.query(async ({ ctx }) =>
    consulta().where(eq(linksPagamento.vendedorId, ctx.user.id)).orderBy(desc(linksPagamento.id)).limit(200)
  ),

  cancelarMeu: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const l = await acharPedido(input.id)
    if (l.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Esse pedido não é seu.' })
    if (l.status !== 'solicitado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'O financeiro já criou o link — peça para o financeiro cancelar.' })
    await db.update(linksPagamento).set({ status: 'cancelado', canceladoEm: agoraSqlite(), motivoCancelamento: 'Cancelado pelo vendedor' }).where(eq(linksPagamento.id, l.id))
    return { ok: true }
  }),

  // ── Financeiro ──
  listar: featureProcedure(FEATURE)
    .input(z.object({ aba: z.enum(['solicitado', 'criado', 'finalizado']) }))
    .query(async ({ input }) =>
      consulta()
        .where(inArray(linksPagamento.status, [...STATUS_POR_ABA[input.aba]]))
        .orderBy(input.aba === 'solicitado' ? linksPagamento.id : desc(linksPagamento.id))
        .limit(500)
    ),

  contagem: featureProcedure(FEATURE).query(async () => {
    const l = await db.select({ status: linksPagamento.status }).from(linksPagamento).where(inArray(linksPagamento.status, ['solicitado', 'criado']))
    return { solicitados: l.filter((x) => x.status === 'solicitado').length, criados: l.filter((x) => x.status === 'criado').length }
  }),

  criarLink: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), link: z.string().trim().url('Cole o link completo (começando com https://)').max(1000), observacao: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const l = await acharPedido(input.id)
      if (l.status === 'pago' || l.status === 'cancelado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esse pedido já foi finalizado.' })
      await db
        .update(linksPagamento)
        .set({ status: 'criado', link: input.link, criadoPor: ctx.user.id, criadoEm: agoraSqlite(), observacaoFinanceiro: input.observacao || l.observacaoFinanceiro })
        .where(eq(linksPagamento.id, l.id))
      await avisar(l.vendedorId, 'Link de pagamento pronto', `${l.clienteNome}: o financeiro criou o link de pagamento. Abra "Link de pagamento" para copiar e mandar ao cliente.`)
      return { ok: true }
    }),

  marcarPago: featureProcedure(FEATURE).input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const l = await acharPedido(input.id)
    if (l.status !== 'criado') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Só dá pra marcar pago depois de criar o link.' })
    await db.update(linksPagamento).set({ status: 'pago', pagoEm: agoraSqlite() }).where(eq(linksPagamento.id, l.id))
    await avisar(l.vendedorId, 'Link de pagamento pago', `${l.clienteNome}: o financeiro confirmou o pagamento do link.`)
    return { ok: true }
  }),

  cancelar: featureProcedure(FEATURE)
    .input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga o motivo').max(500) }))
    .mutation(async ({ input }) => {
      const l = await acharPedido(input.id)
      if (l.status === 'pago') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Já está pago.' })
      await db.update(linksPagamento).set({ status: 'cancelado', canceladoEm: agoraSqlite(), motivoCancelamento: input.motivo }).where(eq(linksPagamento.id, l.id))
      await avisar(l.vendedorId, 'Link de pagamento cancelado', `${l.clienteNome}: o financeiro cancelou o pedido de link — ${input.motivo}`)
      return { ok: true }
    }),

  reabrir: featureProcedure(FEATURE).input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const l = await acharPedido(input.id)
    await db
      .update(linksPagamento)
      .set({ status: l.link ? 'criado' : 'solicitado', pagoEm: null, canceladoEm: null, motivoCancelamento: null })
      .where(eq(linksPagamento.id, l.id))
    return { ok: true }
  }),
})

