import { z } from 'zod'
import { desc, eq, inArray, like, sql } from 'drizzle-orm'
import { router, protectedProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { cartaoGastos, cartaoGastoAnexos, users, empresas } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'

const anexoInput = z.object({
  urlArquivo: z.string().min(1),
  nomeArquivo: z.string().min(1),
  tipoArquivo: z.string().optional(),
})

// Controle de gastos do cartão corporativo — pensado pro vendedor EXTERNO
// da Odin Compressores (visita → proposta → venda), mas não trava por
// canalVenda/empresa aqui no backend: quem decide quem usa é a permissão
// concedida em Permissões (mesmo espírito do resto do CRM — ver
// Sidebar.tsx). Cada gasto exige pelo menos 1 anexo (nota fiscal/cupom).
export const cartaoRouter = router({
  meusGastos: protectedProcedure.query(async ({ ctx }) => {
    const gastos = await db.query.cartaoGastos.findMany({
      where: eq(cartaoGastos.vendedorId, ctx.user.id),
      with: { anexos: true },
      orderBy: desc(cartaoGastos.data),
    })
    return gastos
  }),

  criar: protectedProcedure
    .input(
      z.object({
        data: z.string(),
        valor: z.number().positive('Valor precisa ser maior que zero'),
        categoria: z.enum(['combustivel', 'alimentacao', 'hospedagem', 'pedagio', 'manutencao', 'outro']).optional(),
        descricao: z.string().optional(),
        anexos: z.array(anexoInput).min(1, 'Anexe a nota fiscal ou o cupom fiscal'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [gasto] = await db
        .insert(cartaoGastos)
        .values({
          vendedorId: ctx.user.id,
          data: input.data,
          valor: input.valor,
          categoria: input.categoria,
          descricao: input.descricao || null,
        })
        .returning()

      await db.insert(cartaoGastoAnexos).values(input.anexos.map((a) => ({ ...a, gastoId: gasto.id })))
      return { success: true }
    }),

  editar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: z.string(),
        valor: z.number().positive('Valor precisa ser maior que zero'),
        categoria: z.enum(['combustivel', 'alimentacao', 'hospedagem', 'pedagio', 'manutencao', 'outro']).optional(),
        descricao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const gasto = await db.query.cartaoGastos.findFirst({ where: eq(cartaoGastos.id, input.id) })
      if (!gasto) throw new Error('Gasto não encontrado')
      if (gasto.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

      await db
        .update(cartaoGastos)
        .set({ data: input.data, valor: input.valor, categoria: input.categoria, descricao: input.descricao || null })
        .where(eq(cartaoGastos.id, input.id))
      return { success: true }
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const gasto = await db.query.cartaoGastos.findFirst({ where: eq(cartaoGastos.id, input.id) })
    if (!gasto) throw new Error('Gasto não encontrado')
    if (gasto.vendedorId !== ctx.user.id) throw new Error('Acesso negado')

    await db.delete(cartaoGastos).where(eq(cartaoGastos.id, input.id))
    return { success: true }
  }),

  // Só o admin principal (superAdmin) vê o relatório geral — pedido
  // explícito do João, 2026-09-15. `mesReferencia` (YYYY-MM) default é o
  // mês atual.
  relatorio: superAdminProcedure
    .input(z.object({ mesReferencia: z.string().optional() }))
    .query(async ({ input }) => {
      const mes = input.mesReferencia ?? mesReferenciaAtual()
      const filtroMes = like(cartaoGastos.data, `${mes}%`)

      const lancamentos = await db
        .select({
          id: cartaoGastos.id,
          data: cartaoGastos.data,
          valor: cartaoGastos.valor,
          categoria: cartaoGastos.categoria,
          descricao: cartaoGastos.descricao,
          vendedorId: cartaoGastos.vendedorId,
          vendedorNome: users.name,
          empresaNome: empresas.nome,
        })
        .from(cartaoGastos)
        .innerJoin(users, eq(users.id, cartaoGastos.vendedorId))
        .innerJoin(empresas, eq(empresas.id, users.empresaId))
        .where(filtroMes)
        .orderBy(desc(cartaoGastos.data))

      const anexosDoMes = lancamentos.length
        ? await db.query.cartaoGastoAnexos.findMany({ where: inArray(cartaoGastoAnexos.gastoId, lancamentos.map((l) => l.id)) })
        : []
      const lancamentosComAnexos = lancamentos.map((l) => ({
        ...l,
        anexos: anexosDoMes.filter((a) => a.gastoId === l.id),
      }))

      const [totalGeral] = await db
        .select({ total: sql<number>`coalesce(sum(${cartaoGastos.valor}), 0)`, qtd: sql<number>`count(*)` })
        .from(cartaoGastos)
        .where(filtroMes)

      const porVendedor = await db
        .select({
          vendedorId: cartaoGastos.vendedorId,
          vendedorNome: users.name,
          total: sql<number>`coalesce(sum(${cartaoGastos.valor}), 0)`,
          qtd: sql<number>`count(*)`,
        })
        .from(cartaoGastos)
        .innerJoin(users, eq(users.id, cartaoGastos.vendedorId))
        .where(filtroMes)
        .groupBy(cartaoGastos.vendedorId, users.name)
        .orderBy(desc(sql`sum(${cartaoGastos.valor})`))

      return {
        mesReferencia: mes,
        totalGeral: totalGeral?.total ?? 0,
        quantidadeGeral: totalGeral?.qtd ?? 0,
        porVendedor,
        lancamentos: lancamentosComAnexos,
      }
    }),
})
