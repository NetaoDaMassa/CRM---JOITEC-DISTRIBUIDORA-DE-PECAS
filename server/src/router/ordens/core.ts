// Núcleo do módulo de Ordens (Kanban de pós-venda, só Odin Compressores) —
// listar/criar/avançar/mover/cancelar/pausar/histórico. Ver
// server/src/lib/ordensStages.ts (sequências) e ordensGates.ts (regras de
// avanço + histórico).
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from '../_base.js'
import { db } from '../../db/client.js'
import { ordens, ordemHistorico, empresas, clientes, users } from '../../db/schema.js'
import { agoraSqlite } from '../../lib/dataBr.js'
import { registrarAuditoria } from '../../lib/auditoria.js'
import { avancarEtapaPedido, moverEtapaPedido, registrarHistoricoOrdem } from '../../lib/ordensGates.js'
import { ORDER_TYPE_VALUES, getStageSequence, type OrderType } from '../../lib/ordensStages.js'

// Módulo disponível só pra Odin Compressores — pedido explícito do João,
// mesmo padrão de SLUG_VENDA_RAPIDA em router/vendas.ts.
export const SLUG_ORDENS = 'odin-compressores'

async function assertEmpresaOrdens(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_ORDENS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

// Vendedor só alcança pedido próprio (vendedorId = ele mesmo) — admin
// alcança qualquer um da empresa. Correção urgente, 2026-09-02: até aqui
// isso NÃO era checado em lugar nenhum do módulo (só empresaId), então
// qualquer vendedor com a feature 'pedidos_odin' via Kanban/detalhe via
// URL/pra qualquer sub-etapa via ordemId, mesmo de pedido de outro
// vendedor. `assertOrdemAlcancavel` é chamada por TODOS os sub-routers de
// Pedidos (anexos/faturamento/conferencia/financeiro/frete/pos/
// preparacao), então corrigir aqui já fecha o buraco no módulo inteiro de
// uma vez, sem precisar duplicar a checagem em cada arquivo.
async function assertOrdemAlcancavel(ordemId: number, empresaId: number, userId: number, role: 'admin' | 'vendor') {
  const ordem = await db.query.ordens.findFirst({ where: and(eq(ordens.id, ordemId), eq(ordens.empresaId, empresaId)) })
  if (!ordem) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
  if (role !== 'admin' && ordem.vendedorId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' })
  return ordem
}

export const ordensCoreRouter = router({
  listarKanban: adminOrFeatureProcedure('pedidos_odin').input(z.object({ orderType: z.enum(ORDER_TYPE_VALUES), vendedorId: z.number().optional() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    // Vendedor só vê os pedidos dele — ignora completamente o vendedorId que
    // o cliente mandar (só admin escolhe de quem quer ver). Correção
    // urgente, 2026-09-02: antes o Kanban mostrava TODOS os pedidos da
    // empresa pra qualquer vendedor, sem filtro nenhum.
    const filtroVendedor = ctx.user.role === 'admin' ? input.vendedorId : ctx.user.id
    const condicoes = [eq(ordens.empresaId, ctx.empresaId), eq(ordens.orderType, input.orderType)]
    if (filtroVendedor) condicoes.push(eq(ordens.vendedorId, filtroVendedor))
    return db.query.ordens.findMany({
      where: and(...condicoes),
      with: {
        cliente: { columns: { id: true, razaoSocial: true, codigo: true, telefoneWhatsapp: true } },
        vendedor: { columns: { id: true, name: true } },
        // Campos extras só pra deixar o card do Kanban tão informativo quanto o
        // do odincrm original (prioridade, badges de frete/preparação, rastreio).
        detalhes: { columns: { prioridadeDespacho: true } },
        aprovacaoFrete: { columns: { retiradaLocal: true, semFrete: true, cotacaoSelecionadaId: true, cotacaoFinalizada: true } },
        freteFinalizado: { columns: { confirmado: true } },
        preparacao: { columns: { aprovadoGestor: true, operadorFinalizou: true } },
        coleta: { columns: { confirmado: true } },
        rastreio: { columns: { transportadora: true, codigoRastreio: true } },
      },
      orderBy: (o, { desc }) => [desc(o.updatedAt)],
    })
  }),

  contarAtivos: adminOrFeatureProcedure('pedidos_odin').query(async ({ ctx }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const condicoes = [eq(ordens.empresaId, ctx.empresaId), eq(ordens.status, 'ativo')]
    if (ctx.user.role !== 'admin') condicoes.push(eq(ordens.vendedorId, ctx.user.id))
    const rows = await db.query.ordens.findMany({ where: and(...condicoes), columns: { id: true } })
    return rows.length
  }),

  // Bolinha vermelha no toggle Máquina/Peça (pedido do João, 2026-08-31) —
  // conta quantos pedidos de cada tipo estão parados na primeira etapa "de
  // fila" (a que precisa de aprovação/ação antes de seguir pro resto do
  // fluxo), pra quem cuida do despacho já saber de cara sem entrar no board.
  // Máquina tem "liberação financeira" como esse gargalo inicial; Peça não
  // tem essa etapa (começa direto em "pedido"), então usa "pedido" mesmo.
  contarEtapaInicial: adminOrFeatureProcedure('pedidos_odin').query(async ({ ctx }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const filtroVendedor = ctx.user.role !== 'admin' ? [eq(ordens.vendedorId, ctx.user.id)] : []
    const [maquina, peca] = await Promise.all([
      db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, ctx.empresaId), eq(ordens.orderType, 'maquina'), eq(ordens.status, 'ativo'), eq(ordens.stage, 'liberacao_financeira'), ...filtroVendedor),
        columns: { id: true },
      }),
      db.query.ordens.findMany({
        where: and(eq(ordens.empresaId, ctx.empresaId), eq(ordens.orderType, 'peca'), eq(ordens.status, 'ativo'), eq(ordens.stage, 'pedido'), ...filtroVendedor),
        columns: { id: true },
      }),
    ])
    return { maquina: maquina.length, peca: peca.length }
  }),

  criar: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        clienteId: z.number(),
        vendedorId: z.number().optional(),
        orderType: z.enum(ORDER_TYPE_VALUES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
      if (!cliente) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cliente não encontrado nessa empresa' })

      const sequencia = getStageSequence(input.orderType)
      const result = await db.insert(ordens).values({
        empresaId: ctx.empresaId,
        clienteId: input.clienteId,
        vendedorId: input.vendedorId ?? ctx.user.id,
        criadoPor: ctx.user.id,
        orderType: input.orderType,
        stage: sequencia[0],
      })
      const ordemId = Number(result.lastInsertRowid)

      await registrarHistoricoOrdem({ ordemId, userId: ctx.user.id, action: 'create', description: 'Pedido criado', stage: sequencia[0] })
      await registrarAuditoria({ tabela: 'ordens', registroId: ordemId, acao: 'criar', alteradoPor: ctx.user.id })

      return { id: ordemId }
    }),

  obterPorId: adminOrFeatureProcedure('pedidos_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await db.query.ordens.findFirst({
      where: and(eq(ordens.id, input.id), eq(ordens.empresaId, ctx.empresaId)),
      with: { cliente: true, vendedor: { columns: { id: true, name: true, whatsapp: true } }, maquinas: true },
    })
    if (!ordem) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
    // Vendedor só abre pedido próprio, mesmo sabendo o id/link direto —
    // correção urgente, 2026-09-02 (ver assertOrdemAlcancavel acima).
    if (ctx.user.role !== 'admin' && ordem.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' })
    return ordem
  }),

  avancar: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    return avancarEtapaPedido({ ordemId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id })
  }),

  mover: adminProcedure.input(z.object({ id: z.number(), novaEtapa: z.string() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    return moverEtapaPedido({ ordemId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id, novaEtapa: input.novaEtapa })
  }),

  cancelar: adminProcedure.input(z.object({ id: z.number(), motivo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
    if (ordem.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido não está ativo' })

    await db
      .update(ordens)
      .set({ status: 'cancelado', cancelMotivo: input.motivo, canceladoPor: ctx.user.id, canceladoEm: agoraSqlite() })
      .where(eq(ordens.id, input.id))
    await registrarHistoricoOrdem({ ordemId: input.id, userId: ctx.user.id, action: 'cancelled', description: `Pedido cancelado: ${input.motivo}`, stage: ordem.stage })
    await registrarAuditoria({ tabela: 'ordens', registroId: input.id, acao: 'editar', campo: 'status', valorAnterior: 'ativo', valorNovo: 'cancelado', alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  pausar: adminProcedure.input(z.object({ id: z.number(), motivo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
    if (ordem.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido não está ativo' })

    await db.update(ordens).set({ pausadoMotivo: input.motivo, pausadoPor: ctx.user.id, pausadoEm: agoraSqlite() }).where(eq(ordens.id, input.id))
    await registrarHistoricoOrdem({ ordemId: input.id, userId: ctx.user.id, action: 'paused', description: `Pedido pausado: ${input.motivo}`, stage: ordem.stage })
    return { ok: true }
  }),

  retomar: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    const ordem = await assertOrdemAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
    await db.update(ordens).set({ pausadoMotivo: null, pausadoPor: null, pausadoEm: null }).where(eq(ordens.id, input.id))
    await registrarHistoricoOrdem({ ordemId: input.id, userId: ctx.user.id, action: 'update', description: 'Pedido retomado', stage: ordem.stage })
    return { ok: true }
  }),

  // Reatribuir vendedor do pedido — pedido do João (2026-09-02), pra corrigir
  // pedido lançado pro vendedor errado sem precisar cancelar e recriar tudo.
  // Só admin (não usa adminOrFeatureProcedure) porque é uma reatribuição de
  // "dono" do pedido, mesma régua de outras ações administrativas do módulo
  // (cancelar/pausar/mover já são adminProcedure puro).
  atualizarVendedor: adminProcedure
    .input(z.object({ id: z.number(), vendedorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      const ordem = await db.query.ordens.findFirst({ where: and(eq(ordens.id, input.id), eq(ordens.empresaId, ctx.empresaId)) })
      if (!ordem) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
      const vendedor = await db.query.users.findFirst({ where: and(eq(users.id, input.vendedorId), eq(users.empresaId, ctx.empresaId)) })
      if (!vendedor || !vendedor.isActive) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Vendedor inválido' })
      await db.update(ordens).set({ vendedorId: input.vendedorId, updatedAt: agoraSqlite() }).where(eq(ordens.id, input.id))
      await registrarAuditoria({
        tabela: 'ordens',
        registroId: input.id,
        acao: 'transferir_carteira',
        campo: 'vendedorId',
        valorAnterior: String(ordem.vendedorId ?? ''),
        valorNovo: String(input.vendedorId),
        alteradoPor: ctx.user.id,
      })
      return { ok: true }
    }),

  atualizarEndereco: adminOrFeatureProcedure('pedidos_odin')
    .input(
      z.object({
        id: z.number(),
        cep: z.string().optional(),
        logradouro: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaOrdens(ctx.empresaId)
      await assertOrdemAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
      await db
        .update(ordens)
        .set({
          enderecoEntregaCep: input.cep,
          enderecoEntregaLogradouro: input.logradouro,
          enderecoEntregaCidade: input.cidade,
          enderecoEntregaEstado: input.estado,
          updatedAt: agoraSqlite(),
        })
        .where(eq(ordens.id, input.id))
      return { ok: true }
    }),

  historico: adminOrFeatureProcedure('pedidos_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaOrdens(ctx.empresaId)
    await assertOrdemAlcancavel(input.id, ctx.empresaId, ctx.user.id, ctx.user.role)
    return db.query.ordemHistorico.findMany({
      where: eq(ordemHistorico.ordemId, input.id),
      with: { user: { columns: { id: true, name: true } } },
      orderBy: (h, { desc }) => [desc(h.createdAt)],
    })
  }),

  editarNotaHistorico: adminProcedure.input(z.object({ historicoId: z.number(), description: z.string().min(1) })).mutation(async ({ input }) => {
    await db.update(ordemHistorico).set({ description: input.description }).where(eq(ordemHistorico.id, input.historicoId))
    return { ok: true }
  }),
})

export { assertEmpresaOrdens, assertOrdemAlcancavel }
