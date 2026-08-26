// Visitas de campo (Odin Compressores) — portado de app/routers/fieldtrack.py
// do odincrm. Vendedor só enxerga as próprias visitas/clientes; gestor
// enxerga tudo. Registrar uma visita com resultado "gerar_proposta" cria
// de verdade uma Proposta (mesmo módulo já existente), igual o odincrm faz.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, visitasClientes, visitas, propostas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { notificarGestores } from '../lib/propostasGates.js'

const SLUG_VISITAS = 'odin-compressores'

async function assertEmpresaVisitas(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_VISITAS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

function assertDonoOuGestor(vendedorId: number, userId: number, role: 'admin' | 'vendor') {
  if (role === 'admin') return
  if (vendedorId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' })
}

async function gerarPropostaDaVisita(visita: typeof visitas.$inferSelect, empresaId: number, userId: number) {
  const clienteNome = visita.clienteNome || (visita.clienteId ? (await db.query.visitasClientes.findFirst({ where: eq(visitasClientes.id, visita.clienteId) }))?.nome : null) || visita.nomeEmpresa || '—'
  const result = await db.insert(propostas).values({
    empresaId,
    vendedorId: visita.vendedorId,
    clienteNome,
    produtosDescricao: visita.propostaItens,
    comissao: visita.propostaComissao,
    revenda: visita.propostaRevenda,
    formaPagamento: visita.propostaPagamento,
    observacoes: visita.proximoPasso,
    stage: 'proposta',
  })
  const propostaId = Number(result.lastInsertRowid)
  await db.update(visitas).set({ convertidoParaPropostaId: propostaId }).where(eq(visitas.id, visita.id))
  await notificarGestores(empresaId, 'Nova proposta recebida', `${clienteNome} — gerada a partir de uma visita de ${userId}`)
  return propostaId
}

export const visitasRouter = router({
  // ── Clientes de campo ────────────────────────────────────────────────
  listarClientes: adminOrFeatureProcedure('visitas_odin').input(z.object({ q: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    const todos = await db.query.visitasClientes.findMany({
      where: ctx.user.role === 'admin' ? eq(visitasClientes.empresaId, ctx.empresaId) : and(eq(visitasClientes.empresaId, ctx.empresaId), eq(visitasClientes.vendedorId, ctx.user.id)),
      with: { vendedor: { columns: { id: true, name: true } } },
      orderBy: (c, { asc }) => [asc(c.nome)],
    })
    if (!input?.q) return todos
    const q = input.q.toLowerCase()
    return todos.filter((c) => c.nome.toLowerCase().includes(q) || c.cnpj?.includes(q))
  }),

  criarCliente: adminOrFeatureProcedure('visitas_odin')
    .input(
      z.object({
        nome: z.string().min(1),
        cnpj: z.string().optional(),
        nomeContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        endereco: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        segmento: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaVisitas(ctx.empresaId)
      const result = await db.insert(visitasClientes).values({ empresaId: ctx.empresaId, vendedorId: ctx.user.id, criadoPor: ctx.user.id, ...input })
      return { id: Number(result.lastInsertRowid) }
    }),

  atualizarCliente: adminOrFeatureProcedure('visitas_odin')
    .input(
      z.object({
        id: z.number(),
        nome: z.string().optional(),
        cnpj: z.string().optional(),
        nomeContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        endereco: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        segmento: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaVisitas(ctx.empresaId)
      const { id, ...values } = input
      const cliente = await db.query.visitasClientes.findFirst({ where: and(eq(visitasClientes.id, id), eq(visitasClientes.empresaId, ctx.empresaId)) })
      if (!cliente) throw new TRPCError({ code: 'NOT_FOUND' })
      assertDonoOuGestor(cliente.vendedorId ?? 0, ctx.user.id, ctx.user.role)
      await db.update(visitasClientes).set({ ...values, updatedAt: agoraSqlite() }).where(eq(visitasClientes.id, id))
      return { ok: true }
    }),

  excluirCliente: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    await db.delete(visitasClientes).where(and(eq(visitasClientes.id, input.id), eq(visitasClientes.empresaId, ctx.empresaId)))
    return { ok: true }
  }),

  // ── Visitas ───────────────────────────────────────────────────────────
  listar: adminOrFeatureProcedure('visitas_odin').input(z.object({ vendedorId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    const filtroVendedor = ctx.user.role === 'admin' ? input?.vendedorId : ctx.user.id
    return db.query.visitas.findMany({
      where: filtroVendedor ? and(eq(visitas.empresaId, ctx.empresaId), eq(visitas.vendedorId, filtroVendedor)) : eq(visitas.empresaId, ctx.empresaId),
      with: { vendedor: { columns: { id: true, name: true } }, cliente: { columns: { id: true, nome: true } } },
      orderBy: (v, { desc }) => [desc(v.dataVisita)],
    })
  }),

  obterPorId: adminOrFeatureProcedure('visitas_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    const visita = await db.query.visitas.findFirst({
      where: and(eq(visitas.id, input.id), eq(visitas.empresaId, ctx.empresaId)),
      with: { vendedor: { columns: { id: true, name: true } }, cliente: true },
    })
    if (!visita) throw new TRPCError({ code: 'NOT_FOUND' })
    return visita
  }),

  criar: adminOrFeatureProcedure('visitas_odin')
    .input(
      z.object({
        clienteId: z.number().optional(),
        clienteNome: z.string().optional(),
        dataVisita: z.string(),
        nomeEmpresa: z.string().optional(),
        pessoaContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        endereco: z.string().optional(),
        objetivo: z.string().optional(),
        resultado: z.string().optional(),
        proximoPasso: z.string().optional(),
        dataRetorno: z.string().optional(),
        observacoes: z.string().optional(),
        planejada: z.boolean().optional(),
        propostaItens: z.string().optional(),
        propostaPagamento: z.string().optional(),
        propostaComissao: z.string().optional(),
        propostaRevenda: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaVisitas(ctx.empresaId)
      const result = await db.insert(visitas).values({ empresaId: ctx.empresaId, vendedorId: ctx.user.id, ...input })
      const visitaId = Number(result.lastInsertRowid)
      let propostaId: number | undefined
      if (input.resultado === 'gerar_proposta') {
        const visita = await db.query.visitas.findFirst({ where: eq(visitas.id, visitaId) })
        if (visita) propostaId = await gerarPropostaDaVisita(visita, ctx.empresaId, ctx.user.id)
      }
      return { id: visitaId, propostaId }
    }),

  atualizar: adminOrFeatureProcedure('visitas_odin')
    .input(
      z.object({
        id: z.number(),
        clienteId: z.number().optional(),
        clienteNome: z.string().optional(),
        dataVisita: z.string().optional(),
        nomeEmpresa: z.string().optional(),
        pessoaContato: z.string().optional(),
        telefoneContato: z.string().optional(),
        endereco: z.string().optional(),
        objetivo: z.string().optional(),
        resultado: z.string().optional(),
        proximoPasso: z.string().optional(),
        dataRetorno: z.string().optional(),
        observacoes: z.string().optional(),
        planejada: z.boolean().optional(),
        propostaItens: z.string().optional(),
        propostaPagamento: z.string().optional(),
        propostaComissao: z.string().optional(),
        propostaRevenda: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaVisitas(ctx.empresaId)
      const { id, ...values } = input
      const visita = await db.query.visitas.findFirst({ where: and(eq(visitas.id, id), eq(visitas.empresaId, ctx.empresaId)) })
      if (!visita) throw new TRPCError({ code: 'NOT_FOUND' })
      assertDonoOuGestor(visita.vendedorId, ctx.user.id, ctx.user.role)

      await db.update(visitas).set({ ...values, updatedAt: agoraSqlite() }).where(eq(visitas.id, id))

      let propostaId: number | undefined
      if (values.resultado === 'gerar_proposta' && visita.resultado !== 'gerar_proposta' && !visita.convertidoParaPropostaId) {
        const atualizada = await db.query.visitas.findFirst({ where: eq(visitas.id, id) })
        if (atualizada) propostaId = await gerarPropostaDaVisita(atualizada, ctx.empresaId, ctx.user.id)
      }
      return { ok: true, propostaId }
    }),

  checkin: adminOrFeatureProcedure('visitas_odin').input(z.object({ id: z.number(), lat: z.number().optional(), lng: z.number().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    const visita = await db.query.visitas.findFirst({ where: and(eq(visitas.id, input.id), eq(visitas.empresaId, ctx.empresaId)) })
    if (!visita) throw new TRPCError({ code: 'NOT_FOUND' })
    assertDonoOuGestor(visita.vendedorId, ctx.user.id, ctx.user.role)
    await db.update(visitas).set({ checkinEm: agoraSqlite(), latCheckin: input.lat, lngCheckin: input.lng, updatedAt: agoraSqlite() }).where(eq(visitas.id, input.id))
    return { ok: true }
  }),

  checkout: adminOrFeatureProcedure('visitas_odin').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    const visita = await db.query.visitas.findFirst({ where: and(eq(visitas.id, input.id), eq(visitas.empresaId, ctx.empresaId)) })
    if (!visita) throw new TRPCError({ code: 'NOT_FOUND' })
    assertDonoOuGestor(visita.vendedorId, ctx.user.id, ctx.user.role)
    await db.update(visitas).set({ checkoutEm: agoraSqlite(), updatedAt: agoraSqlite() }).where(eq(visitas.id, input.id))
    return { ok: true }
  }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaVisitas(ctx.empresaId)
    await db.delete(visitas).where(and(eq(visitas.id, input.id), eq(visitas.empresaId, ctx.empresaId)))
    return { ok: true }
  }),
})
