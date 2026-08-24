import { z } from 'zod'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { router, protectedProcedure, publicProcedure, adminProcedure, adminOrFeatureProcedure, temFeature } from './_base.js'
import { db } from '../db/client.js'
import {
  devolucaoChamados,
  devolucaoOcorrencias,
  devolucaoMateriais,
  devolucaoAnexos,
  devolucaoHistoricoStatus,
  devolucaoAnalises,
  devolucaoAnaliseProdutos,
  devolucaoMecanicaItens,
  devolucaoMecanicaHistorico,
  devolucaoAtualizacoes,
  devolucaoServicos,
  devolucaoDemonstracoes,
  devolucaoDemonstracaoItens,
  empresas,
} from '../db/schema.js'
import { agoraSqlite, hojeBrString } from '../lib/dataBr.js'
import { registrarAuditoria } from '../lib/auditoria.js'
import { EMPRESAS_DEVOLUCAO, gerarProtocoloDevolucao } from '../lib/devolucaoProtocolo.js'

const STATUS_VALUES = [
  'novo',
  'em_andamento',
  'analise',
  'nota_fiscal_devolucao',
  'chegada_materiais',
  'preparacao_envio',
  'rastreio_transportadora',
  'finalizado',
] as const

const OCORRENCIA_VALUES = ['envio_errado', 'falta_materiais', 'produto_defeito', 'outro'] as const

// Remove os campos sigilosos da análise (quem errou / impacto na comissão)
// quando quem está pedindo não tem a feature 'devolucoes_ver_comissao' — a
// mesma regra do sistema original (nunca manda esses campos na resposta,
// não é só esconder na tela). Admin/superAdmin sempre veem.
async function sanitizarAnalise<T extends Record<string, unknown> | null>(
  analise: T,
  userId: number,
  role: 'admin' | 'vendor',
  superAdmin: boolean
): Promise<T> {
  if (!analise) return analise
  if (role === 'admin' || superAdmin) return analise
  if (await temFeature(userId, 'devolucoes_ver_comissao')) return analise
  const { quemErrou, impactaComissao, valorImpactoComissao, ...resto } = analise as Record<string, unknown>
  return resto as T
}

// Normalmente um admin só alcança a própria empresa (ctx.empresaId). Quem
// tem 'devolucoes_visao_global' (hoje só a Amanda, cujo trabalho é tratar
// devolução das 4 empresas do grupo, não uma só) alcança as 4 empresas do
// módulo de uma vez — sem precisar trocar de empresa/logar de novo pra
// cada uma.
async function empresasAlcancaveis(userId: number, empresaId: number, superAdmin: boolean): Promise<number[]> {
  if (superAdmin || (await temFeature(userId, 'devolucoes_visao_global'))) return EMPRESAS_DEVOLUCAO
  return [empresaId]
}

async function assertChamadoAlcancavel(chamadoId: number, empresaIds: number[]) {
  const chamado = await db.query.devolucaoChamados.findFirst({ where: eq(devolucaoChamados.id, chamadoId) })
  if (!chamado || !empresaIds.includes(chamado.empresaId)) throw new Error('Chamado não encontrado')
  return chamado
}

export const devolucoesRouter = router({
  // ── Público (formulário do cliente, sem login) ───────────────────────
  listarEmpresasPublico: publicProcedure.query(async () => {
    return db.query.empresas.findMany({
      where: inArray(empresas.id, EMPRESAS_DEVOLUCAO),
      columns: { id: true, nome: true },
      orderBy: (e, { asc }) => [asc(e.nome)],
    })
  }),

  criarPublico: publicProcedure
    .input(
      z.object({
        empresaId: z.number(),
        clienteNome: z.string().min(2),
        clienteCnpj: z.string().optional(),
        clienteWhatsapp: z.string().optional(),
        clienteEmail: z.string().optional(),
        clienteCodigo: z.string().optional(),
        numeroNotaFiscal: z.string().optional(),
        descricao: z.string().min(1),
        ocorrencias: z.array(z.object({ tipo: z.enum(OCORRENCIA_VALUES), rotuloCustom: z.string().optional() })).min(1),
        materiais: z.array(z.object({ codigoItem: z.string(), descricaoItem: z.string(), quantidade: z.number().default(1) })).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!EMPRESAS_DEVOLUCAO.includes(input.empresaId)) throw new Error('Empresa inválida')
      const protocolo = await gerarProtocoloDevolucao(input.empresaId)

      const result = await db.insert(devolucaoChamados).values({
        empresaId: input.empresaId,
        protocolo,
        origem: 'cliente',
        clienteNome: input.clienteNome,
        clienteCnpj: input.clienteCnpj,
        clienteWhatsapp: input.clienteWhatsapp,
        clienteEmail: input.clienteEmail,
        clienteCodigo: input.clienteCodigo,
        numeroNotaFiscal: input.numeroNotaFiscal,
        descricao: input.descricao,
      })
      const chamadoId = Number(result.lastInsertRowid)

      for (const oc of input.ocorrencias) {
        await db.insert(devolucaoOcorrencias).values({ chamadoId, tipo: oc.tipo, rotuloCustom: oc.rotuloCustom })
      }
      for (const m of input.materiais ?? []) {
        await db.insert(devolucaoMateriais).values({ chamadoId, codigoItem: m.codigoItem, descricaoItem: m.descricaoItem, quantidade: m.quantidade })
      }
      await db.insert(devolucaoHistoricoStatus).values({ chamadoId, statusAnterior: null, statusNovo: 'novo' })

      return { protocolo, chamadoId }
    }),

  anexarArquivoPublico: publicProcedure
    .input(z.object({ protocolo: z.string(), urlArquivo: z.string(), nomeArquivo: z.string(), tipoArquivo: z.string().optional() }))
    .mutation(async ({ input }) => {
      const chamado = await db.query.devolucaoChamados.findFirst({ where: eq(devolucaoChamados.protocolo, input.protocolo) })
      if (!chamado) throw new Error('Chamado não encontrado')
      await db.insert(devolucaoAnexos).values({
        chamadoId: chamado.id,
        contexto: 'abertura',
        urlArquivo: input.urlArquivo,
        nomeArquivo: input.nomeArquivo,
        tipoArquivo: input.tipoArquivo,
      })
      return { ok: true }
    }),

  rastrearPublico: publicProcedure.input(z.object({ protocolo: z.string() })).query(async ({ input }) => {
    const chamado = await db.query.devolucaoChamados.findFirst({
      where: eq(devolucaoChamados.protocolo, input.protocolo),
      columns: { id: true, protocolo: true, status: true, descricao: true, createdAt: true, fechadoEm: true },
    })
    if (!chamado) throw new Error('Protocolo não encontrado')
    const historico = await db.query.devolucaoHistoricoStatus.findMany({
      where: eq(devolucaoHistoricoStatus.chamadoId, chamado.id),
      columns: { statusNovo: true, alteradoEm: true },
      orderBy: (h, { asc }) => [asc(h.alteradoEm)],
    })
    const { id: _id, ...resto } = chamado
    return { ...resto, historico }
  }),

  // ── Chamados (uso interno) ────────────────────────────────────────────
  listar: adminOrFeatureProcedure('devolucoes').query(async ({ ctx }) => {
    const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    return db.query.devolucaoChamados.findMany({
      where: souAdmin
        ? inArray(devolucaoChamados.empresaId, alcancaveis)
        : and(eq(devolucaoChamados.empresaId, ctx.empresaId), eq(devolucaoChamados.vendedorId, ctx.user.id)),
      with: { vendedor: { columns: { name: true } }, ocorrencias: true, empresa: { columns: { nome: true } } },
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    })
  }),

  detalhe: adminOrFeatureProcedure('devolucoes')
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const chamado = await db.query.devolucaoChamados.findFirst({
        where: eq(devolucaoChamados.id, input.id),
        with: {
          vendedor: { columns: { name: true } },
          empresa: { columns: { nome: true } },
          ocorrencias: true,
          materiais: true,
          anexos: true,
          historicoStatus: { orderBy: (h, { asc }) => [asc(h.alteradoEm)] },
          analise: { with: { produtos: true } },
          atualizacoes: { with: { autor: { columns: { name: true } } }, orderBy: (a, { asc }) => [asc(a.createdAt)] },
          servicos: true,
        },
      })
      if (!chamado || !alcancaveis.includes(chamado.empresaId)) throw new Error('Chamado não encontrado')
      if (!souAdmin && chamado.vendedorId !== ctx.user.id) throw new Error('Chamado não encontrado')

      return { ...chamado, analise: await sanitizarAnalise(chamado.analise, ctx.user.id, ctx.user.role, ctx.user.superAdmin) }
    }),

  criar: adminOrFeatureProcedure('devolucoes')
    .input(
      z.object({
        clienteNome: z.string().min(2),
        clienteCnpj: z.string().optional(),
        clienteWhatsapp: z.string().optional(),
        clienteEmail: z.string().optional(),
        clienteCodigo: z.string().optional(),
        numeroNotaFiscal: z.string().optional(),
        numeroNotaFiscalVenda: z.string().optional(),
        numeroPedidoVenda: z.string().optional(),
        descricao: z.string().min(1),
        observacao: z.string().optional(),
        vendedorId: z.number().optional(),
        ocorrencias: z.array(z.object({ tipo: z.enum(OCORRENCIA_VALUES), rotuloCustom: z.string().optional() })).min(1),
        materiais: z.array(z.object({ codigoItem: z.string(), descricaoItem: z.string(), quantidade: z.number().default(1) })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const vendedorId = souAdmin ? input.vendedorId ?? null : ctx.user.id
      const protocolo = await gerarProtocoloDevolucao(ctx.empresaId)

      const result = await db.insert(devolucaoChamados).values({
        empresaId: ctx.empresaId,
        protocolo,
        origem: 'vendedor',
        criadoPorUserId: ctx.user.id,
        vendedorId,
        clienteNome: input.clienteNome,
        clienteCnpj: input.clienteCnpj,
        clienteWhatsapp: input.clienteWhatsapp,
        clienteEmail: input.clienteEmail,
        clienteCodigo: input.clienteCodigo,
        numeroNotaFiscal: input.numeroNotaFiscal,
        numeroNotaFiscalVenda: input.numeroNotaFiscalVenda,
        numeroPedidoVenda: input.numeroPedidoVenda,
        descricao: input.descricao,
        observacao: input.observacao,
      })
      const chamadoId = Number(result.lastInsertRowid)

      for (const oc of input.ocorrencias) {
        await db.insert(devolucaoOcorrencias).values({ chamadoId, tipo: oc.tipo, rotuloCustom: oc.rotuloCustom })
      }
      for (const m of input.materiais ?? []) {
        await db.insert(devolucaoMateriais).values({ chamadoId, codigoItem: m.codigoItem, descricaoItem: m.descricaoItem, quantidade: m.quantidade })
      }
      await db.insert(devolucaoHistoricoStatus).values({ chamadoId, statusAnterior: null, statusNovo: 'novo', alteradoPorUserId: ctx.user.id })
      await registrarAuditoria({ tabela: 'devolucao_chamados', registroId: chamadoId, acao: 'criar', alteradoPor: ctx.user.id })

      return { id: chamadoId, protocolo }
    }),

  // Só admin arrasta o Kanban — mesma regra do sistema original ("só Admin
  // arrasta"). Um vendedor com a feature 'devolucoes' pode abrir/ver/
  // comentar chamado, mas não muda status.
  atualizarStatus: adminProcedure
    .input(z.object({ id: z.number(), status: z.enum(STATUS_VALUES), nota: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const chamado = await assertChamadoAlcancavel(input.id, alcancaveis)

      await db
        .update(devolucaoChamados)
        .set({ status: input.status, fechadoEm: input.status === 'finalizado' ? agoraSqlite() : chamado.fechadoEm })
        .where(eq(devolucaoChamados.id, input.id))

      await db.insert(devolucaoHistoricoStatus).values({
        chamadoId: input.id,
        statusAnterior: chamado.status,
        statusNovo: input.status,
        alteradoPorUserId: ctx.user.id,
        nota: input.nota,
      })
      await registrarAuditoria({
        tabela: 'devolucao_chamados',
        registroId: input.id,
        acao: 'mudar_etapa',
        campo: 'status',
        valorAnterior: chamado.status,
        valorNovo: input.status,
        alteradoPor: ctx.user.id,
      })
      return { ok: true }
    }),

  // Mudar de etapa pulando a ordem normal — só quem tem o poder especial
  // concedido (equivalente à exceção da Andreia no sistema original,
  // Odin Compressores). Continua exigindo ser admin por baixo.
  finalizarForaDeOrdem: adminProcedure.input(z.object({ id: z.number(), nota: z.string().optional() })).mutation(async ({ ctx, input }) => {
    if (!(await temFeature(ctx.user.id, 'devolucoes_finalizar_fora_ordem'))) throw new Error('Sem permissão pra finalizar fora de ordem')
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    const chamado = await assertChamadoAlcancavel(input.id, alcancaveis)

    await db.update(devolucaoChamados).set({ status: 'finalizado', fechadoEm: agoraSqlite() }).where(eq(devolucaoChamados.id, input.id))
    await db.insert(devolucaoHistoricoStatus).values({
      chamadoId: input.id,
      statusAnterior: chamado.status,
      statusNovo: 'finalizado',
      alteradoPorUserId: ctx.user.id,
      nota: input.nota ?? 'Finalizado fora de ordem',
    })
    await registrarAuditoria({
      tabela: 'devolucao_chamados',
      registroId: input.id,
      acao: 'mudar_etapa',
      campo: 'status',
      valorAnterior: chamado.status,
      valorNovo: 'finalizado (fora de ordem)',
      alteradoPor: ctx.user.id,
    })
    return { ok: true }
  }),

  atribuirVendedor: adminProcedure.input(z.object({ id: z.number(), vendedorId: z.number().nullable() })).mutation(async ({ ctx, input }) => {
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    await assertChamadoAlcancavel(input.id, alcancaveis)
    await db.update(devolucaoChamados).set({ vendedorId: input.vendedorId }).where(eq(devolucaoChamados.id, input.id))
    return { ok: true }
  }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    if (!(await temFeature(ctx.user.id, 'devolucoes_excluir_chamado'))) throw new Error('Sem permissão pra excluir chamado')
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    await assertChamadoAlcancavel(input.id, alcancaveis)
    await db.delete(devolucaoChamados).where(eq(devolucaoChamados.id, input.id))
    await registrarAuditoria({ tabela: 'devolucao_chamados', registroId: input.id, acao: 'excluir', alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  registrarAnalise: adminProcedure
    .input(
      z.object({
        chamadoId: z.number(),
        resultado: z.enum(['positivo', 'negativo']),
        motivoNegativa: z.string().optional(),
        creditoRestante: z.number().optional(),
        quemErrou: z.enum(['cliente', 'estoque', 'transportadora', 'vendedor', 'defeito']).optional(),
        tipoResolucao: z.enum(['saldo_credito', 'troca_produto', 'abatimento_boleto', 'dinheiro_volta', 'envio_materiais']).optional(),
        impactaComissao: z.boolean().default(false),
        valorImpactoComissao: z.number().optional(),
        produtos: z.array(z.object({ codigoProduto: z.string().optional(), descricaoProduto: z.string(), quantidade: z.number().default(1) })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alcancaveisAnalise = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      await assertChamadoAlcancavel(input.chamadoId, alcancaveisAnalise)
      if (input.resultado === 'negativo' && !input.motivoNegativa) throw new Error('Motivo da negativa é obrigatório')
      if (input.impactaComissao && input.valorImpactoComissao === undefined) throw new Error('Valor do impacto na comissão é obrigatório')

      const existente = await db.query.devolucaoAnalises.findFirst({ where: eq(devolucaoAnalises.chamadoId, input.chamadoId) })
      if (existente) {
        await db
          .update(devolucaoAnalises)
          .set({
            resultado: input.resultado,
            motivoNegativa: input.motivoNegativa,
            creditoRestante: input.creditoRestante,
            quemErrou: input.quemErrou,
            tipoResolucao: input.tipoResolucao,
            impactaComissao: input.impactaComissao,
            valorImpactoComissao: input.valorImpactoComissao,
            analisadoPorUserId: ctx.user.id,
            analisadoEm: agoraSqlite(),
          })
          .where(eq(devolucaoAnalises.id, existente.id))
        await db.delete(devolucaoAnaliseProdutos).where(eq(devolucaoAnaliseProdutos.analiseId, existente.id))
        for (const p of input.produtos ?? []) {
          await db.insert(devolucaoAnaliseProdutos).values({ analiseId: existente.id, ...p })
        }
      } else {
        const result = await db.insert(devolucaoAnalises).values({
          chamadoId: input.chamadoId,
          resultado: input.resultado,
          motivoNegativa: input.motivoNegativa,
          creditoRestante: input.creditoRestante,
          quemErrou: input.quemErrou,
          tipoResolucao: input.tipoResolucao,
          impactaComissao: input.impactaComissao,
          valorImpactoComissao: input.valorImpactoComissao,
          analisadoPorUserId: ctx.user.id,
        })
        const analiseId = Number(result.lastInsertRowid)
        for (const p of input.produtos ?? []) {
          await db.insert(devolucaoAnaliseProdutos).values({ analiseId, ...p })
        }
      }
      return { ok: true }
    }),

  registrarServico: adminProcedure
    .input(
      z.object({
        chamadoId: z.number(),
        teveServico: z.boolean(),
        valorCobrado: z.number().optional(),
        horasTrabalhadas: z.number().optional(),
        executadoPor: z.string().optional(),
        statusPagamento: z.enum(['credito', 'pago']).optional(),
        valorFinal: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alcancaveisServico = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      await assertChamadoAlcancavel(input.chamadoId, alcancaveisServico)
      const existente = await db.query.devolucaoServicos.findFirst({ where: eq(devolucaoServicos.chamadoId, input.chamadoId) })
      const valores = {
        teveServico: input.teveServico,
        valorCobrado: input.valorCobrado,
        horasTrabalhadas: input.horasTrabalhadas,
        executadoPor: input.executadoPor,
        statusPagamento: input.statusPagamento,
        valorFinal: input.valorFinal,
        registradoPorUserId: ctx.user.id,
        registradoEm: agoraSqlite(),
      }
      if (existente) {
        await db.update(devolucaoServicos).set(valores).where(eq(devolucaoServicos.id, existente.id))
      } else {
        await db.insert(devolucaoServicos).values({ chamadoId: input.chamadoId, ...valores })
      }
      return { ok: true }
    }),

  adicionarAtualizacao: adminOrFeatureProcedure('devolucoes')
    .input(z.object({ chamadoId: z.number(), mensagem: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const chamado = await assertChamadoAlcancavel(input.chamadoId, alcancaveis)
      if (!souAdmin && chamado.vendedorId !== ctx.user.id) throw new Error('Chamado não encontrado')
      await db.insert(devolucaoAtualizacoes).values({ chamadoId: input.chamadoId, autorUserId: ctx.user.id, mensagem: input.mensagem })
      return { ok: true }
    }),

  anexarArquivo: adminOrFeatureProcedure('devolucoes')
    .input(
      z.object({
        chamadoId: z.number(),
        contexto: z.enum(['abertura', 'analise', 'mecanica']).default('abertura'),
        urlArquivo: z.string(),
        nomeArquivo: z.string(),
        tipoArquivo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const chamado = await assertChamadoAlcancavel(input.chamadoId, alcancaveis)
      if (!souAdmin && chamado.vendedorId !== ctx.user.id) throw new Error('Chamado não encontrado')
      await db.insert(devolucaoAnexos).values({
        chamadoId: input.chamadoId,
        contexto: input.contexto,
        urlArquivo: input.urlArquivo,
        nomeArquivo: input.nomeArquivo,
        tipoArquivo: input.tipoArquivo,
        enviadoPorUserId: ctx.user.id,
      })
      return { ok: true }
    }),

  // ── Mecânica (sub-kanban, independente do Kanban principal) ──────────
  enviarParaMecanica: adminProcedure
    .input(
      z.object({
        chamadoId: z.number(),
        itens: z.array(z.object({ codigoItem: z.string(), descricaoItem: z.string(), quantidade: z.number().default(1) })).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alcancaveisMec = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const chamado = await assertChamadoAlcancavel(input.chamadoId, alcancaveisMec)
      for (const item of input.itens) {
        const result = await db.insert(devolucaoMecanicaItens).values({
          chamadoId: input.chamadoId,
          empresaId: chamado.empresaId,
          codigoItem: item.codigoItem,
          descricaoItem: item.descricaoItem,
          quantidade: item.quantidade,
          enviadoEm: agoraSqlite(),
        })
        await db.insert(devolucaoMecanicaHistorico).values({
          itemId: Number(result.lastInsertRowid),
          statusAnterior: null,
          statusNovo: 'enviado',
          alteradoPorUserId: ctx.user.id,
        })
      }
      return { ok: true }
    }),

  listarMecanica: adminOrFeatureProcedure('devolucoes_mecanica').query(async ({ ctx }) => {
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    return db.query.devolucaoMecanicaItens.findMany({
      where: inArray(devolucaoMecanicaItens.empresaId, alcancaveis),
      with: { chamado: { columns: { protocolo: true, clienteNome: true } }, empresa: { columns: { nome: true } } },
      orderBy: (i, { desc }) => [desc(i.createdAt)],
    })
  }),

  atualizarStatusMecanica: adminOrFeatureProcedure('devolucoes_mecanica')
    .input(
      z.object({
        id: z.number(),
        status: z.enum(['enviado', 'retornado', 'testado', 'arrumado', 'descarte', 'recebido', 'manutencao']),
        observacao: z.string().optional(),
        descricaoManutencao: z.string().optional(),
        condicaoRetorno: z.enum(['novo', 'usado']).optional(),
        motivoDescarte: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alcancaveisItem = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const item = await db.query.devolucaoMecanicaItens.findFirst({ where: eq(devolucaoMecanicaItens.id, input.id) })
      if (!item || !alcancaveisItem.includes(item.empresaId)) throw new Error('Item não encontrado')
      if (input.status === 'descarte' && !input.motivoDescarte) throw new Error('Motivo do descarte é obrigatório')
      if (item.status === 'retornado' && input.status === 'testado' && !input.condicaoRetorno) {
        throw new Error('Condição do retorno (novo/usado) é obrigatória')
      }

      const agora = agoraSqlite()
      const carimbos: Record<string, string> = {}
      if (input.status === 'enviado') carimbos.enviadoEm = agora
      if (input.status === 'retornado') carimbos.retornadoEm = agora
      if (input.status === 'testado') carimbos.testadoEm = agora
      if (input.status === 'arrumado' || input.status === 'descarte') carimbos.resolvidoEm = agora

      await db
        .update(devolucaoMecanicaItens)
        .set({
          status: input.status,
          observacao: input.observacao ?? item.observacao,
          descricaoManutencao: input.descricaoManutencao ?? item.descricaoManutencao,
          condicaoRetorno: input.condicaoRetorno ?? item.condicaoRetorno,
          motivoDescarte: input.motivoDescarte ?? item.motivoDescarte,
          atualizadoPorUserId: ctx.user.id,
          updatedAt: agora,
          ...carimbos,
        })
        .where(eq(devolucaoMecanicaItens.id, input.id))

      await db.insert(devolucaoMecanicaHistorico).values({
        itemId: input.id,
        statusAnterior: item.status,
        statusNovo: input.status,
        alteradoPorUserId: ctx.user.id,
      })
      return { ok: true }
    }),

  // ── Demonstração ───────────────────────────────────────────────────
  listarDemonstracoes: adminOrFeatureProcedure('devolucoes_demonstracao').query(async ({ ctx }) => {
    const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    return db.query.devolucaoDemonstracoes.findMany({
      where: souAdmin
        ? inArray(devolucaoDemonstracoes.empresaId, alcancaveis)
        : and(eq(devolucaoDemonstracoes.empresaId, ctx.empresaId), eq(devolucaoDemonstracoes.vendedorId, ctx.user.id)),
      with: { vendedor: { columns: { name: true } }, itens: true, empresa: { columns: { nome: true } } },
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    })
  }),

  criarDemonstracao: adminOrFeatureProcedure('devolucoes_demonstracao')
    .input(
      z.object({
        clienteNome: z.string().min(2),
        clienteCnpj: z.string().optional(),
        clienteLocalizacao: z.string().optional(),
        anexoNotaUrl: z.string().optional(),
        retornoPrevistoEm: z.string().optional(),
        observacao: z.string().optional(),
        vendedorId: z.number().optional(),
        itens: z.array(z.object({ descricaoProduto: z.string(), numeroSerie: z.string().optional(), quantidade: z.number().default(1) })).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
      const vendedorId = souAdmin && input.vendedorId ? input.vendedorId : ctx.user.id

      const result = await db.insert(devolucaoDemonstracoes).values({
        empresaId: ctx.empresaId,
        clienteNome: input.clienteNome,
        clienteCnpj: input.clienteCnpj,
        clienteLocalizacao: input.clienteLocalizacao,
        anexoNotaUrl: input.anexoNotaUrl,
        vendedorId,
        enviadoEm: hojeBrString(),
        retornoPrevistoEm: input.retornoPrevistoEm,
        observacao: input.observacao,
        criadoPorUserId: ctx.user.id,
      })
      const demonstracaoId = Number(result.lastInsertRowid)
      for (const item of input.itens) {
        await db.insert(devolucaoDemonstracaoItens).values({ demonstracaoId, ...item })
      }
      return { id: demonstracaoId }
    }),

  atualizarStatusDemonstracao: adminOrFeatureProcedure('devolucoes_demonstracao')
    .input(z.object({ id: z.number(), status: z.enum(['ativa', 'retornada', 'convertida_venda', 'devolucao_aberta']) }))
    .mutation(async ({ ctx, input }) => {
      const alcancaveisDemo = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const demo = await db.query.devolucaoDemonstracoes.findFirst({ where: eq(devolucaoDemonstracoes.id, input.id) })
      if (!demo || !alcancaveisDemo.includes(demo.empresaId)) throw new Error('Demonstração não encontrada')
      await db.update(devolucaoDemonstracoes).set({ status: input.status, updatedAt: agoraSqlite() }).where(eq(devolucaoDemonstracoes.id, input.id))
      return { ok: true }
    }),

  renovarDemonstracao: adminOrFeatureProcedure('devolucoes_demonstracao')
    .input(z.object({ id: z.number(), novoRetornoPrevistoEm: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const alcancaveisRenovar = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
      const demo = await db.query.devolucaoDemonstracoes.findFirst({ where: eq(devolucaoDemonstracoes.id, input.id) })
      if (!demo || !alcancaveisRenovar.includes(demo.empresaId)) throw new Error('Demonstração não encontrada')
      await db
        .update(devolucaoDemonstracoes)
        .set({ retornoPrevistoEm: input.novoRetornoPrevistoEm, contagemRenovacao: demo.contagemRenovacao + 1, updatedAt: agoraSqlite() })
        .where(eq(devolucaoDemonstracoes.id, input.id))
      return { ok: true }
    }),

  // ── Relatório ──────────────────────────────────────────────────────
  // Um resumo só (não 9 endpoints separados como no sistema original) —
  // volume de dado é pequeno, uma consulta com os relacionamentos já dá
  // pra montar todos os gráficos. Respeita o mesmo escopo do resto do
  // módulo: vendedor só vê os próprios chamados, admin vê a empresa
  // (ou as 4, se tiver 'devolucoes_visao_global').
  relatorio: adminOrFeatureProcedure('devolucoes').query(async ({ ctx }) => {
    const souAdmin = ctx.user.role === 'admin' || ctx.user.superAdmin
    const alcancaveis = await empresasAlcancaveis(ctx.user.id, ctx.empresaId, ctx.user.superAdmin)
    const vejoComissao = souAdmin || (await temFeature(ctx.user.id, 'devolucoes_ver_comissao'))

    const chamados = await db.query.devolucaoChamados.findMany({
      where: souAdmin
        ? inArray(devolucaoChamados.empresaId, alcancaveis)
        : and(eq(devolucaoChamados.empresaId, ctx.empresaId), eq(devolucaoChamados.vendedorId, ctx.user.id)),
      columns: { id: true, status: true, empresaId: true, vendedorId: true, createdAt: true, fechadoEm: true },
      with: {
        vendedor: { columns: { name: true } },
        empresa: { columns: { nome: true } },
        ocorrencias: { columns: { tipo: true } },
        analise: { columns: { resultado: true, quemErrou: true } },
      },
    })

    function contar<T extends string>(itens: T[]): { chave: T; quantidade: number }[] {
      const mapa = new Map<T, number>()
      for (const item of itens) mapa.set(item, (mapa.get(item) ?? 0) + 1)
      return [...mapa.entries()].map(([chave, quantidade]) => ({ chave, quantidade })).sort((a, b) => b.quantidade - a.quantidade)
    }

    const porStatus = contar(chamados.map((c) => c.status))
    const porVendedor = contar(chamados.map((c) => c.vendedor?.name ?? 'Sem vendedor'))
    const porEmpresa = contar(chamados.map((c) => c.empresa?.nome ?? '—'))
    const porOcorrencia = contar(chamados.flatMap((c) => c.ocorrencias.map((o) => o.tipo)))

    const analises = chamados.map((c) => c.analise).filter((a): a is NonNullable<typeof a> => !!a)
    const positivos = analises.filter((a) => a.resultado === 'positivo').length
    const taxaPositiva = analises.length ? Math.round((positivos / analises.length) * 1000) / 10 : null

    const quemErrou = vejoComissao
      ? contar(analises.map((a) => a.quemErrou).filter((q): q is NonNullable<typeof q> => !!q))
      : null

    const finalizados = chamados.filter((c) => c.status === 'finalizado' && c.fechadoEm)
    const tempoMedioResolucaoDias = finalizados.length
      ? Math.round(
          (finalizados.reduce((soma, c) => {
            const fim = new Date(`${c.fechadoEm!.replace(' ', 'T')}Z`).getTime()
            const inicio = new Date(`${c.createdAt.replace(' ', 'T')}Z`).getTime()
            return soma + (fim - inicio) / (1000 * 60 * 60 * 24)
          }, 0) /
            finalizados.length) *
            10
        ) / 10
      : null

    return {
      totalChamados: chamados.length,
      totalFinalizados: finalizados.length,
      taxaPositiva,
      tempoMedioResolucaoDias,
      porStatus,
      porVendedor,
      porEmpresa,
      porOcorrencia,
      quemErrou,
    }
  }),
})
