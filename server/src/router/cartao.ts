import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { router, protectedProcedure, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { cartaoGastos, cartaoGastoAnexos } from '../db/schema.js'
import { CATEGORIAS_CARTAO, buscarGastosCartao, vendedoresComGasto } from '../lib/cartaoRelatorio.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'

const anexoInput = z.object({
  urlArquivo: z.string().min(1),
  nomeArquivo: z.string().min(1),
  tipoArquivo: z.string().optional(),
})

function exigirDescricao(input: { categoria: string; descricao?: string }) {
  if (input.categoria === 'outro' && !input.descricao?.trim()) throw new Error('Escreva o que foi o gasto (tipo "Outro")')
}

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
        // Obrigatório desde 2026-11-24 (pedido do João): tem que dizer o que é
        // o cupom/NF — almoço, gasolina etc. "Outro" exige a descrição.
        categoria: z.enum(CATEGORIAS_CARTAO, { errorMap: () => ({ message: 'Escolha o tipo do gasto (almoço, gasolina...)' }) }),
        descricao: z.string().optional(),
        anexos: z.array(anexoInput).min(1, 'Anexe a nota fiscal ou o cupom fiscal'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      exigirDescricao(input)
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
        // Obrigatório desde 2026-11-24 (pedido do João): tem que dizer o que é
        // o cupom/NF — almoço, gasolina etc. "Outro" exige a descrição.
        categoria: z.enum(CATEGORIAS_CARTAO, { errorMap: () => ({ message: 'Escolha o tipo do gasto (almoço, gasolina...)' }) }),
        descricao: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      exigirDescricao(input)
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

  // O admin principal (superAdmin) sempre viu o relatório geral (todas as
  // empresas juntas). Virou permissão delegável em 2026-09-22 (pedido do
  // João) — um admin comum concedido só vê os gastos da própria empresa
  // (senão vazaria gasto de vendedor de outra empresa pra quem não devia).
  // 2026-11-24: filtro por período (de/até) e por vendedor, agrupado por
  // vendedor — ver lib/cartaoRelatorio.ts (o PDF com anexos usa o mesmo).
  relatorio: featureProcedure('cartao_credito_relatorio')
    .input(z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const mes = mesReferenciaAtual().slice(0, 7)
      const filtro = { de: input.de ?? `${mes}-01`, ate: input.ate ?? `${mes}-31`, vendedorId: input.vendedorId }
      const escopo = { superAdmin: !!ctx.user.superAdmin, empresaId: ctx.empresaId ?? null }
      const [dados, vendedores] = await Promise.all([buscarGastosCartao(escopo, filtro), vendedoresComGasto(escopo)])
      return { ...filtro, ...dados, vendedores }
    }),
})
