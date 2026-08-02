import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { metasMensais, users } from '../db/schema.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { getConfigNumero } from '../lib/configuracoes.js'

export const metasRouter = router({
  listaMesCorrente: adminProcedure.query(async ({ ctx }) => {
    const mesAtual = mesReferenciaAtual()
    const vendedores = await db.query.users.findMany({
      where: and(eq(users.role, 'vendor'), eq(users.empresaId, ctx.empresaId)),
      orderBy: (u, { asc }) => [asc(u.name)],
    })

    const metas = await db.query.metasMensais.findMany({ where: eq(metasMensais.mesReferencia, mesAtual) })
    const metaPorVendedor = new Map(metas.map((m) => [m.vendedorId, m]))

    return vendedores.map((v) => ({
      vendedorId: v.id,
      nome: v.name,
      isActive: v.isActive,
      meta: metaPorVendedor.get(v.id) ?? null,
    }))
  }),

  definir: adminProcedure
    .input(
      z.object({
        vendedorId: z.number(),
        metaFaturamento: z.number().min(0).optional(),
        metaPctCarteiraAtivada: z.number().min(0).max(100).optional(),
        metaLigacoesDia: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vendedor = await db.query.users.findFirst({ where: eq(users.id, input.vendedorId) })
      if (!vendedor || vendedor.empresaId !== ctx.empresaId) throw new Error('Vendedor inválido')

      const mesAtual = mesReferenciaAtual()
      const existente = await db.query.metasMensais.findFirst({
        where: and(eq(metasMensais.vendedorId, input.vendedorId), eq(metasMensais.mesReferencia, mesAtual)),
      })

      if (existente) {
        await db
          .update(metasMensais)
          .set({
            metaFaturamento: input.metaFaturamento,
            metaPctCarteiraAtivada: input.metaPctCarteiraAtivada,
            metaLigacoesDia: input.metaLigacoesDia ?? existente.metaLigacoesDia,
          })
          .where(eq(metasMensais.id, existente.id))
      } else {
        const metaLigacoesPadrao = await getConfigNumero('meta_ligacoes_dia_padrao', 25)
        await db.insert(metasMensais).values({
          vendedorId: input.vendedorId,
          mesReferencia: mesAtual,
          metaFaturamento: input.metaFaturamento,
          metaPctCarteiraAtivada: input.metaPctCarteiraAtivada,
          metaLigacoesDia: input.metaLigacoesDia ?? metaLigacoesPadrao,
        })
      }
      return { success: true }
    }),
})
