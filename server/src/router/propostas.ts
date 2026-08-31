// Funil de Propostas (Odin Compressores), portado do odincrm.duckdns.org —
// ver server/src/lib/propostasGates.ts pras regras de negócio replicadas
// (gate de PDF, data de retorno, trava de campo, conversão em Pedido).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure, adminOrFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, clientes, propostas, propostaArquivos, propostaFeedbacks, propostaAlteracoes, propostaHistorico, ordens, ordemLiberacaoFinanceira, estoqueCatalogoModelos } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { assertDonoOuGestor, mudarEtapaProposta, notificarGestores } from '../lib/propostasGates.js'

export const SLUG_PROPOSTAS = 'odin-compressores'

async function assertEmpresaPropostas(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_PROPOSTAS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

async function assertPropostaAlcancavel(propostaId: number, empresaId: number) {
  const proposta = await db.query.propostas.findFirst({ where: and(eq(propostas.id, propostaId), eq(propostas.empresaId, empresaId)) })
  if (!proposta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposta não encontrada' })
  return proposta
}

export const propostasRouter = router({
  // Catálogo de modelos (mesmo do Almoxarifado) — usado no seletor de
  // Produtos/Serviços da proposta (ProductSelector.tsx), igual ao odincrm
  // original (ProductSelector busca em inventoryApi.searchModelCatalog()).
  // Leitura liberada pra quem tem acesso a Propostas, não só admin —
  // vendedor precisa dela pra montar a proposta.
  catalogoModelos: adminOrFeatureProcedure('propostas_odin').query(async ({ ctx }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    return db.query.estoqueCatalogoModelos.findMany({
      where: eq(estoqueCatalogoModelos.empresaId, ctx.empresaId),
      columns: { id: true, categoria: true, linha: true, modelo: true, especificacoes: true },
      orderBy: (c, { asc }) => [asc(c.categoria), asc(c.modelo)],
    })
  }),

  listar: adminOrFeatureProcedure('propostas_odin').input(z.object({ vendedorId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const filtroVendedor = ctx.user.role === 'admin' ? input?.vendedorId : ctx.user.id
    return db.query.propostas.findMany({
      where: filtroVendedor ? and(eq(propostas.empresaId, ctx.empresaId), eq(propostas.vendedorId, filtroVendedor)) : eq(propostas.empresaId, ctx.empresaId),
      with: { vendedor: { columns: { id: true, name: true, whatsapp: true } }, arquivos: true, alteracoes: true },
      orderBy: (p, { desc }) => [desc(p.updatedAt)],
    })
  }),

  criar: adminOrFeatureProcedure('propostas_odin')
    .input(
      z.object({
        clienteNome: z.string().min(1),
        clienteWhatsapp: z.string().optional(),
        produtosDescricao: z.string().optional(),
        produtosItens: z.string().optional(),
        comissao: z.string().optional(),
        revenda: z.string().optional(),
        formaPagamento: z.string().optional(),
        observacoes: z.string().optional(),
        prioridade: z.enum(['normal', 'urgente']).optional(),
        motivoUrgencia: z.string().optional(),
        stage: z.enum(['proposta', 'fechado']).optional(),
        semProposta: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaPropostas(ctx.empresaId)
      const { stage, ...rest } = input
      // "Fechamento / Sem Proposta" cria direto em "fechado"; qualquer outro valor cai em "proposta".
      const result = await db.insert(propostas).values({
        empresaId: ctx.empresaId,
        vendedorId: ctx.user.id,
        ...rest,
        stage: stage === 'fechado' ? 'fechado' : 'proposta',
      })
      const propostaId = Number(result.lastInsertRowid)
      const titulo = input.semProposta ? 'Fechamento registrado (sem proposta)' : 'Nova proposta recebida'
      await notificarGestores(ctx.empresaId, titulo, `${input.clienteNome} — ${input.semProposta ? 'fechamento' : 'proposta'} criado por ${ctx.user.name}`)
      await registrarAuditoria({ tabela: 'propostas', registroId: propostaId, acao: 'criar', alteradoPor: ctx.user.id })
      return { id: propostaId }
    }),

  obterPorId: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.id, ctx.empresaId)
    if (ctx.user.role !== 'admin') assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)
    return db.query.propostas.findFirst({ where: eq(propostas.id, input.id), with: { vendedor: { columns: { id: true, name: true, whatsapp: true } } } })
  }),

  atualizar: adminOrFeatureProcedure('propostas_odin')
    .input(
      z.object({
        id: z.number(),
        clienteNome: z.string().optional(),
        clienteWhatsapp: z.string().optional(),
        produtosDescricao: z.string().optional(),
        produtosItens: z.string().optional(),
        comissao: z.string().optional(),
        revenda: z.string().optional(),
        formaPagamento: z.string().optional(),
        observacoes: z.string().optional(),
        prioridade: z.enum(['normal', 'urgente']).optional(),
        motivoUrgencia: z.string().optional(),
        dataRetorno: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaPropostas(ctx.empresaId)
      const { id, ...values } = input
      const proposta = await assertPropostaAlcancavel(id, ctx.empresaId)
      assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)

      // Produtos/Serviços trava pro vendedor assim que sai da coluna "Proposta" —
      // só destrava via "Solicitar Alteração", que devolve a proposta pra lá.
      const mexeuNosProdutos =
        (values.produtosDescricao !== undefined && values.produtosDescricao !== proposta.produtosDescricao) ||
        (values.produtosItens !== undefined && values.produtosItens !== proposta.produtosItens)
      if (mexeuNosProdutos && proposta.stage !== 'proposta' && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Campo travado após o envio — use 'Solicitar Alteração' para poder editar" })
      }

      await db.update(propostas).set({ ...values, updatedAt: agoraSqlite() }).where(eq(propostas.id, id))
      return { ok: true }
    }),

  moverEtapa: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number(), novaEtapa: z.string(), nota: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.id, ctx.empresaId)
    assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)
    return mudarEtapaProposta({ propostaId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id, novaEtapa: input.novaEtapa, nota: input.nota })
  }),

  marcarPerdida: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number(), motivo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.id, ctx.empresaId)
    assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)
    await db.update(propostas).set({ motivoPerda: input.motivo }).where(eq(propostas.id, input.id))
    await mudarEtapaProposta({ propostaId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id, novaEtapa: 'perdido', nota: input.motivo })
    return { ok: true }
  }),

  excluir: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.id, ctx.empresaId)
    assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)

    // SQLite roda sem PRAGMA foreign_keys=ON aqui — precisa apagar as
    // tabelas filhas na mão (mesmo motivo documentado em devolucoes.ts).
    await db.delete(propostaArquivos).where(eq(propostaArquivos.propostaId, input.id))
    await db.delete(propostaFeedbacks).where(eq(propostaFeedbacks.propostaId, input.id))
    await db.delete(propostaAlteracoes).where(eq(propostaAlteracoes.propostaId, input.id))
    await db.delete(propostaHistorico).where(eq(propostaHistorico.propostaId, input.id))
    await db.delete(propostas).where(eq(propostas.id, input.id))
    await registrarAuditoria({ tabela: 'propostas', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  // ── Arquivos ──────────────────────────────────────────────────────────
  listarArquivos: adminOrFeatureProcedure('propostas_odin').input(z.object({ propostaId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    return db.query.propostaArquivos.findMany({ where: eq(propostaArquivos.propostaId, input.propostaId), orderBy: (a, { desc }) => [desc(a.createdAt)] })
  }),

  registrarArquivo: adminOrFeatureProcedure('propostas_odin')
    .input(
      z.object({
        propostaId: z.number(),
        fileCategory: z.string().optional(),
        nomeOriginal: z.string(),
        nomeArmazenado: z.string(),
        tipoArquivo: z.string().optional(),
        tamanhoBytes: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaPropostas(ctx.empresaId)
      const proposta = await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
      assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)
      const result = await db.insert(propostaArquivos).values({ ...input, enviadoPor: ctx.user.id })
      return { id: Number(result.lastInsertRowid) }
    }),

  excluirArquivo: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number(), propostaId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    assertDonoOuGestor(proposta, ctx.user.id, ctx.user.role)
    await db.delete(propostaArquivos).where(and(eq(propostaArquivos.id, input.id), eq(propostaArquivos.propostaId, input.propostaId)))
    return { ok: true }
  }),

  // ── Feedbacks ─────────────────────────────────────────────────────────
  listarFeedbacks: adminOrFeatureProcedure('propostas_odin').input(z.object({ propostaId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    return db.query.propostaFeedbacks.findMany({ where: eq(propostaFeedbacks.propostaId, input.propostaId), with: { vendedor: { columns: { id: true, name: true } } }, orderBy: (f, { asc }) => [asc(f.createdAt)] })
  }),

  adicionarFeedback: adminOrFeatureProcedure('propostas_odin').input(z.object({ propostaId: z.number(), conteudo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    const result = await db.insert(propostaFeedbacks).values({ propostaId: input.propostaId, vendedorId: ctx.user.id, conteudo: input.conteudo })
    return { id: Number(result.lastInsertRowid) }
  }),

  // ── Solicitações de Alteração ────────────────────────────────────────
  listarAlteracoes: adminOrFeatureProcedure('propostas_odin').input(z.object({ propostaId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    return db.query.propostaAlteracoes.findMany({ where: eq(propostaAlteracoes.propostaId, input.propostaId), with: { solicitante: { columns: { id: true, name: true } } }, orderBy: (a, { asc }) => [asc(a.createdAt)] })
  }),

  solicitarAlteracao: adminOrFeatureProcedure('propostas_odin').input(z.object({ propostaId: z.number(), conteudo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    await db.insert(propostaAlteracoes).values({ propostaId: input.propostaId, solicitadoPor: ctx.user.id, conteudo: input.conteudo })
    await db.update(propostas).set({ stage: 'proposta', ultimaAlteracaoSolicitadaEm: agoraSqlite() }).where(eq(propostas.id, input.propostaId))
    await db.insert(propostaHistorico).values({ propostaId: input.propostaId, userId: ctx.user.id, etapaAnterior: proposta.stage, etapaNova: 'proposta', nota: `Alteração solicitada: ${input.conteudo}` })
    await notificarGestores(ctx.empresaId, 'Alteração solicitada em proposta', `${proposta.clienteNome} — ${ctx.user.name} solicitou alteração: ${input.conteudo.slice(0, 120)}`, 'warning')
    return { ok: true }
  }),

  historico: adminOrFeatureProcedure('propostas_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    await assertPropostaAlcancavel(input.id, ctx.empresaId)
    return db.query.propostaHistorico.findMany({ where: eq(propostaHistorico.propostaId, input.id), with: { user: { columns: { id: true, name: true } } }, orderBy: (h, { desc }) => [desc(h.createdAt)] })
  }),

  // ── Converter em Pedido ──────────────────────────────────────────────
  converter: adminProcedure.input(z.object({ propostaId: z.number(), clienteId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaPropostas(ctx.empresaId)
    const proposta = await assertPropostaAlcancavel(input.propostaId, ctx.empresaId)
    if (proposta.stage !== 'fechado') throw new TRPCError({ code: 'BAD_REQUEST', message: "Só é possível converter propostas no estágio 'Fechado'" })
    if (proposta.convertidoParaOrdemId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposta já foi convertida' })

    const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
    if (!cliente) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cliente não encontrado nessa empresa' })

    // Pré-popula a liberação financeira com os dados relevantes da proposta —
    // observations é o único espaço livre nessa etapa, então concentra tudo
    // que a proposta carregava e que senão se perderia na conversão.
    // Só o que a Liberação Financeira precisa da proposta: máquinas/itens,
    // condição de pagamento, comissão e revenda.
    const partes: string[] = []
    if (proposta.produtosDescricao) partes.push(`Máquinas/Itens: ${proposta.produtosDescricao}`)
    if (proposta.formaPagamento) partes.push(`Condição de pagamento: ${proposta.formaPagamento}`)
    if (proposta.comissao) partes.push(`Comissão: ${proposta.comissao}`)
    if (proposta.revenda) partes.push(`Revenda: ${proposta.revenda}`)

    const result = await db.insert(ordens).values({
      empresaId: ctx.empresaId,
      clienteId: input.clienteId,
      vendedorId: proposta.vendedorId,
      criadoPor: proposta.vendedorId,
      orderType: 'maquina',
      stage: 'liberacao_financeira',
    })
    const ordemId = Number(result.lastInsertRowid)
    await db.insert(ordemLiberacaoFinanceira).values({ ordemId, formaPagamento: proposta.formaPagamento, observacoes: partes.join('\n') || undefined })

    await db.update(propostas).set({ convertidoParaOrdemId: ordemId, stage: 'convertido', updatedAt: agoraSqlite() }).where(eq(propostas.id, input.propostaId))
    await db.insert(propostaHistorico).values({ propostaId: input.propostaId, userId: ctx.user.id, etapaAnterior: proposta.stage, etapaNova: 'convertido', nota: `Convertida em Pedido #${ordemId}` })
    await registrarAuditoria({ tabela: 'propostas', registroId: input.propostaId, acao: 'editar', campo: 'convertido_para_ordem_id', valorNovo: String(ordemId), alteradoPor: ctx.user.id })

    return { ordemId }
  }),
})
