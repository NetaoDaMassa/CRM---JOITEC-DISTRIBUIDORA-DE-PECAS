import { eq } from 'drizzle-orm'
import { router, protectedProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import { buscarLeadsNovoMarketing } from '../lib/marketingCrm.js'

export const integracoesRouter = router({
  // Quantos leads estão em "Novo" no CRM de marketing esperando cada vendedor
  // atender — cruzado pelo `username` (mesmo valor nos dois sistemas). Só
  // retorna algo se a empresa ativa também existir lá (mesmo slug) e as
  // variáveis MARKETING_CRM_URL/MARKETING_CRM_API_KEY estiverem configuradas;
  // senão volta `null` e o Painel de TV esconde o slide sozinho.
  leadsNovoMarketing: protectedProcedure.query(async ({ ctx }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
    if (!empresa) return null

    const resumo = await buscarLeadsNovoMarketing(empresa.slug)
    if (!resumo) return null

    const vendedoresLocais = await db.query.users.findMany({
      where: eq(users.empresaId, empresa.id),
      columns: { id: true, username: true, name: true, fotoUrl: true },
    })
    const porUsername = new Map(vendedoresLocais.map((v) => [v.username, v]))

    const vendedores = resumo.vendedores
      .map((v) => {
        const local = porUsername.get(v.username)
        return {
          id: local?.id ?? null,
          nome: local?.name ?? v.name,
          fotoUrl: local?.fotoUrl ?? null,
          leadsNovo: v.leadsNovo,
        }
      })
      .sort((a, b) => b.leadsNovo - a.leadsNovo)

    return {
      totalLeadsNovo: resumo.totalLeadsNovo,
      semVendedor: resumo.semVendedor,
      vendedores,
    }
  }),
})
