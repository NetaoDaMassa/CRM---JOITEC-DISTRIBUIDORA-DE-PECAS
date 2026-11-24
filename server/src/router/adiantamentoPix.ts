import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { alias } from 'drizzle-orm/sqlite-core'
import { router, featureProcedure, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { adiantamentosPix, clientes, empresas, users, vendas } from '../db/schema.js'
import { agoraSqlite } from '../lib/dataBr.js'
import { EMPRESAS_PIX, MAX_COMPROVANTES_PIX, gravarComprovantes, lerComprovantes, lerPixDesde, lerRegraPix, normalizar, pixDasVendas, salvarPixDesde, salvarRegraPix, tipoPix } from '../lib/adiantamentoPix.js'
import { filtroPiloto } from '../lib/pilotoFinanceiro.js'
import { registrarAuditoria } from '../lib/auditoria.js'

// Tela Adiantamento PIX (financeiro, 2026-11-13) — cross-empresa (Joitec,
// Odin Tubos, Odin Automação) igual Registros de liberação: quem tem a
// permissão vê as 3 numa tela só, sem trocar de empresa.
const FEATURE = 'adiantamento_pix'

const vendedor = alias(users, 'vendedor')
const conferente = alias(users, 'conferente')

async function acharVenda(vendaId: number) {
  const v = await db.query.vendas.findFirst({ where: and(eq(vendas.id, vendaId), isNull(vendas.deletedAt)) })
  if (!v) throw new TRPCError({ code: 'NOT_FOUND', message: 'Venda não encontrada' })
  return v
}

export const adiantamentoPixRouter = router({
  listar: featureProcedure(FEATURE)
    .input(z.object({ aba: z.enum(['conferir', 'conferido']) }))
    .query(async ({ input }) => {
      const [regra, desde, piloto] = await Promise.all([lerRegraPix(), lerPixDesde(), filtroPiloto()])
      const linhas = await db
        .select({
          vendaId: vendas.id,
          vendedorId: vendas.vendedorId,
          funilMensalId: vendas.funilMensalId,
          clienteId: vendas.clienteId,
          valor: vendas.valorFechado,
          condicaoPagamento: vendas.condicaoPagamento,
          numeroPedido: vendas.numeroPedido,
          numeroNotaFiscal: vendas.numeroNotaFiscal,
          dataFechamento: vendas.dataFechamento,
          clienteNome: clientes.razaoSocial,
          clienteCodigo: clientes.codigo,
          empresaNome: empresas.nome,
          empresaSlug: empresas.slug,
          vendedorNome: vendedor.name,
          comprovantePath: adiantamentosPix.comprovantePath,
          comprovanteNome: adiantamentosPix.comprovanteNome,
          anexadoEm: adiantamentosPix.anexadoEm,
          conferidoEm: adiantamentosPix.conferidoEm,
          conferidoPor: conferente.name,
          observacao: adiantamentosPix.observacao,
          semComprovanteMotivo: adiantamentosPix.semComprovanteMotivo,
        })
        .from(vendas)
        .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
        .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
        .innerJoin(vendedor, eq(vendedor.id, vendas.vendedorId))
        .leftJoin(adiantamentosPix, eq(adiantamentosPix.vendaId, vendas.id))
        .leftJoin(conferente, eq(conferente.id, adiantamentosPix.conferidoPor))
        .where(
          and(
            isNull(vendas.deletedAt),
            isNotNull(vendas.condicaoPagamento),
            inArray(empresas.slug, EMPRESAS_PIX),
            gte(vendas.dataFechamento, desde),
            input.aba === 'conferido' ? isNotNull(adiantamentosPix.conferidoEm) : isNull(adiantamentosPix.conferidoEm)
          )
        )
        .orderBy(input.aba === 'conferido' ? desc(adiantamentosPix.conferidoEm) : desc(vendas.dataFechamento))
        .limit(input.aba === 'conferido' ? 300 : 1000)
      const lista = linhas
        .map((l) => ({ ...l, tipo: tipoPix(l.condicaoPagamento, regra) }))
        .filter((l) => l.tipo && piloto(l.vendedorId))
        .map((l) => {
          const comprovantes = lerComprovantes(l.comprovantePath, l.comprovanteNome)
          return {
            ...l,
            comprovantes,
            comprovantePath: comprovantes[0]?.path ?? null,
            garantia: l.semComprovanteMotivo === 'garantia',
            status: l.conferidoEm ? 'conferido' : comprovantes.length || l.semComprovanteMotivo ? 'anexado' : 'aguardando',
          }
        })
      // À conferir: os que já têm comprovante em cima (é o que o financeiro
      // tem pra fazer agora); depois os que esperam o vendedor.
      if (input.aba === 'conferir') lista.sort((a, b) => Number(b.status === 'anexado') - Number(a.status === 'anexado'))
      return lista
    }),

  contagem: featureProcedure(FEATURE).query(async () => {
    const [regra, desde, piloto] = await Promise.all([lerRegraPix(), lerPixDesde(), filtroPiloto()])
    const linhas = await db
      .select({ condicao: vendas.condicaoPagamento, path: adiantamentosPix.comprovantePath, motivo: adiantamentosPix.semComprovanteMotivo, vendedorId: vendas.vendedorId })
      .from(vendas)
      .innerJoin(clientes, eq(clientes.id, vendas.clienteId))
      .innerJoin(empresas, eq(empresas.id, clientes.empresaId))
      .leftJoin(adiantamentosPix, eq(adiantamentosPix.vendaId, vendas.id))
      .where(and(isNull(vendas.deletedAt), isNotNull(vendas.condicaoPagamento), inArray(empresas.slug, EMPRESAS_PIX), gte(vendas.dataFechamento, desde), isNull(adiantamentosPix.conferidoEm)))
    const doPix = linhas.filter((l) => tipoPix(l.condicao, regra) && piloto(l.vendedorId))
    return { aConferir: doPix.filter((l) => l.path || l.motivo).length, aguardandoVendedor: doPix.filter((l) => !l.path && !l.motivo).length }
  }),

  conferir: featureProcedure(FEATURE)
    .input(z.object({ vendaId: z.number(), observacao: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const l = await db.query.adiantamentosPix.findFirst({ where: eq(adiantamentosPix.vendaId, input.vendaId) })
      if (!l?.comprovantePath && !l?.semComprovanteMotivo) throw new TRPCError({ code: 'BAD_REQUEST', message: 'O vendedor ainda não anexou o comprovante.' })
      await db
        .update(adiantamentosPix)
        .set({ conferidoEm: agoraSqlite(), conferidoPor: ctx.user.id, observacao: input.observacao?.trim() || l.observacao })
        .where(eq(adiantamentosPix.id, l.id))
      // Histórico de quem conferiu/desfez (João, 2026-11-17: financeiro disse
      // que não conferiu o pedido 9524 e estava "conferido por rubia").
      await registrarAuditoria({ tabela: 'adiantamentos_pix', registroId: l.id, acao: 'editar', campo: 'conferido', valorNovo: `conferido${l.semComprovanteMotivo === 'garantia' ? ' — garantia, sem comprovante' : ''} (venda ${input.vendaId})`, alteradoPor: ctx.user.id })
      return { ok: true }
    }),

  desfazerConferencia: featureProcedure(FEATURE)
    .input(z.object({ vendaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const l = await db.query.adiantamentosPix.findFirst({ where: eq(adiantamentosPix.vendaId, input.vendaId) })
      await db.update(adiantamentosPix).set({ conferidoEm: null, conferidoPor: null }).where(eq(adiantamentosPix.vendaId, input.vendaId))
      if (l?.conferidoEm)
        await registrarAuditoria({ tabela: 'adiantamentos_pix', registroId: l.id, acao: 'editar', campo: 'conferido', valorAnterior: `conferido em ${l.conferidoEm} por usuário ${l.conferidoPor}`, valorNovo: `desfeito (venda ${input.vendaId})`, alteradoPor: ctx.user.id })
      return { ok: true }
    }),

  configuracao: featureProcedure(FEATURE).query(async () => {
    const prazos = await db.query.sapPrazosPagamento.findMany()
    const regra = await lerRegraPix()
    return {
      regra,
      desde: await lerPixDesde(),
      // Condições do SAP com o que cada uma vira — pra conferir a regra.
      condicoesSap: prazos
        .map((p) => ({ nome: p.nome, tipo: tipoPix(p.nome, regra) }))
        .sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome))),
    }
  }),

  salvarConfiguracao: featureProcedure(FEATURE)
    .input(z.object({ avista: z.array(z.string().max(60)).max(30), entrada: z.array(z.string().max(60)).max(30), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      await salvarRegraPix({ avista: input.avista, entrada: input.entrada })
      await salvarPixDesde(input.desde)
      return { ok: true }
    }),

  // Vendedor (dono da venda) ou admin anexa o(s) comprovante(s) no card —
  // soma aos que já estão lá (até MAX_COMPROVANTES_PIX).
  anexar: protectedProcedure
    .input(
      z.object({
        vendaId: z.number(),
        arquivos: z.array(z.object({ path: z.string().min(1).max(500), nome: z.string().max(255).optional() })).min(1).max(MAX_COMPROVANTES_PIX),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const v = await acharVenda(input.vendaId)
      if (ctx.user.role !== 'admin' && v.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o vendedor da venda anexa o comprovante.' })
      const pix = (await pixDasVendas([v])).get(v.id)
      if (!pix) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa venda não é à vista nem entrada + boleto.' })
      if (pix.status === 'conferido') throw new TRPCError({ code: 'BAD_REQUEST', message: 'O financeiro já conferiu esse comprovante.' })
      const atual = await db.query.adiantamentosPix.findFirst({ where: eq(adiantamentosPix.vendaId, v.id) })
      const lista = [...lerComprovantes(atual?.comprovantePath, atual?.comprovanteNome), ...input.arquivos.map((a) => ({ path: a.path, nome: a.nome ?? null }))]
      if (lista.length > MAX_COMPROVANTES_PIX) throw new TRPCError({ code: 'BAD_REQUEST', message: `No máximo ${MAX_COMPROVANTES_PIX} arquivos por venda.` })
      const dados = { ...gravarComprovantes(lista), anexadoEm: agoraSqlite(), anexadoPor: ctx.user.id, semComprovanteMotivo: null }
      await db
        .insert(adiantamentosPix)
        .values({ vendaId: v.id, ...dados })
        .onConflictDoUpdate({ target: adiantamentosPix.vendaId, set: dados })
      return { ok: true }
    }),

  // Venda de garantia: não tem PIX nem comprovante (João, 2026-11-24). O
  // vendedor avisa por aqui; o financeiro confere igual (só aí destrava).
  marcarGarantia: protectedProcedure.input(z.object({ vendaId: z.number() })).mutation(async ({ ctx, input }) => {
    const v = await acharVenda(input.vendaId)
    if (ctx.user.role !== 'admin' && v.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o vendedor da venda faz isso.' })
    const pix = (await pixDasVendas([v])).get(v.id)
    if (!pix) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa venda não é à vista nem entrada + boleto.' })
    if (pix.status !== 'aguardando') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Essa venda já tem comprovante (ou já foi conferida).' })
    const dados = { semComprovanteMotivo: 'garantia', anexadoEm: agoraSqlite(), anexadoPor: ctx.user.id }
    const res = await db.insert(adiantamentosPix).values({ vendaId: v.id, ...dados }).onConflictDoUpdate({ target: adiantamentosPix.vendaId, set: dados }).returning({ id: adiantamentosPix.id })
    await registrarAuditoria({ tabela: 'adiantamentos_pix', registroId: res[0]?.id ?? v.id, acao: 'editar', campo: 'sem_comprovante_motivo', valorNovo: `garantia — sem comprovante (venda ${v.id})`, alteradoPor: ctx.user.id })
    return { ok: true }
  }),

  // Sem `path` tira todos; com `path` tira só aquele arquivo.
  removerComprovante: protectedProcedure.input(z.object({ vendaId: z.number(), path: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const v = await acharVenda(input.vendaId)
    if (ctx.user.role !== 'admin' && v.vendedorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Só o vendedor da venda mexe no comprovante.' })
    const l = await db.query.adiantamentosPix.findFirst({ where: eq(adiantamentosPix.vendaId, v.id) })
    if (l?.conferidoEm) throw new TRPCError({ code: 'BAD_REQUEST', message: 'O financeiro já conferiu — peça pra desfazer a conferência antes.' })
    const resto = input.path ? lerComprovantes(l?.comprovantePath, l?.comprovanteNome).filter((a) => a.path !== input.path) : []
    await db
      .update(adiantamentosPix)
      .set(resto.length ? gravarComprovantes(resto) : { comprovantePath: null, comprovanteNome: null, anexadoEm: null, anexadoPor: null, semComprovanteMotivo: null })
      .where(eq(adiantamentosPix.vendaId, v.id))
    return { ok: true }
  }),
})
