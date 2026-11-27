// Coluna "Pós-venda" do Kanban da Compretec Loja Física (antes de Perdido).
// Cada item é um compressor vendido com a próxima manutenção marcada — ver
// lib/maquinasPosVenda.ts. Não é card do funil: a venda continua em
// Fechado/Faturamento, os relatórios de venda não mudam.
import { z } from 'zod'
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { clienteMaquinas, clienteMaquinaContatos, clientes, compromissos, empresas, users, vendas } from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { SLUG_POS_VENDA_LOJA, DIAS_PRIMEIRO_CONTATO, DIAS_APOS_COMPRA, somarDias, sincronizarCompromisso, aplicarNovasCompras } from '../lib/maquinasPosVenda.js'

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
type Usuario = { id: number; role: string; superAdmin: boolean }
const ehGestor = (u: Usuario) => u.role !== 'vendor' || u.superAdmin

async function assertEmpresa(empresaId: number) {
  const e = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  if (e?.slug !== SLUG_POS_VENDA_LOJA) throw new TRPCError({ code: 'FORBIDDEN', message: 'Pós-venda de máquinas é só da Compretec Loja Física' })
}

async function assertMaquina(id: number, empresaId: number, user: Usuario) {
  const m = await db.query.clienteMaquinas.findFirst({ where: and(eq(clienteMaquinas.id, id), eq(clienteMaquinas.empresaId, empresaId)) })
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Máquina não encontrada' })
  if (!ehGestor(user) && m.vendedorId !== user.id) {
    const c = await db.query.clientes.findFirst({ where: eq(clientes.id, m.clienteId), columns: { vendedorAtualId: true } })
    if (c?.vendedorAtualId !== user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Esta máquina é de outro vendedor' })
  }
  return m
}

async function nomeCliente(id: number) {
  return (await db.query.clientes.findFirst({ where: eq(clientes.id, id), columns: { razaoSocial: true } }))?.razaoSocial
}

export const posVendaLojaRouter = router({
  listar: protectedProcedure.input(z.object({ vendedorId: z.number().optional(), todos: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const e = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId), columns: { slug: true } })
    if (e?.slug !== SLUG_POS_VENDA_LOJA) return { mostrar: false, itens: [], clientesComMaquina: [] as number[] }
    await aplicarNovasCompras(ctx.empresaId)
    const condicoes = [eq(clienteMaquinas.empresaId, ctx.empresaId), eq(clienteMaquinas.status, 'ativo')]
    if (!ehGestor(ctx.user)) condicoes.push(eq(clienteMaquinas.vendedorId, ctx.user.id))
    else if (!input?.todos && input?.vendedorId) condicoes.push(eq(clienteMaquinas.vendedorId, input.vendedorId))
    const linhas = await db
      .select({
        id: clienteMaquinas.id,
        clienteId: clienteMaquinas.clienteId,
        clienteNome: clientes.razaoSocial,
        clienteWhatsapp: clientes.telefoneWhatsapp,
        vendedorNome: users.name,
        tipo: clienteMaquinas.tipo,
        modelo: clienteMaquinas.modelo,
        numeroSerie: clienteMaquinas.numeroSerie,
        dataVenda: clienteMaquinas.dataVenda,
        proximoContato: clienteMaquinas.proximoContato,
        baseMotivo: clienteMaquinas.baseMotivo,
      })
      .from(clienteMaquinas)
      .innerJoin(clientes, eq(clientes.id, clienteMaquinas.clienteId))
      .leftJoin(users, eq(users.id, clienteMaquinas.vendedorId))
      .where(and(...condicoes))
    const ultimos = linhas.length
      ? await db
          .select({ maquinaId: clienteMaquinaContatos.maquinaId, observacao: clienteMaquinaContatos.observacao, createdAt: clienteMaquinaContatos.createdAt })
          .from(clienteMaquinaContatos)
          .where(inArray(clienteMaquinaContatos.maquinaId, linhas.map((l) => l.id)))
          .orderBy(desc(clienteMaquinaContatos.id))
      : []
    const ultimoDe = new Map<number, (typeof ultimos)[number]>()
    for (const u of ultimos) if (!ultimoDe.has(u.maquinaId)) ultimoDe.set(u.maquinaId, u)
    const itens = linhas
      .map((l) => ({ ...l, ultimoContato: ultimoDe.get(l.id) ?? null, primeiroContato: !ultimoDe.has(l.id) }))
      .sort((a, b) => (a.proximoContato ?? '9999').localeCompare(b.proximoContato ?? '9999'))
    // Todos os clientes com máquina ativa da empresa (selo "🔧" nos cards).
    const comMaquina = await db
      .selectDistinct({ id: clienteMaquinas.clienteId })
      .from(clienteMaquinas)
      .where(and(eq(clienteMaquinas.empresaId, ctx.empresaId), eq(clienteMaquinas.status, 'ativo')))
    return { mostrar: true, itens, clientesComMaquina: comMaquina.map((c) => c.id) }
  }),

  obter: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const m = await assertMaquina(input.id, ctx.empresaId, ctx.user)
    const [cliente, contatos, vendedor, compras] = await Promise.all([
      db.query.clientes.findFirst({ where: eq(clientes.id, m.clienteId), columns: { id: true, razaoSocial: true, telefoneWhatsapp: true, cidade: true, nomeContato: true } }),
      db.query.clienteMaquinaContatos.findMany({ where: eq(clienteMaquinaContatos.maquinaId, m.id), with: { user: { columns: { name: true } } }, orderBy: (c, { desc }) => [desc(c.id)] }),
      m.vendedorId ? db.query.users.findFirst({ where: eq(users.id, m.vendedorId), columns: { id: true, name: true } }) : null,
      db
        .select({ id: vendas.id, dia: sql<string>`date(${vendas.dataFechamento}, '-3 hours')`, valor: vendas.valorFechado, numeroPedido: vendas.numeroPedido })
        .from(vendas)
        .where(and(eq(vendas.clienteId, m.clienteId), isNull(vendas.deletedAt), gt(sql`date(${vendas.dataFechamento}, '-3 hours')`, m.dataVenda)))
        .orderBy(desc(vendas.dataFechamento))
        .limit(10),
    ])
    return { ...m, cliente, contatos, vendedor, comprasDepois: compras, diasAposCompra: DIAS_APOS_COMPRA }
  }),

  // Máquinas que o cliente já tem (o modal de cadastro mostra, pra não duplicar).
  doCliente: protectedProcedure.input(z.object({ clienteId: z.number() })).query(async ({ ctx, input }) => {
    return db.query.clienteMaquinas.findMany({ where: and(eq(clienteMaquinas.empresaId, ctx.empresaId), eq(clienteMaquinas.clienteId, input.clienteId)), orderBy: (m, { desc }) => [desc(m.id)] })
  }),

  cadastrar: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        funilMensalId: z.number().optional(),
        vendaId: z.number().optional(),
        tipo: z.enum(['pistao', 'parafuso', 'outro']),
        modelo: z.string().trim().min(2, 'Informe o modelo do compressor').max(200),
        numeroSerie: z.string().trim().max(100).optional(),
        dataVenda: data,
        proximoContato: data.optional(),
        observacoes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresa(ctx.empresaId)
      const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)), columns: { id: true, razaoSocial: true, vendedorAtualId: true } })
      if (!cliente) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cliente não encontrado' })
      if (!ehGestor(ctx.user) && cliente.vendedorAtualId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Este cliente é de outro vendedor' })
      if (/consumidor final/i.test(cliente.razaoSocial)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Compressor sai com nota: cadastre o cliente (CPF/CNPJ) antes de registrar a máquina — não use o cadastro CONSUMIDOR FINAL.' })
      const proximo = input.proximoContato ?? somarDias(input.dataVenda, DIAS_PRIMEIRO_CONTATO)
      const [m] = await db
        .insert(clienteMaquinas)
        .values({
          empresaId: ctx.empresaId,
          clienteId: cliente.id,
          vendedorId: cliente.vendedorAtualId ?? ctx.user.id,
          funilMensalId: input.funilMensalId ?? null,
          vendaId: input.vendaId ?? null,
          tipo: input.tipo,
          modelo: input.modelo,
          numeroSerie: input.numeroSerie || null,
          dataVenda: input.dataVenda,
          proximoContato: proximo,
          baseData: input.dataVenda,
          baseMotivo: input.proximoContato ? 'manual' : 'venda_maquina',
          observacoes: input.observacoes?.trim() || null,
          criadoPor: ctx.user.id,
        })
        .returning()
      await sincronizarCompromisso(m, cliente.razaoSocial)
      return { id: m.id, proximoContato: proximo }
    }),

  registrarContato: protectedProcedure
    .input(z.object({ id: z.number(), tipo: z.enum(['whatsapp', 'ligacao', 'visita', 'outro']), observacao: z.string().trim().min(3, 'Escreva o que conversou').max(2000), proximoContato: data }))
    .mutation(async ({ ctx, input }) => {
      const m = await assertMaquina(input.id, ctx.empresaId, ctx.user)
      if (m.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta máquina está encerrada' })
      await db.insert(clienteMaquinaContatos).values({ maquinaId: m.id, userId: ctx.user.id, tipo: input.tipo, observacao: input.observacao })
      // O compromisso de agora foi cumprido; o próximo nasce na data nova.
      if (m.compromissoId) await db.update(compromissos).set({ concluido: true, updatedAt: agoraSqlite() }).where(eq(compromissos.id, m.compromissoId))
      const atualizada = { ...m, proximoContato: input.proximoContato, baseData: hojeBrString(), baseMotivo: 'contato' as const, compromissoId: null }
      await db.update(clienteMaquinas).set({ proximoContato: input.proximoContato, baseData: atualizada.baseData, baseMotivo: 'contato', compromissoId: null, updatedAt: agoraSqlite() }).where(eq(clienteMaquinas.id, m.id))
      await sincronizarCompromisso(atualizada, await nomeCliente(m.clienteId))
      return { ok: true }
    }),

  atualizar: protectedProcedure
    .input(z.object({ id: z.number(), proximoContato: data.optional(), tipo: z.enum(['pistao', 'parafuso', 'outro']).optional(), modelo: z.string().trim().min(2).max(200).optional(), numeroSerie: z.string().trim().max(100).optional(), observacoes: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const m = await assertMaquina(input.id, ctx.empresaId, ctx.user)
      const set: Partial<typeof clienteMaquinas.$inferInsert> = { updatedAt: agoraSqlite() }
      if (input.proximoContato) { set.proximoContato = input.proximoContato; set.baseData = hojeBrString(); set.baseMotivo = 'manual' }
      if (input.tipo) set.tipo = input.tipo
      if (input.modelo) set.modelo = input.modelo
      if (input.numeroSerie !== undefined) set.numeroSerie = input.numeroSerie || null
      if (input.observacoes !== undefined) set.observacoes = input.observacoes.trim() || null
      await db.update(clienteMaquinas).set(set).where(eq(clienteMaquinas.id, m.id))
      await sincronizarCompromisso({ ...m, ...set } as typeof m, await nomeCliente(m.clienteId))
      return { ok: true }
    }),

  encerrar: protectedProcedure.input(z.object({ id: z.number(), motivo: z.string().trim().min(3, 'Diga por que encerrar (vendeu a máquina, fechou, outro fornecedor…)').max(500) })).mutation(async ({ ctx, input }) => {
    const m = await assertMaquina(input.id, ctx.empresaId, ctx.user)
    await db.update(clienteMaquinas).set({ status: 'encerrado', encerradoMotivo: input.motivo, updatedAt: agoraSqlite() }).where(eq(clienteMaquinas.id, m.id))
    await sincronizarCompromisso({ ...m, status: 'encerrado' })
    return { ok: true }
  }),
})
