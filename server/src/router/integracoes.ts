import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { router, protectedProcedure, featureProcedure, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, users } from '../db/schema.js'
import { buscarLeadsNovoMarketing, buscarAnalyticsResumo, buscarAnalyticsSerieDiaria } from '../lib/marketingCrm.js'

const dateRangeInput = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() })

// As 3 empresas que têm site com o tracker do CRM de marketing instalado
// hoje (ver comentário em tracker.js/CrmTracking.tsx dos sites) — mesmos
// slugs dos dois lados, conferido direto na tabela `empresas`.
const SLUGS_COM_ANALYTICS_MARKETING = ['joitec', 'odin-tubos', 'odin-compressores']

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

  // Resumo de Analytics do site (visitas, cliques por botão, bounce rate, tempo de tela,
  // leads por origem) da empresa ativa — busca no CRM de marketing pelo mesmo slug.
  analyticsResumo: featureProcedure('marketing_analytics').input(dateRangeInput).query(async ({ ctx, input }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
    if (!empresa) return null
    return buscarAnalyticsResumo(empresa.slug, input.dateFrom, input.dateTo)
  }),

  analyticsSerieDiaria: featureProcedure('marketing_analytics').input(dateRangeInput).query(async ({ ctx, input }) => {
    const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
    if (!empresa) return null
    return buscarAnalyticsSerieDiaria(empresa.slug, input.dateFrom, input.dateTo)
  }),

  // Mesmo resumo, uma vez por empresa (Joitec/Odin Tubos/Odin Compressores) — só o super
  // admin, pra comparar as 3 lado a lado sem trocar de empresa a cada olhada (mesmo
  // espírito do Painel Financeiro).
  analyticsResumoTodasEmpresas: superAdminProcedure.input(dateRangeInput).query(async ({ input }) => {
    const empresasComAnalytics = await db.query.empresas.findMany({
      where: inArray(empresas.slug, SLUGS_COM_ANALYTICS_MARKETING),
    })

    const byEmpresa = await Promise.all(
      empresasComAnalytics.map(async (empresa) => {
        const resumo = await buscarAnalyticsResumo(empresa.slug, input.dateFrom, input.dateTo)
        return { empresaId: empresa.id, empresaNome: empresa.nome, resumo }
      })
    )

    return byEmpresa
  }),
})
