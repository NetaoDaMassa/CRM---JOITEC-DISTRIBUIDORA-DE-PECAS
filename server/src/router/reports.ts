import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { router, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, leadHistory } from '../db/schema.js'
import { exportLeadsToExcel } from '../lib/excel.js'
import { STATUS_ORDER, STATUS_LABELS } from '../lib/status.js'
import { businessHoursElapsedMs } from '../lib/businessHours.js'

const SEGMENT_LABELS: Record<string, string> = {
  assistente_tecnico: 'Assistente Técnico',
  instalador: 'Instalador',
  revendedor_lojista: 'Revendedor/Lojista',
  outros: 'Outros',
}

const CHANNEL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google',
  whatsapp: 'WhatsApp',
  site: 'Site',
  indicacao: 'Indicação',
  outro: 'Outro',
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return ms / (1000 * 60 * 60 * 24)
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export const reportsRouter = router({
  analytics: adminProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const allLeads = await db.query.leads.findMany({
        where: eq(leads.companyId, ctx.user.companyId),
        with: {
          vendor: { columns: { passwordHash: false } },
          region: true,
          campaign: true,
        },
        orderBy: (l, { asc }) => [asc(l.createdAt)],
      })

      let scopedLeads = allLeads
      if (input.dateFrom) {
        const from = new Date(input.dateFrom)
        scopedLeads = scopedLeads.filter((l) => new Date(l.createdAt) >= from)
      }
      if (input.dateTo) {
        const to = new Date(input.dateTo)
        to.setHours(23, 59, 59, 999)
        scopedLeads = scopedLeads.filter((l) => new Date(l.createdAt) <= to)
      }

      const total = scopedLeads.length
      const ganhos = scopedLeads.filter((l) => l.status === 'ganho')
      const perdidos = scopedLeads.filter((l) => l.status === 'perdido')
      const desqualificados = scopedLeads.filter((l) => l.status === 'desqualificado')
      const encerrados = [...ganhos, ...perdidos, ...desqualificados]

      // KPIs gerais
      const taxaConversao = total > 0 ? (ganhos.length / total) * 100 : 0
      const taxaPerda = total > 0 ? ((perdidos.length + desqualificados.length) / total) * 100 : 0
      const tempoMedioFechamentoDias = avg(
        encerrados.map((l) => daysBetween(l.createdAt, l.updatedAt))
      )

      // Funil de conversão
      const funnelCounts = STATUS_ORDER.map((status) => ({
        status,
        label: STATUS_LABELS[status],
        count: scopedLeads.filter((l) => l.status === status).length,
      }))
      const progressStages = ['novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho']
      const funnel = funnelCounts.map((stage) => {
        if (!progressStages.includes(stage.status)) return { ...stage, conversionRate: null as number | null }
        const stageIdx = progressStages.indexOf(stage.status)
        if (stageIdx === 0) return { ...stage, conversionRate: null as number | null }
        const prevCount = funnelCounts.find((f) => f.status === progressStages[stageIdx - 1])!.count
        const conversionRate = prevCount > 0 ? (stage.count / prevCount) * 100 : 0
        return { ...stage, conversionRate }
      })

      // Performance por campanha
      const campaignMap = new Map<
        string,
        { campaignId: number | null; name: string; channel: string; total: number; ganho: number; perdido: number }
      >()
      for (const l of scopedLeads) {
        const key = l.campaign ? `c${l.campaign.id}` : 'sem-campanha'
        if (!campaignMap.has(key)) {
          campaignMap.set(key, {
            campaignId: l.campaign?.id ?? null,
            name: l.campaign?.name ?? 'Sem campanha',
            channel: l.campaign?.channel ?? 'outro',
            total: 0,
            ganho: 0,
            perdido: 0,
          })
        }
        const entry = campaignMap.get(key)!
        entry.total++
        if (l.status === 'ganho') entry.ganho++
        if (l.status === 'perdido' || l.status === 'desqualificado') entry.perdido++
      }
      const byCampaign = Array.from(campaignMap.values())
        .map((c) => ({
          ...c,
          channelLabel: CHANNEL_LABELS[c.channel] ?? c.channel,
          taxaConversao: c.total > 0 ? (c.ganho / c.total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total)

      // Performance por canal (agrega campanhas do mesmo canal)
      const channelMap = new Map<string, { channel: string; total: number; ganho: number }>()
      for (const l of scopedLeads) {
        const channel = l.campaign?.channel ?? 'outro'
        if (!channelMap.has(channel)) channelMap.set(channel, { channel, total: 0, ganho: 0 })
        const entry = channelMap.get(channel)!
        entry.total++
        if (l.status === 'ganho') entry.ganho++
      }
      const byChannel = Array.from(channelMap.values())
        .map((c) => ({
          ...c,
          channelLabel: CHANNEL_LABELS[c.channel] ?? c.channel,
          taxaConversao: c.total > 0 ? (c.ganho / c.total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total)

      // Performance por vendedor
      const vendorMap = new Map<
        string,
        { vendorId: number | null; name: string; total: number; ganho: number; perdido: number; temposFechamento: number[] }
      >()
      for (const l of scopedLeads) {
        const key = l.vendor ? `v${l.vendor.id}` : 'sem-vendedor'
        if (!vendorMap.has(key)) {
          vendorMap.set(key, {
            vendorId: l.vendor?.id ?? null,
            name: l.vendor?.name ?? 'Sem vendedor',
            total: 0,
            ganho: 0,
            perdido: 0,
            temposFechamento: [],
          })
        }
        const entry = vendorMap.get(key)!
        entry.total++
        if (l.status === 'ganho') {
          entry.ganho++
          entry.temposFechamento.push(daysBetween(l.createdAt, l.updatedAt))
        }
        if (l.status === 'perdido' || l.status === 'desqualificado') entry.perdido++
      }
      const byVendor = Array.from(vendorMap.values())
        .map((v) => ({
          vendorId: v.vendorId,
          name: v.name,
          total: v.total,
          ganho: v.ganho,
          perdido: v.perdido,
          taxaConversao: v.total > 0 ? (v.ganho / v.total) * 100 : 0,
          tempoMedioFechamentoDias: avg(v.temposFechamento),
        }))
        .sort((a, b) => b.total - a.total)

      // Performance por região
      const regionMap = new Map<string, { regionId: number | null; name: string; total: number; ganho: number }>()
      for (const l of scopedLeads) {
        const key = l.region ? `r${l.region.id}` : 'sem-regiao'
        if (!regionMap.has(key)) {
          regionMap.set(key, { regionId: l.region?.id ?? null, name: l.region?.name ?? 'Sem região', total: 0, ganho: 0 })
        }
        const entry = regionMap.get(key)!
        entry.total++
        if (l.status === 'ganho') entry.ganho++
      }
      const byRegion = Array.from(regionMap.values())
        .map((r) => ({ ...r, taxaConversao: r.total > 0 ? (r.ganho / r.total) * 100 : 0 }))
        .sort((a, b) => b.total - a.total)

      // Análise de perdas (segmento e canal)
      const lossLeads = [...perdidos, ...desqualificados]
      const lossBySegment = new Map<string, number>()
      for (const l of lossLeads) {
        const key = SEGMENT_LABELS[l.segment ?? ''] ?? l.segment ?? 'Não informado'
        lossBySegment.set(key, (lossBySegment.get(key) ?? 0) + 1)
      }
      const lossByChannel = new Map<string, number>()
      for (const l of lossLeads) {
        const key = CHANNEL_LABELS[l.campaign?.channel ?? ''] ?? 'Sem campanha'
        lossByChannel.set(key, (lossByChannel.get(key) ?? 0) + 1)
      }

      // Evolução mensal
      const monthMap = new Map<string, { month: string; total: number; ganho: number; perdido: number }>()
      for (const l of scopedLeads) {
        const month = l.createdAt.slice(0, 7) // YYYY-MM
        if (!monthMap.has(month)) monthMap.set(month, { month, total: 0, ganho: 0, perdido: 0 })
        const entry = monthMap.get(month)!
        entry.total++
        if (l.status === 'ganho') entry.ganho++
        if (l.status === 'perdido' || l.status === 'desqualificado') entry.perdido++
      }
      const monthlyTrend = Array.from(monthMap.values())
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12)

      return {
        kpis: {
          total,
          ganhos: ganhos.length,
          perdidos: perdidos.length,
          desqualificados: desqualificados.length,
          taxaConversao,
          taxaPerda,
          tempoMedioFechamentoDias,
        },
        funnel,
        byCampaign,
        byChannel,
        byVendor,
        byRegion,
        lossBySegment: Array.from(lossBySegment.entries()).map(([name, value]) => ({ name, value })),
        lossByChannel: Array.from(lossByChannel.entries()).map(([name, value]) => ({ name, value })),
        monthlyTrend,
      }
    }),

  exportLeads: adminProcedure
    .input(
      z.object({
        vendorId: z.number().optional(),
        status: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const allLeads = await db.query.leads.findMany({
        where: eq(leads.companyId, ctx.user.companyId),
        with: {
          vendor: { columns: { passwordHash: false } },
          region: true,
        },
        orderBy: (l, { desc }) => [desc(l.createdAt)],
      })

      let filtered = allLeads

      if (input.vendorId) {
        filtered = filtered.filter((l) => l.vendorId === input.vendorId)
      }
      if (input.status) {
        filtered = filtered.filter((l) => l.status === input.status)
      }
      if (input.dateFrom) {
        const from = new Date(input.dateFrom)
        filtered = filtered.filter((l) => new Date(l.createdAt) >= from)
      }
      if (input.dateTo) {
        const to = new Date(input.dateTo)
        to.setHours(23, 59, 59)
        filtered = filtered.filter((l) => new Date(l.createdAt) <= to)
      }

      const buffer = exportLeadsToExcel(filtered)
      return {
        data: buffer.toString('base64'),
        filename: `leads_odin_${new Date().toISOString().slice(0, 10)}.xlsx`,
        count: filtered.length,
      }
    }),

  slaOverview: adminProcedure.query(async ({ ctx }) => {
    const abordagemLeads = await db.query.leads.findMany({
      where: and(eq(leads.status, 'abordagem'), eq(leads.companyId, ctx.user.companyId)),
      with: { vendor: { columns: { passwordHash: false } } },
    })

    const vendorMap = new Map<
      string,
      { vendorId: number | null; name: string; total: number; emRisco: number; critico: number; hoursStuck: number[] }
    >()
    for (const l of abordagemLeads) {
      const key = l.vendor ? `v${l.vendor.id}` : 'sem-vendedor'
      if (!vendorMap.has(key)) {
        vendorMap.set(key, {
          vendorId: l.vendor?.id ?? null,
          name: l.vendor?.name ?? 'Sem vendedor',
          total: 0,
          emRisco: 0,
          critico: 0,
          hoursStuck: [],
        })
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
      where: and(
        inArray(leadHistory.action, ['reatribuicao_automatica', 'transferido']),
        eq(leadHistory.companyId, ctx.user.companyId)
      ),
      with: {
        fromVendor: { columns: { passwordHash: false } },
        toVendor: { columns: { passwordHash: false } },
      },
      orderBy: (h, { desc }) => [desc(h.createdAt)],
    })

    const reassignMap = new Map<string, { vendorId: number | null; name: string; received: number; lost: number }>()
    for (const h of historyRows) {
      if (h.toVendorId) {
        const key = `v${h.toVendorId}`
        if (!reassignMap.has(key)) {
          reassignMap.set(key, { vendorId: h.toVendorId, name: h.toVendor?.name ?? 'Desconhecido', received: 0, lost: 0 })
        }
        reassignMap.get(key)!.received++
      }
      if (h.fromVendorId) {
        const key = `v${h.fromVendorId}`
        if (!reassignMap.has(key)) {
          reassignMap.set(key, { vendorId: h.fromVendorId, name: h.fromVendor?.name ?? 'Desconhecido', received: 0, lost: 0 })
        }
        reassignMap.get(key)!.lost++
      }
    }
    const reassignmentHistory = Array.from(reassignMap.values()).sort((a, b) => b.received - a.received)

    return { overdueByVendor, avgTimeStuckByStage, criticalAlertVendors, reassignmentHistory }
  }),
})
