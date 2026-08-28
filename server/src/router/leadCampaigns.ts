import { z } from 'zod'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leadCampaigns, leads, leadTrackingVisitors } from '../db/schema.js'

export const CAMPAIGN_CHANNEL_VALUES = ['facebook', 'instagram', 'google', 'whatsapp', 'site', 'indicacao', 'outro'] as const

// Campanhas de marketing (Facebook Ads, Google Ads etc.) — vincula com o
// lead que chega pelo site via `utm_campaign` (capturado desde sempre em
// leadTrackingVisitors, mas nunca usado até aqui) ou escolhido na mão ao
// criar/ver o lead. Pedido do João: entender de qual campanha cada lead
// veio e quantos "Ganho" cada uma trouxe.
export const leadCampaignsRouter = router({
  listar: protectedProcedure.query(async ({ ctx }) => {
    const campanhas = await db.query.leadCampaigns.findMany({
      where: eq(leadCampaigns.empresaId, ctx.empresaId),
      orderBy: [desc(leadCampaigns.isActive), asc(leadCampaigns.name)],
    })
    const todosLeads = await db.query.leads.findMany({
      where: and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt), isNotNull(leads.campaignId)),
      columns: { campaignId: true, status: true },
    })
    return campanhas.map((c) => {
      const doGrupo = todosLeads.filter((l) => l.campaignId === c.id)
      return { ...c, totalLeads: doGrupo.length, leadsGanhos: doGrupo.filter((l) => l.status === 'ganho').length }
    })
  }),

  // Só as ativas, pro seletor de "Nova lead"/ficha do lead — sem contagem
  // (mais leve, não precisa varrer todos os leads pra isso).
  listarAtivas: protectedProcedure.query(async ({ ctx }) => {
    return db.query.leadCampaigns.findMany({
      where: and(eq(leadCampaigns.empresaId, ctx.empresaId), eq(leadCampaigns.isActive, true)),
      columns: { id: true, name: true },
      orderBy: [asc(leadCampaigns.name)],
    })
  }),

  criar: adminProcedure
    .input(z.object({ name: z.string().min(2), channel: z.enum(CAMPAIGN_CHANNEL_VALUES), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existente = await db.query.leadCampaigns.findFirst({
        where: and(eq(leadCampaigns.empresaId, ctx.empresaId), eq(leadCampaigns.name, input.name.trim())),
      })
      if (existente) throw new Error('Já existe uma campanha com esse nome')
      await db.insert(leadCampaigns).values({ empresaId: ctx.empresaId, name: input.name.trim(), channel: input.channel, description: input.description || null })
      return { success: true }
    }),

  atualizar: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        channel: z.enum(CAMPAIGN_CHANNEL_VALUES).optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      const campanha = await db.query.leadCampaigns.findFirst({ where: eq(leadCampaigns.id, id) })
      if (!campanha || campanha.empresaId !== ctx.empresaId) throw new Error('Campanha não encontrada')
      await db
        .update(leadCampaigns)
        .set({ ...updates, name: updates.name?.trim(), updatedAt: new Date().toISOString() })
        .where(eq(leadCampaigns.id, id))
      return { success: true }
    }),

  excluir: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const campanha = await db.query.leadCampaigns.findFirst({ where: eq(leadCampaigns.id, input.id) })
    if (!campanha || campanha.empresaId !== ctx.empresaId) throw new Error('Campanha não encontrada')
    const emUso = await db.query.leads.findFirst({ where: eq(leads.campaignId, input.id) })
    if (emUso) throw new Error('Já tem lead vinculado a essa campanha — desative em vez de excluir')
    await db.delete(leadCampaigns).where(eq(leadCampaigns.id, input.id))
    return { success: true }
  }),

  // utm_campaign que já chegaram de verdade (rastreamento do site) mas não
  // batem com o nome de nenhuma campanha cadastrada — pra alguém decidir
  // criar a campanha certa em vez do sistema inventar uma sozinho.
  naoVinculados: adminProcedure.query(async ({ ctx }) => {
    const visitantes = await db.query.leadTrackingVisitors.findMany({
      where: and(eq(leadTrackingVisitors.empresaId, ctx.empresaId), isNotNull(leadTrackingVisitors.utmCampaign)),
      columns: { utmCampaign: true, leadId: true },
    })
    const campanhas = await db.query.leadCampaigns.findMany({ where: eq(leadCampaigns.empresaId, ctx.empresaId), columns: { name: true } })
    const nomesConhecidos = new Set(campanhas.map((c) => c.name.toLowerCase().trim()))

    const contagem = new Map<string, { visitantes: number; leads: number }>()
    for (const v of visitantes) {
      const nome = (v.utmCampaign ?? '').trim()
      if (!nome || nomesConhecidos.has(nome.toLowerCase())) continue
      const atual = contagem.get(nome) ?? { visitantes: 0, leads: 0 }
      atual.visitantes++
      if (v.leadId) atual.leads++
      contagem.set(nome, atual)
    }
    return Array.from(contagem.entries())
      .map(([nome, c]) => ({ nome, ...c }))
      .sort((a, b) => b.leads - a.leads)
  }),
})
