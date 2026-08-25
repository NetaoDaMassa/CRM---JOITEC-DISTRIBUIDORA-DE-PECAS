import { z } from 'zod'
import { and, eq, inArray, isNull, gte, lte } from 'drizzle-orm'
import { router, featureProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, leadHistory, leadContactAttempts, users } from '../db/schema.js'
import { businessHoursElapsedMs } from '../lib/businessHours.js'
import { STATUS_VALUES, STATUS_LABELS } from '../lib/leadsStatus.js'

// Relatórios de marketing do módulo de Leads (bloco E do plano em
// /Users/weslley/.claude/plans/stateful-soaring-moore.md). `slaOverview` e
// `transferHistory` portados de odin-tubos-crm--master/server/src/router/reports.ts,
// adaptados pro schema daqui (empresaId em vez de companyId, sem `companies`).
// `reportGeral` é novo, pedido pelo usuário (não existia no sistema antigo).
//
// leadHistory não tem relation nomeada pra fromVendorId/toVendorId (só pra
// `user`), então os nomes de vendedor de/para são resolvidos manualmente
// aqui via um Map, em vez de `with: { fromVendor, toVendor }`.

export const leadsRelatoriosRouter = router({
  slaOverview: featureProcedure('leads').query(async ({ ctx }) => {
    const abordagemLeads = await db.query.leads.findMany({
      where: and(eq(leads.status, 'abordagem'), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
      with: { vendor: true },
    })

    type VendorEntry = {
      vendorId: number | null
      name: string
      total: number
      emRisco: number
      critico: number
      hoursStuck: number[]
    }
    const vendorMap = new Map<string, VendorEntry>()
    for (const l of abordagemLeads) {
      const key = l.vendor ? `v${l.vendor.id}` : 'sem-vendedor'
      if (!vendorMap.has(key)) {
        vendorMap.set(key, { vendorId: l.vendor?.id ?? null, name: l.vendor?.name ?? 'Sem vendedor', total: 0, emRisco: 0, critico: 0, hoursStuck: [] })
      }
      const entry = vendorMap.get(key)!
      entry.total++
      if (l.slaStatus === 'em_risco') entry.emRisco++
      if (l.slaStatus === 'critico') entry.critico++
      const started = l.statusChangedAt ?? l.updatedAt
      entry.hoursStuck.push(businessHoursElapsedMs(started) / (60 * 60 * 1000))
    }

    const byVendor = Array.from(vendorMap.values()).sort((a, b) => b.critico - a.critico || b.emRisco - a.emRisco)

    const overdueByVendor = byVendor
      .filter((v) => v.emRisco > 0 || v.critico > 0)
      .map((v) => ({ vendorId: v.vendorId, name: v.name, emRisco: v.emRisco, critico: v.critico, total: v.total }))

    const allHours = abordagemLeads.map((l) => businessHoursElapsedMs(l.statusChangedAt ?? l.updatedAt) / (60 * 60 * 1000))
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

    const avgTimeStuckByStage = {
      overallHours: avg(allHours),
      byVendor: byVendor.map((v) => ({ vendorId: v.vendorId, name: v.name, avgHours: avg(v.hoursStuck) })),
    }

    const criticalAlertVendors = byVendor
      .filter((v) => v.critico >= 3)
      .map((v) => ({ vendorId: v.vendorId, name: v.name, critico: v.critico }))

    const historyRows = await db.query.leadHistory.findMany({
      where: and(inArray(leadHistory.action, ['reatribuicao_automatica', 'transferido']), eq(leadHistory.empresaId, ctx.empresaId)),
    })
    const vendorIds = new Set<number>()
    for (const h of historyRows) {
      if (h.fromVendorId) vendorIds.add(h.fromVendorId)
      if (h.toVendorId) vendorIds.add(h.toVendorId)
    }
    const vendorRows = vendorIds.size ? await db.query.users.findMany({ where: inArray(users.id, Array.from(vendorIds)) }) : []
    const vendorNameById = new Map(vendorRows.map((u) => [u.id, u.name]))

    const reassignMap = new Map<string, { vendorId: number | null; name: string; received: number; lost: number }>()
    for (const h of historyRows) {
      if (h.toVendorId) {
        const key = `v${h.toVendorId}`
        if (!reassignMap.has(key)) reassignMap.set(key, { vendorId: h.toVendorId, name: vendorNameById.get(h.toVendorId) ?? 'Desconhecido', received: 0, lost: 0 })
        reassignMap.get(key)!.received++
      }
      if (h.fromVendorId) {
        const key = `v${h.fromVendorId}`
        if (!reassignMap.has(key)) reassignMap.set(key, { vendorId: h.fromVendorId, name: vendorNameById.get(h.fromVendorId) ?? 'Desconhecido', received: 0, lost: 0 })
        reassignMap.get(key)!.lost++
      }
    }
    const reassignmentHistory = Array.from(reassignMap.values()).sort((a, b) => b.received - a.received)

    return { overdueByVendor, avgTimeStuckByStage, criticalAlertVendors, reassignmentHistory }
  }),

  transferHistory: featureProcedure('leads').query(async ({ ctx }) => {
    const rows = await db.query.leadHistory.findMany({
      where: and(inArray(leadHistory.action, ['transferido', 'reatribuicao_automatica', 'excluido']), eq(leadHistory.empresaId, ctx.empresaId)),
      with: {
        lead: { columns: { id: true, name: true, ddd: true, phone: true } },
        user: { columns: { id: true, name: true } },
      },
      orderBy: (h, { desc }) => [desc(h.createdAt)],
    })

    const vendorIds = new Set<number>()
    for (const h of rows) {
      if (h.fromVendorId) vendorIds.add(h.fromVendorId)
      if (h.toVendorId) vendorIds.add(h.toVendorId)
    }
    const vendorRows = vendorIds.size ? await db.query.users.findMany({ where: inArray(users.id, Array.from(vendorIds)), columns: { id: true, name: true } }) : []
    const vendorNameById = new Map(vendorRows.map((u) => [u.id, u.name]))

    return rows.map((h) => ({
      ...h,
      fromVendor: h.fromVendorId ? { id: h.fromVendorId, name: vendorNameById.get(h.fromVendorId) ?? 'Desconhecido' } : null,
      toVendor: h.toVendorId ? { id: h.toVendorId, name: vendorNameById.get(h.toVendorId) ?? 'Desconhecido' } : null,
    }))
  }),

  // Critério de "tempo até 1º contato": diferença entre `leads.createdAt` e a
  // 1ª linha de `leadContactAttempts` daquele lead (o momento real em que o
  // vendedor de fato tentou contato) — mais preciso que usar a mudança de
  // status pra "abordagem", que pode acontecer sem nenhuma tentativa
  // registrada ainda. Leads sem nenhuma tentativa não entram nessa média.
  reportGeral: featureProcedure('leads')
    .input(z.object({ dataInicio: z.string().optional(), dataFim: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const filtros = [eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)]
      if (input?.dataInicio) filtros.push(gte(leads.createdAt, input.dataInicio))
      if (input?.dataFim) filtros.push(lte(leads.createdAt, `${input.dataFim} 23:59:59`))

      const todosLeads = await db.query.leads.findMany({ where: and(...filtros) })

      const primeirasTentativas = await db.query.leadContactAttempts.findMany({
        where: inArray(leadContactAttempts.leadId, todosLeads.map((l) => l.id)),
        orderBy: (c, { asc }) => [asc(c.createdAt)],
      })
      const primeiraTentativaPorLead = new Map<number, string>()
      for (const t of primeirasTentativas) {
        if (!primeiraTentativaPorLead.has(t.leadId)) primeiraTentativaPorLead.set(t.leadId, t.createdAt)
      }

      const temposPrimeiroContato: number[] = []
      for (const l of todosLeads) {
        const primeira = primeiraTentativaPorLead.get(l.id)
        if (primeira) temposPrimeiroContato.push(businessHoursElapsedMs(l.createdAt, primeira) / (60 * 60 * 1000))
      }
      const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

      const ganhos = todosLeads.filter((l) => l.status === 'ganho')
      const perdidos = todosLeads.filter((l) => l.status === 'perdido')
      const desqualificados = todosLeads.filter((l) => l.status === 'desqualificado')
      const ticketMedio = avg(ganhos.map((l) => l.finalOrderValue ?? 0).filter((v) => v > 0))

      const naoNovos = todosLeads.filter((l) => l.status !== 'novo')
      const taxaConversao = naoNovos.length ? (ganhos.length / naoNovos.length) * 100 : 0

      const total = todosLeads.length
      const taxaPerda = total > 0 ? ((perdidos.length + desqualificados.length) / total) * 100 : 0

      // "Fechamento" = da atribuição ao vendedor até a etapa terminal
      // (ganho/perdido/desqualificado) — mesmo critério do CRM antigo de
      // marketing (reports.ts de lá), adaptado pro schema daqui.
      const diasEntre = (de: string, ate: string) => (new Date(ate).getTime() - new Date(de).getTime()) / (1000 * 60 * 60 * 24)
      const encerrados = [...ganhos, ...perdidos, ...desqualificados]
      const tempoMedioFechamentoDias = avg(
        encerrados.map((l) => diasEntre(l.assignedAt ?? l.createdAt, l.statusChangedAt ?? l.updatedAt))
      )

      const emNegociacao = todosLeads.filter((l) => l.status === 'em_negociacao')
      const valorEmNegociacao = emNegociacao.reduce((sum, l) => sum + (l.orderValue ?? 0), 0)
      const totalVendas = ganhos.reduce((sum, l) => sum + (l.finalOrderValue ?? 0), 0)

      // % de cada etapa em relação ao total de leads do período (não da etapa
      // anterior) — contagens são uma fotografia do status atual, não
      // acumulativas, então "etapa atual / etapa anterior" pode passar de
      // 100% ou zerar sempre que a etapa anterior estiver vazia.
      const funnel = STATUS_VALUES.map((status) => {
        const count = todosLeads.filter((l) => l.status === status).length
        return { status, label: STATUS_LABELS[status], count, conversionRate: total > 0 ? (count / total) * 100 : 0 }
      })

      return {
        tempoMedioPrimeiroContatoHoras: avg(temposPrimeiroContato),
        ticketMedio,
        taxaConversaoPct: taxaConversao,
        valorEmNegociacao,
        totalLeads: total,
        totalGanhos: ganhos.length,
        taxaPerda,
        totalPerdidosDesqualificados: perdidos.length + desqualificados.length,
        tempoMedioFechamentoDias,
        totalVendas,
        funnel,
      }
    }),
})
