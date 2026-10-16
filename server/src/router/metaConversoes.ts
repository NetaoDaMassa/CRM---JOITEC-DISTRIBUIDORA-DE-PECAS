// Credenciais da Conversions API do Meta Ads, por empresa — ver
// server/src/lib/metaConversionsApi.ts pro envio de verdade dos eventos
// (Lead/Purchase) quando um lead vindo do Meta Ads vira Negociação/Ganho.
// Mesmo padrão de superAdminProcedure + "nunca devolve o token" já usado
// pra Aton ERP/CRM Odin Compressores em financeiro.ts.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas } from '../db/schema.js'
import { metaCapiConfigurado, salvarCredenciaisMetaCapi } from '../lib/metaConversionsApi.js'

export const metaConversoesRouter = router({
  status: superAdminProcedure.query(async () => {
    const todasEmpresas = await db.query.empresas.findMany({
      columns: { id: true, nome: true },
      orderBy: (e, { asc }) => [asc(e.nome)],
    })
    return Promise.all(
      todasEmpresas.map(async (e) => ({
        empresaId: e.id,
        empresaNome: e.nome,
        configurado: await metaCapiConfigurado(e.id),
      }))
    )
  }),

  salvarCredenciais: superAdminProcedure
    .input(z.object({ empresaId: z.number(), pixelId: z.string().min(1), accessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, input.empresaId) })
      if (!empresa) throw new Error('Empresa não encontrada')
      await salvarCredenciaisMetaCapi(input.empresaId, input.pixelId, input.accessToken)
      return { success: true }
    }),
})
