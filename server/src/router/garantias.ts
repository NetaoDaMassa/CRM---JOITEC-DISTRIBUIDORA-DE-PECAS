// Módulo de Garantias (Odin Compressores) — pedido do João, 2026-10-02.
// Processo de atendimento (substituição de máquina/peça em garantia) +
// ETAPA 2 de oficina (avaliação técnica do item que retornou). Pode abrir
// vinculado a um Pedido existente (puxa cliente/máquina automático) ou
// avulso. Mesmo espírito arquitetural do módulo de Ordens (core.ts +
// garantiasGates.ts + garantiasStages.ts), só que bem mais simples (sem
// gates obrigatórios por etapa nesta primeira versão, pra testar o fluxo
// antes de travar regra).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import fs from 'fs'
import path from 'path'
import { router, adminProcedure, adminOrFeatureProcedure, gestorFeatureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { garantias, garantiaAnexos, garantiaOficina, garantiaHistorico, empresas, clientes, ordens } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { avancarEtapaGarantia, moverEtapaGarantia, registrarHistoricoGarantia } from '../lib/garantiasGates.js'
import { TIPO_ATENDIMENTO_VALUES, getStageSequence, comRetornoPadrao, destinoEnvioPadrao, type TipoAtendimento } from '../lib/garantiasStages.js'

// Módulo disponível só pra Odin Compressores — mesmo padrão de SLUG_ORDENS.
export const SLUG_GARANTIAS = 'odin-compressores'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

async function assertEmpresaGarantias(empresaId: number) {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId) })
  if (empresa?.slug !== SLUG_GARANTIAS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Módulo disponível só pra Odin Compressores' })
}

async function obterGarantia(id: number, empresaId: number) {
  const garantia = await db.query.garantias.findFirst({ where: and(eq(garantias.id, id), eq(garantias.empresaId, empresaId)) })
  if (!garantia) throw new TRPCError({ code: 'NOT_FOUND', message: 'Processo de garantia não encontrado' })
  return garantia
}

// Campos editáveis por etapa — um mutation genérico cobre todas as etapas
// (a maioria tem só 1-2 campos), em vez de uma mutation por etapa.
const CamposEtapaSchema = z.object({
  descricaoDefeito: z.string().optional(),
  modeloMaquina: z.string().optional(),
  numeroSerie: z.string().optional(),
  tecnicoNome: z.string().optional(),
  tecnicoWhatsapp: z.string().optional(),
  nfDevolucaoNumero: z.string().optional(),
  nfDevolucaoData: z.string().optional(),
  preparacaoNovoItemEm: z.string().optional(),
  preparacaoObservacao: z.string().optional(),
  nfSaidaNumero: z.string().optional(),
  nfSaidaData: z.string().optional(),
  envioTransportadora: z.string().optional(),
  envioCodigoRastreio: z.string().optional(),
  rastreioObservacao: z.string().optional(),
  retornoSolicitadoEm: z.string().optional(),
  retornoObservacao: z.string().optional(),
  recebidoOdinEm: z.string().optional(),
})

export const garantiasCoreRouter = router({
  listarKanban: adminOrFeatureProcedure('garantias_odin').input(z.object({ comRetorno: z.boolean() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    return db.query.garantias.findMany({
      where: and(eq(garantias.empresaId, ctx.empresaId), eq(garantias.comRetorno, input.comRetorno)),
      with: {
        cliente: { columns: { id: true, razaoSocial: true, codigo: true, telefoneWhatsapp: true } },
        pedido: { columns: { id: true } },
      },
      orderBy: (g, { desc }) => [desc(g.updatedAt)],
    })
  }),

  contarAtivos: adminOrFeatureProcedure('garantias_odin').query(async ({ ctx }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const rows = await db.query.garantias.findMany({ where: and(eq(garantias.empresaId, ctx.empresaId), eq(garantias.status, 'ativo')), columns: { id: true } })
    return rows.length
  }),

  // Pra pré-preencher o formulário de abertura quando vem de um Pedido
  // existente — puxa cliente + primeira máquina cadastrada no pedido.
  obterDadosPedido: adminOrFeatureProcedure('garantias_odin').input(z.object({ pedidoId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const pedido = await db.query.ordens.findFirst({
      where: and(eq(ordens.id, input.pedidoId), eq(ordens.empresaId, ctx.empresaId)),
      with: { cliente: { columns: { id: true, razaoSocial: true } }, maquinas: true },
    })
    if (!pedido) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pedido não encontrado' })
    const primeiraMaquina = pedido.maquinas[0]
    return {
      clienteId: pedido.clienteId,
      clienteNome: pedido.cliente?.razaoSocial ?? null,
      modeloMaquina: primeiraMaquina?.modelo ?? null,
      numeroSerie: primeiraMaquina?.numeroSerie ?? null,
    }
  }),

  criar: adminOrFeatureProcedure('garantias_odin')
    .input(
      z.object({
        pedidoId: z.number().optional(),
        clienteId: z.number(),
        tipoAtendimento: z.enum(TIPO_ATENDIMENTO_VALUES),
        comRetorno: z.boolean().optional(), // obrigatório só pra 'peca_tecnico'
        descricaoDefeito: z.string().min(1),
        modeloMaquina: z.string().optional(),
        numeroSerie: z.string().optional(),
        tecnicoNome: z.string().optional(),
        tecnicoWhatsapp: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaGarantias(ctx.empresaId)
      const cliente = await db.query.clientes.findFirst({ where: and(eq(clientes.id, input.clienteId), eq(clientes.empresaId, ctx.empresaId)) })
      if (!cliente) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cliente não encontrado nessa empresa' })

      if (input.pedidoId) {
        const pedido = await db.query.ordens.findFirst({ where: and(eq(ordens.id, input.pedidoId), eq(ordens.empresaId, ctx.empresaId)) })
        if (!pedido) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pedido não encontrado nessa empresa' })
      }

      const padrao = comRetornoPadrao(input.tipoAtendimento as TipoAtendimento)
      const comRetorno = padrao ?? input.comRetorno
      if (comRetorno == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe se esse processo tem retorno do item danificado' })

      const destinoEnvio = destinoEnvioPadrao(input.tipoAtendimento as TipoAtendimento)
      if (destinoEnvio === 'tecnico' && !input.tecnicoNome) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Informe o nome do técnico autorizado' })
      }

      const sequencia = getStageSequence(comRetorno)
      const result = await db.insert(garantias).values({
        empresaId: ctx.empresaId,
        pedidoId: input.pedidoId,
        clienteId: input.clienteId,
        criadoPor: ctx.user.id,
        tipoAtendimento: input.tipoAtendimento,
        comRetorno,
        destinoEnvio,
        descricaoDefeito: input.descricaoDefeito,
        modeloMaquina: input.modeloMaquina,
        numeroSerie: input.numeroSerie,
        tecnicoNome: input.tecnicoNome,
        tecnicoWhatsapp: input.tecnicoWhatsapp,
        stage: sequencia[0],
      })
      const garantiaId = Number(result.lastInsertRowid)

      await registrarHistoricoGarantia({ garantiaId, userId: ctx.user.id, action: 'create', description: 'Processo de garantia aberto', stage: sequencia[0] })
      await registrarAuditoria({ tabela: 'garantias', registroId: garantiaId, acao: 'criar', alteradoPor: ctx.user.id })

      return { id: garantiaId }
    }),

  obterPorId: adminOrFeatureProcedure('garantias_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const garantia = await db.query.garantias.findFirst({
      where: and(eq(garantias.id, input.id), eq(garantias.empresaId, ctx.empresaId)),
      with: {
        cliente: true,
        pedido: { columns: { id: true } },
        oficina: true,
      },
    })
    if (!garantia) throw new TRPCError({ code: 'NOT_FOUND', message: 'Processo não encontrado' })
    return garantia
  }),

  atualizarCampos: adminOrFeatureProcedure('garantias_odin')
    .input(z.object({ id: z.number() }).merge(CamposEtapaSchema))
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaGarantias(ctx.empresaId)
      const { id, ...campos } = input
      await obterGarantia(id, ctx.empresaId)
      await db.update(garantias).set({ ...campos, updatedAt: agoraSqlite() }).where(eq(garantias.id, id))
      return { ok: true }
    }),

  avancar: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    return avancarEtapaGarantia({ garantiaId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id })
  }),

  mover: adminProcedure.input(z.object({ id: z.number(), novaEtapa: z.string() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    return moverEtapaGarantia({ garantiaId: input.id, empresaId: ctx.empresaId, userId: ctx.user.id, novaEtapa: input.novaEtapa })
  }),

  cancelar: adminProcedure.input(z.object({ id: z.number(), motivo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const garantia = await obterGarantia(input.id, ctx.empresaId)
    if (garantia.status !== 'ativo') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Processo não está ativo' })
    await db.update(garantias).set({ status: 'cancelado', cancelMotivo: input.motivo, updatedAt: agoraSqlite() }).where(eq(garantias.id, input.id))
    await registrarHistoricoGarantia({ garantiaId: input.id, userId: ctx.user.id, action: 'cancelled', description: `Processo cancelado: ${input.motivo}`, stage: garantia.stage })
    return { ok: true }
  }),

  historico: adminOrFeatureProcedure('garantias_odin').input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    await obterGarantia(input.id, ctx.empresaId)
    return db.query.garantiaHistorico.findMany({
      where: eq(garantiaHistorico.garantiaId, input.id),
      with: { user: { columns: { id: true, name: true } } },
      orderBy: (h, { desc }) => [desc(h.createdAt)],
    })
  }),
})

export const garantiasAnexosRouter = router({
  listar: adminOrFeatureProcedure('garantias_odin').input(z.object({ garantiaId: z.number(), stage: z.string().optional() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    await obterGarantia(input.garantiaId, ctx.empresaId)
    return db.query.garantiaAnexos.findMany({
      where: input.stage ? and(eq(garantiaAnexos.garantiaId, input.garantiaId), eq(garantiaAnexos.stage, input.stage)) : eq(garantiaAnexos.garantiaId, input.garantiaId),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    })
  }),

  registrar: adminOrFeatureProcedure('garantias_odin')
    .input(
      z.object({
        garantiaId: z.number(),
        stage: z.string(),
        nomeOriginal: z.string(),
        nomeArmazenado: z.string(),
        tipoArquivo: z.string().optional(),
        tamanhoBytes: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaGarantias(ctx.empresaId)
      const garantia = await obterGarantia(input.garantiaId, ctx.empresaId)
      const result = await db.insert(garantiaAnexos).values({ ...input, enviadoPor: ctx.user.id })
      await registrarHistoricoGarantia({ garantiaId: input.garantiaId, userId: ctx.user.id, action: 'file_upload', description: `Arquivo "${input.nomeOriginal}" anexado`, stage: garantia.stage })
      return { id: Number(result.lastInsertRowid) }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number(), garantiaId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const garantia = await obterGarantia(input.garantiaId, ctx.empresaId)
    const anexo = await db.query.garantiaAnexos.findFirst({ where: and(eq(garantiaAnexos.id, input.id), eq(garantiaAnexos.garantiaId, input.garantiaId)) })
    if (!anexo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Anexo não encontrado' })
    await db.delete(garantiaAnexos).where(eq(garantiaAnexos.id, input.id))
    const caminho = path.resolve(UPLOADS_DIR, anexo.nomeArmazenado)
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho)
    await registrarHistoricoGarantia({ garantiaId: input.garantiaId, userId: ctx.user.id, action: 'file_delete', description: `Arquivo "${anexo.nomeOriginal}" removido`, stage: garantia.stage })
    return { ok: true }
  }),
})

// ETAPA 2 — oficina/manutenção. `gestorFeatureProcedure` deixa um usuário
// não-admin (ex: pessoa de Manutenção, role 'vendor' com a feature
// concedida em Permissões) mexer aqui sem virar admin de verdade; admin e
// superAdmin sempre passam.
export const garantiasOficinaRouter = router({
  obter: gestorFeatureProcedure('garantias_oficina').input(z.object({ garantiaId: z.number() })).query(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    await obterGarantia(input.garantiaId, ctx.empresaId)
    return db.query.garantiaOficina.findFirst({ where: eq(garantiaOficina.garantiaId, input.garantiaId) })
  }),

  atualizar: gestorFeatureProcedure('garantias_oficina')
    .input(
      z.object({
        garantiaId: z.number(),
        entradaEm: z.string().optional(),
        modelo: z.string().optional(),
        numeroSerie: z.string().optional(),
        nomeCliente: z.string().optional(),
        avaliacaoTecnica: z.string().optional(),
        destinacao: z.enum(['reparo', 'descarte', 'retorno_estoque', 'sem_conserto']).optional(),
        pecasUsadas: z.string().optional(),
        entregaEstoqueEm: z.string().optional(),
        entreguePor: z.string().optional(),
        recebidoPor: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertEmpresaGarantias(ctx.empresaId)
      const garantia = await obterGarantia(input.garantiaId, ctx.empresaId)
      const { garantiaId, ...campos } = input
      const existente = await db.query.garantiaOficina.findFirst({ where: eq(garantiaOficina.garantiaId, garantiaId) })
      if (!existente) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Processo ainda não chegou na etapa de oficina' })
      await db.update(garantiaOficina).set({ ...campos, updatedAt: agoraSqlite() }).where(eq(garantiaOficina.garantiaId, garantiaId))
      await registrarHistoricoGarantia({ garantiaId, userId: ctx.user.id, action: 'update', description: 'Dados da oficina atualizados', stage: garantia.stage })
      return { ok: true }
    }),

  // Aprovar = registra quem/quando aprovou a destinação definida — não
  // precisa estar numa etapa específica, só exige destinacao já escolhida.
  aprovar: gestorFeatureProcedure('garantias_oficina').input(z.object({ garantiaId: z.number() })).mutation(async ({ ctx, input }) => {
    await assertEmpresaGarantias(ctx.empresaId)
    const garantia = await obterGarantia(input.garantiaId, ctx.empresaId)
    const oficina = await db.query.garantiaOficina.findFirst({ where: eq(garantiaOficina.garantiaId, input.garantiaId) })
    if (!oficina?.destinacao) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Defina a destinação (reparo/descarte/retorno ao estoque) antes de aprovar' })
    await db.update(garantiaOficina).set({ aprovadoPor: ctx.user.id, aprovadoEm: agoraSqlite(), updatedAt: agoraSqlite() }).where(eq(garantiaOficina.garantiaId, input.garantiaId))
    await registrarHistoricoGarantia({ garantiaId: input.garantiaId, userId: ctx.user.id, action: 'update', description: 'Destinação da oficina aprovada', stage: garantia.stage })
    return { ok: true }
  }),
})

export const garantiasRouter = router({
  core: garantiasCoreRouter,
  anexos: garantiasAnexosRouter,
  oficina: garantiasOficinaRouter,
})
