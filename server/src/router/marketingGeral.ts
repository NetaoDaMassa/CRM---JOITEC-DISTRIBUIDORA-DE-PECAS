import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { router, superAdminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { empresas, clientes, vendas as vendasTable } from '../db/schema.js'
import { toLocalDateKey, toUtcISO } from '../lib/businessHours.js'
import { calcularReportGeral } from './leadsRelatorios.js'

// Relatório geral de Marketing (pedido do João, 2026-09-30) — mesmo
// conteúdo de "Relatórios de Leads > Geral" de cada empresa, só que
// somado/quebrado por TODAS as empresas do grupo numa tela só, restrito ao
// admin principal (superAdmin — mesmo padrão de painel_financeiro/
// painel_tv, nunca delegável por Permissões). Empresa sem módulo de Leads
// simplesmente aparece zerada, não precisa de lista fixa de slugs.
//
// "Vendas de clientes de Marketing" é outra fonte de dado: não vem de
// Leads, vem da Carteira (`vendas`, o pipeline de clientes existentes),
// filtrado por `clientes.origemMarketing` (marcado manualmente no
// "Completar cadastro" — cliente que veio de uma ação de Marketing, não de
// prospecção do vendedor). Filtro de período em memória pela data local
// (mesmo motivo do bug corrigido em leads.ts/leadsRelatorios.ts:
// `dataFechamento` é gravado em UTC cru, sem sufixo de fuso).
export const marketingGeralRouter = router({
  relatorioGeral: superAdminProcedure
    .input(z.object({ mesReferencia: z.string() }))
    .query(async ({ input }) => {
      const dataInicio = `${input.mesReferencia}-01`
      const [ano, mes] = input.mesReferencia.split('-').map(Number)
      const ultimoDia = new Date(ano, mes, 0).getDate()
      const dataFim = `${input.mesReferencia}-${String(ultimoDia).padStart(2, '0')}`

      const todasEmpresas = await db.query.empresas.findMany({ orderBy: (e, { asc }) => [asc(e.nome)] })

      const porEmpresa = await Promise.all(
        todasEmpresas.map(async (empresa) => {
          const leadsMetrics = await calcularReportGeral(empresa.id, dataInicio, dataFim)

          const vendasMarketingRows = await db
            .select({ valorFechado: vendasTable.valorFechado, dataFechamento: vendasTable.dataFechamento })
            .from(vendasTable)
            .innerJoin(clientes, eq(clientes.id, vendasTable.clienteId))
            .where(and(eq(clientes.empresaId, empresa.id), eq(clientes.origemMarketing, true), isNull(vendasTable.deletedAt)))

          const vendasMarketingPeriodo = vendasMarketingRows.filter((v) => {
            const dataLocal = toLocalDateKey(toUtcISO(v.dataFechamento))
            return dataLocal >= dataInicio && dataLocal <= dataFim
          })

          return {
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaSlug: empresa.slug,
            leadsCriadosNoPeriodo: leadsMetrics.leadsCriadosNoPeriodo,
            leadsAtendidosNoPeriodo: leadsMetrics.leadsAtendidosNoPeriodo,
            tempoMedioPrimeiroContatoHoras: leadsMetrics.tempoMedioPrimeiroContatoHoras,
            amostraPrimeiroContato: leadsMetrics.amostraPrimeiroContato,
            tempoMedioFechamentoDias: leadsMetrics.tempoMedioFechamentoDias,
            amostraFechamento: leadsMetrics.amostraFechamento,
            vendasFechadasQtd: leadsMetrics.totalGanhos,
            vendasFechadasValor: leadsMetrics.totalVendas,
            vendasMarketingQtd: vendasMarketingPeriodo.length,
            vendasMarketingValor: vendasMarketingPeriodo.reduce((s, v) => s + v.valorFechado, 0),
          }
        })
      )

      // Média ponderada pela amostra de cada empresa — média simples das
      // médias distorceria quando uma empresa tem muito mais leads que
      // outra (ex: Odin Compressores com 500 leads no mês pesando igual à
      // Joitec Automação com 3).
      const mediaPonderada = (valores: { valor: number; peso: number }[]) => {
        const pesoTotal = valores.reduce((s, v) => s + v.peso, 0)
        if (pesoTotal === 0) return 0
        return valores.reduce((s, v) => s + v.valor * v.peso, 0) / pesoTotal
      }

      const total = {
        leadsCriadosNoPeriodo: porEmpresa.reduce((s, e) => s + e.leadsCriadosNoPeriodo, 0),
        leadsAtendidosNoPeriodo: porEmpresa.reduce((s, e) => s + e.leadsAtendidosNoPeriodo, 0),
        tempoMedioPrimeiroContatoHoras: mediaPonderada(
          porEmpresa.map((e) => ({ valor: e.tempoMedioPrimeiroContatoHoras, peso: e.amostraPrimeiroContato }))
        ),
        tempoMedioFechamentoDias: mediaPonderada(porEmpresa.map((e) => ({ valor: e.tempoMedioFechamentoDias, peso: e.amostraFechamento }))),
        vendasFechadasQtd: porEmpresa.reduce((s, e) => s + e.vendasFechadasQtd, 0),
        vendasFechadasValor: porEmpresa.reduce((s, e) => s + e.vendasFechadasValor, 0),
        vendasMarketingQtd: porEmpresa.reduce((s, e) => s + e.vendasMarketingQtd, 0),
        vendasMarketingValor: porEmpresa.reduce((s, e) => s + e.vendasMarketingValor, 0),
      }

      return { mesReferencia: input.mesReferencia, porEmpresa, total }
    }),
})
