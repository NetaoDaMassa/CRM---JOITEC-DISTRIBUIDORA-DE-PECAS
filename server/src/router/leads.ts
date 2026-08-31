import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import {
  leads,
  leadNotes,
  leadHistory,
  leadAttachments,
  leadContactAttempts,
  leadTrackingVisitors,
  users,
  notifications,
  empresas,
  clientes,
  carteiraHistorico,
  funilMensal,
  propostas,
  leadCampaigns,
} from '../db/schema.js'
import { getVendorByDDD, getRegionIdByDDD, assignNextVendor } from '../lib/leadsRoundRobin.js'
import { validateNextContactLimit } from '../lib/businessHours.js'
import { cnpjValido, limparCnpj } from '../lib/cnpj.js'
import { cpfValido, limparCpf } from '../lib/cpf.js'
import { REGIAO_VALUES } from '../lib/regiao.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { notificarGestores } from '../lib/propostasGates.js'
import {
  STATUS_VALUES,
  SEGMENT_VALUES,
  CHANNEL_VALUES,
  RESULT_VALUES,
  PAYMENT_METHOD_VALUES,
  STATUS_FIELD_LABELS,
  isTerminalStatus,
  isStatusAllowedForCompany,
  getMissingRequiredFields,
  getLeadEffectiveDate,
} from '../lib/leadsStatus.js'

// Portado de /Users/weslley/Documents/odin-tubos-crm--master/server/src/router/leads.ts
// (fase 1 do plano em /Users/weslley/.claude/plans/stateful-soaring-moore.md — núcleo
// só, sem SLA dashboard/histórico de transferências/motor de alertas automáticos).
//
// Adaptações deliberadas em relação ao sistema de origem:
// 1. Reaproveita a tabela `notifications` que já existe aqui (vendedorId/clienteId
//    opcional/type livre/title/message) em vez de portar a tabela própria do sistema
//    antigo — por isso as notificações daqui não têm link direto pro lead (sem coluna
//    `leadId`), são só um aviso ("você tem um lead novo"), sem deep-link.
// 2. Fila de revisão de "desqualificado": o sistema antigo usava o campo `read` da
//    notificação (não linkada aqui) pra saber se um lead desqualificado ainda estava
//    pendente de revisão. Aqui isso é decidido direto pelo `leadHistory`: o evento mais
//    recente do lead entre "entrou em desqualificado" e "desqualificação aprovada" —
//    se o mais recente for a entrada, ainda está pendente.
// 3. "Admin da empresa" pra quem o lead desqualificado é reatribuído: o sistema antigo
//    tinha sempre um usuário fixo `username: 'admin'` por empresa. Aqui uma empresa pode
//    ter mais de um admin, então prioriza o superAdmin "dono" da empresa (se existir) e
//    cai pro primeiro admin comum encontrado.

const ABORDAGEM_MAX_BUSINESS_DAYS = 4

// Etapas a partir das quais dá pra transferir um lead da Odin Compressores
// pra Propostas (ver transferirParaPropostas abaixo) — pedido do João,
// 2026-08-31: libera já em "Em Negociação", não só em "Ganho".
const ETAPAS_TRANSFERIVEIS_PROPOSTA = ['em_negociacao', 'ganho']

function validateLeadNextContact(lead: { status: string }, nextContactAt: string | null | undefined): void {
  if (nextContactAt && lead.status === 'abordagem') {
    const error = validateNextContactLimit(nextContactAt, ABORDAGEM_MAX_BUSINESS_DAYS)
    if (error) throw new Error(error)
  }
}

async function empresaSlug(empresaId: number): Promise<string> {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, empresaId), columns: { slug: true } })
  if (!empresa) throw new Error('Empresa não encontrada')
  return empresa.slug
}

// Ver adaptação (3) acima.
async function findEmpresaAdmin(empresaId: number): Promise<{ id: number; name: string } | null> {
  return (
    (await db.query.users.findFirst({
      where: and(eq(users.empresaId, empresaId), eq(users.role, 'admin')),
      orderBy: (u, { desc }) => [desc(u.superAdmin)],
      columns: { id: true, name: true },
    })) ?? null
  )
}

export const leadsRouter = router({
  // Leads parados em "Novo" por vendedor — pro slide "Leads aguardando" do
  // Painel de TV. Antes vinha do CRM de marketing externo (odin-tubos-crm,
  // cruzado por username); trocado 2026-08-28 pra ler direto da tabela
  // `leads` daqui, já que os leads de verdade agora moram no Joitec CRM (o
  // sistema antigo tinha dado desatualizado — ex: vendedor sem lead nenhum
  // aqui ainda aparecia lá).
  aguardandoPorVendedor: protectedProcedure.query(async ({ ctx }) => {
    const abertos = await db.query.leads.findMany({
      where: and(eq(leads.empresaId, ctx.empresaId), eq(leads.status, 'novo'), isNull(leads.deletedAt)),
      columns: { id: true, vendorId: true },
    })

    const vendedoresLocais = await db.query.users.findMany({
      where: eq(users.empresaId, ctx.empresaId),
      columns: { id: true, name: true, fotoUrl: true },
    })
    const porId = new Map(vendedoresLocais.map((v) => [v.id, v]))

    const contagemPorVendedor = new Map<number, number>()
    let semVendedor = 0
    for (const l of abertos) {
      if (l.vendorId == null) {
        semVendedor++
        continue
      }
      contagemPorVendedor.set(l.vendorId, (contagemPorVendedor.get(l.vendorId) ?? 0) + 1)
    }

    const vendedores = [...contagemPorVendedor.entries()]
      .map(([vendorId, leadsNovo]) => {
        const local = porId.get(vendorId)
        return { id: vendorId, nome: local?.name ?? `Vendedor #${vendorId}`, fotoUrl: local?.fotoUrl ?? null, leadsNovo }
      })
      .sort((a, b) => b.leadsNovo - a.leadsNovo)

    return { totalLeadsNovo: abertos.length, semVendedor, vendedores }
  }),

  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(STATUS_VALUES).optional(),
        vendorId: z.number().optional(),
        segment: z.enum(SEGMENT_VALUES).optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        fromSite: z.boolean().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, status, vendorId, segment, dateFrom, dateTo, fromSite } = input
      const offset = (page - 1) * pageSize

      const rawLeads = await db.query.leads.findMany({
        where: and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
        with: {
          vendor: { columns: { passwordHash: false } },
          region: true,
        },
        orderBy: (l, { desc }) => [desc(l.createdAt)],
      })

      // Leads com visitante rastreado vinculado vieram do site (identificado por
      // telefone num form_submit/ebook/blog) — diferente de `source` (texto livre,
      // não confiável pra distinguir origem).
      const siteVisitorRows = await db
        .select({ leadId: leadTrackingVisitors.leadId })
        .from(leadTrackingVisitors)
        .where(and(eq(leadTrackingVisitors.empresaId, ctx.empresaId), isNotNull(leadTrackingVisitors.leadId)))
      const siteLeadIds = new Set(siteVisitorRows.map((r) => r.leadId))

      const allLeads = rawLeads.map((l) => ({ ...l, fromSite: siteLeadIds.has(l.id) }))

      let filtered = allLeads

      if (ctx.user.role === 'vendor') {
        filtered = filtered.filter((l) => l.vendorId === ctx.user.id)
      } else if (vendorId) {
        filtered = filtered.filter((l) => l.vendorId === vendorId)
      }

      if (status) filtered = filtered.filter((l) => l.status === status)
      if (segment) filtered = filtered.filter((l) => l.segment === segment)
      if (fromSite) filtered = filtered.filter((l) => l.fromSite)

      if (search) {
        const s = search.toLowerCase()
        filtered = filtered.filter(
          (l) => l.name.toLowerCase().includes(s) || l.phone.includes(s) || (l.company?.toLowerCase().includes(s) ?? false)
        )
      }

      if (dateFrom) {
        const from = new Date(dateFrom)
        filtered = filtered.filter((l) => new Date(getLeadEffectiveDate(l)) >= from)
      }
      if (dateTo) {
        const to = new Date(dateTo)
        to.setHours(23, 59, 59)
        filtered = filtered.filter((l) => new Date(getLeadEffectiveDate(l)) <= to)
      }

      const total = filtered.length
      const page1 = filtered.slice(offset, offset + pageSize)

      // Pro vendedor entender de onde o lead veio quando cai na mão dele por rodízio ou
      // transferência — olha só o evento mais recente de troca de vendedor de cada lead,
      // e só usa se ele terminou com o vendedor atual (senão é história de uma troca
      // anterior).
      const pageIds = page1.map((l) => l.id)
      const reassignMap = new Map<number, { name: string; type: 'rodizio' | 'transferencia'; at: string; stage: string | null }>()
      if (pageIds.length > 0) {
        const events = await db.query.leadHistory.findMany({
          where: and(inArray(leadHistory.leadId, pageIds), inArray(leadHistory.action, ['reatribuicao_automatica', 'transferido'])),
          orderBy: (h, { desc }) => [desc(h.createdAt)],
        })
        const fromVendorIds = [...new Set(events.map((e) => e.fromVendorId).filter((id): id is number => id != null))]
        const fromVendorRows = fromVendorIds.length
          ? await db.query.users.findMany({ where: inArray(users.id, fromVendorIds), columns: { id: true, name: true } })
          : []
        const fromVendorNameById = new Map(fromVendorRows.map((u) => [u.id, u.name]))

        for (const ev of events) {
          if (reassignMap.has(ev.leadId)) continue
          const lead = page1.find((l) => l.id === ev.leadId)
          if (!lead || ev.toVendorId !== lead.vendorId || ev.fromVendorId == null) continue
          const fromVendorName = fromVendorNameById.get(ev.fromVendorId)
          if (!fromVendorName) continue
          reassignMap.set(ev.leadId, {
            name: fromVendorName,
            type: ev.action === 'reatribuicao_automatica' ? 'rodizio' : 'transferencia',
            at: ev.createdAt,
            stage: ev.fromStatus,
          })
        }
      }

      const data = page1.map((l) => ({ ...l, reassignedFrom: reassignMap.get(l.id) ?? null }))

      return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const lead = await db.query.leads.findFirst({
      where: and(eq(leads.id, input.id), isNull(leads.deletedAt)),
      with: {
        vendor: { columns: { passwordHash: false } },
        region: true,
        notes: { with: { user: { columns: { passwordHash: false } } }, orderBy: (n, { desc }) => [desc(n.createdAt)] },
        contactAttempts: { with: { user: { columns: { passwordHash: false } } }, orderBy: (a, { desc }) => [desc(a.createdAt)] },
        attachments: { with: { user: { columns: { passwordHash: false } } }, orderBy: (a, { desc }) => [desc(a.createdAt)] },
        history: { with: { user: { columns: { passwordHash: false } } }, orderBy: (h, { desc }) => [desc(h.createdAt)] },
        convertidoParaCliente: { columns: { id: true, razaoSocial: true } },
        convertidoParaProposta: { columns: { id: true } },
        campaign: { columns: { id: true, name: true } },
      },
    })
    if (!lead) throw new Error('Lead não encontrado')
    if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
    if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')
    return lead
  }),

  trackingHistory: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.id) })
    if (!lead) throw new Error('Lead não encontrado')
    if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
    if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

    const visitors = await db.query.leadTrackingVisitors.findMany({
      where: eq(leadTrackingVisitors.leadId, input.id),
      with: { events: { orderBy: (e, { desc }) => [desc(e.createdAt)] } },
    })

    return visitors
      .flatMap((v) =>
        v.events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          pageUrl: e.pageUrl,
          pageTitle: e.pageTitle,
          metadata: e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : null,
          createdAt: e.createdAt,
          utmSource: v.utmSource,
          utmMedium: v.utmMedium,
          utmCampaign: v.utmCampaign,
        }))
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2),
        phone: z.string().min(8),
        ddd: z.number().min(11).max(99),
        email: z.string().email().optional().or(z.literal('')),
        company: z.string().optional(),
        city: z.string().optional(),
        segment: z.enum(SEGMENT_VALUES).optional(),
        source: z.string().optional(),
        observations: z.string().optional(),
        vendorId: z.number().optional(),
        autoAssign: z.boolean().default(true),
        campaignId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let vendorId: number | null = null
      let regionId: number | null = null

      if (ctx.user.role === 'vendor') {
        // Vendedor só cadastra lead pra si mesmo — nunca escolhe outro vendedor nem rodízio.
        vendorId = ctx.user.id
        regionId = await getRegionIdByDDD(input.ddd, ctx.empresaId)
      } else if (input.vendorId) {
        const targetVendor = await db.query.users.findFirst({ where: eq(users.id, input.vendorId) })
        if (!targetVendor || targetVendor.empresaId !== ctx.empresaId || targetVendor.role !== 'vendor') {
          throw new Error('Vendedor inválido')
        }
        vendorId = input.vendorId
        regionId = await getRegionIdByDDD(input.ddd, ctx.empresaId)
      } else if (input.autoAssign) {
        vendorId = await getVendorByDDD(input.ddd, ctx.empresaId)
        regionId = await getRegionIdByDDD(input.ddd, ctx.empresaId)
      }

      if (input.campaignId) {
        const campanha = await db.query.leadCampaigns.findFirst({ where: eq(leadCampaigns.id, input.campaignId) })
        if (!campanha || campanha.empresaId !== ctx.empresaId) throw new Error('Campanha inválida')
      }

      const result = await db.insert(leads).values({
        empresaId: ctx.empresaId,
        name: input.name,
        phone: input.phone,
        ddd: input.ddd,
        email: input.email || null,
        company: input.company || null,
        city: input.city || null,
        segment: input.segment,
        source: input.source || null,
        observations: input.observations || null,
        vendorId,
        regionId,
        campaignId: input.campaignId ?? null,
        assignedAt: vendorId ? new Date().toISOString() : null,
        statusChangedAt: new Date().toISOString(),
      })

      const leadId = Number(result.lastInsertRowid)

      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId,
        userId: ctx.user.id,
        action: 'criado',
        toStatus: 'novo',
        details: `Lead criado${vendorId ? ' e atribuído ao vendedor' : ' sem vendedor'}`,
      })

      if (vendorId && vendorId !== ctx.user.id) {
        await db.insert(notifications).values({
          vendedorId: vendorId,
          type: 'lead_assigned',
          title: 'Novo lead atribuído',
          message: `${input.name} foi distribuído para você agora.`,
        })
      }

      return { id: leadId }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
        city: z.string().optional(),
        segment: z.enum(SEGMENT_VALUES).optional(),
        source: z.string().optional(),
        observations: z.string().optional(),
        nextContactAt: z.string().optional().nullable(),
        campaignId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, nextContactAt, ...rest } = input

      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && existing.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      const updates: Record<string, unknown> = { ...rest }
      if (nextContactAt !== undefined) {
        if (nextContactAt === null && !isTerminalStatus(existing.status)) {
          throw new Error('Todo lead ativo precisa manter uma data de próximo contato agendada')
        }
        if (nextContactAt !== null && existing.status === 'abordagem') {
          const error = validateNextContactLimit(nextContactAt, ABORDAGEM_MAX_BUSINESS_DAYS)
          if (error) throw new Error(error)
        }
        updates.nextContactAt = nextContactAt
      }

      updates.updatedAt = sql`(datetime('now'))`
      await db.update(leads).set(updates).where(eq(leads.id, id))
      return { success: true }
    }),

  // Correção manual dos valores de venda pelo admin — o vendedor só grava esses campos
  // durante changeStatus; depois de fechado, só o admin corrige.
  updateSaleValues: adminProcedure
    .input(
      z.object({
        id: z.number(),
        codSap: z.string().optional(),
        orderValue: z.number().positive().max(10_000_000).optional().nullable(),
        finalOrderValue: z.number().positive().max(10_000_000).optional().nullable(),
        paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')

      await db
        .update(leads)
        .set({ ...updates, updatedAt: sql`(datetime('now'))` })
        .where(eq(leads.id, id))
      return { success: true }
    }),

  changeStatus: protectedProcedure
    .input(
      z
        .object({
          id: z.number(),
          status: z.enum(STATUS_VALUES),
          nextContactAt: z.string().optional().nullable(),
          codSap: z.string().optional(),
          orderValue: z.number().positive().max(10_000_000).optional(),
          finalOrderValue: z.number().positive().max(10_000_000).optional(),
          paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
          lossReason: z.string().optional(),
          disqualifyReason: z.string().optional(),
          finalConsumerReason: z.string().optional(),
        })
        .superRefine((input, ctx) => {
          const missing = getMissingRequiredFields(input.status, input)
          for (const key of missing) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${STATUS_FIELD_LABELS[key]} é obrigatório para essa etapa` })
          }
          if (!isTerminalStatus(input.status) && !input.nextContactAt) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextContactAt'], message: 'É necessário agendar o próximo contato para manter o lead ativo' })
          }
          if (input.status === 'abordagem' && input.nextContactAt) {
            const error = validateNextContactLimit(input.nextContactAt, ABORDAGEM_MAX_BUSINESS_DAYS)
            if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextContactAt'], message: error })
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, input.id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && existing.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      // Lead já transferido (virou cliente de Carteira ou proposta de
      // verdade) trava a etapa — mudar pra outro status aqui não desfaz o
      // cliente/proposta já criado, só deixaria os dois registros
      // contando histórias diferentes. Pra reverter, mexe direto no
      // cliente/proposta (ex: excluir), não no lead.
      if (existing.convertidoParaClienteId || existing.convertidoParaPropostaId) {
        throw new Error('Este lead já foi transferido — a etapa não pode mais mudar por aqui')
      }

      const slug = await empresaSlug(ctx.empresaId)
      if (!isStatusAllowedForCompany(input.status, slug)) {
        throw new Error('Essa etapa não está disponível para a sua empresa')
      }

      const now = new Date().toISOString()
      const updates: Record<string, unknown> = {
        status: input.status,
        statusChangedAt: now,
        updatedAt: sql`(datetime('now'))`,
        idleAlertSentAt: null,
        autoReassignedAt: null,
        followUpCount: 0,
        requiresAttachment: false,
        attemptCount: 0,
        slaStatus: null,
        abordagem4hAlertSentAt: null,
        lastContactStaleAlertSentAt: null,
        nextContactAt: input.nextContactAt ?? null,
      }
      if (input.codSap !== undefined) updates.codSap = input.codSap
      if (input.orderValue !== undefined) updates.orderValue = input.orderValue
      if (input.finalOrderValue !== undefined) updates.finalOrderValue = input.finalOrderValue
      if (input.paymentMethod !== undefined) updates.paymentMethod = input.paymentMethod
      if (input.lossReason !== undefined) updates.lossReason = input.lossReason
      if (input.disqualifyReason !== undefined) updates.disqualifyReason = input.disqualifyReason
      if (input.finalConsumerReason !== undefined) updates.finalConsumerReason = input.finalConsumerReason

      // Desqualificado sempre cai pro admin da empresa revisar (ver adaptação 3 no
      // topo do arquivo) — vendedor não fica dono de um lead que ele mesmo desqualificou.
      let reassignedAdmin: { id: number; name: string } | null = null
      if (input.status === 'desqualificado') {
        reassignedAdmin = await findEmpresaAdmin(ctx.empresaId)
        if (reassignedAdmin) updates.vendorId = reassignedAdmin.id
      }

      await db.update(leads).set(updates).where(eq(leads.id, input.id))

      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.id,
        userId: ctx.user.id,
        action: 'status_alterado',
        fromStatus: existing.status,
        toStatus: input.status,
        details: `Status alterado de "${existing.status}" para "${input.status}"`,
      })

      if (reassignedAdmin && reassignedAdmin.id !== ctx.user.id) {
        await db.insert(notifications).values({
          vendedorId: reassignedAdmin.id,
          type: 'lead_desqualificado_revisao',
          title: 'Lead desqualificado precisa de revisão',
          message: `O lead "${existing.name}" foi desqualificado e caiu pra você revisar o motivo.`,
        })
      }

      return { success: true }
    }),

  reopenDisqualified: adminProcedure
    .input(z.object({ id: z.number(), status: z.enum(STATUS_VALUES), observation: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, input.id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (existing.status !== 'desqualificado') throw new Error('Esse lead não está desqualificado')
      if (isTerminalStatus(input.status)) throw new Error('Escolha uma etapa ativa do funil pra reabrir o lead')

      const slug = await empresaSlug(ctx.empresaId)
      if (!isStatusAllowedForCompany(input.status, slug)) {
        throw new Error('Essa etapa não está disponível para a sua empresa')
      }

      const now = new Date().toISOString()
      const newVendorId = existing.regionId ? await assignNextVendor(existing.regionId) : null

      await db
        .update(leads)
        .set({
          status: input.status,
          statusChangedAt: now,
          updatedAt: sql`(datetime('now'))`,
          vendorId: newVendorId ?? existing.vendorId,
          assignedAt: newVendorId ? now : existing.assignedAt,
          disqualifyReason: null,
          nextContactAt: null,
          idleAlertSentAt: null,
          autoReassignedAt: null,
          followUpCount: 0,
          requiresAttachment: false,
          attemptCount: 0,
          slaStatus: null,
          abordagem4hAlertSentAt: null,
          lastContactStaleAlertSentAt: null,
        })
        .where(eq(leads.id, input.id))

      await db.insert(leadNotes).values({ leadId: input.id, userId: ctx.user.id, type: 'nota', content: input.observation })

      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.id,
        userId: ctx.user.id,
        action: 'reaberto_desqualificado',
        fromStatus: 'desqualificado',
        toStatus: input.status,
        details: `Reaberto de "Desqualificado" para "${input.status}": ${input.observation}`,
      })

      if (newVendorId) {
        await db.insert(notifications).values({
          vendedorId: newVendorId,
          type: 'lead_reassigned',
          title: 'Lead reaberto atribuído a você',
          message: `O lead "${existing.name}" foi reaberto e atribuído a você via rodízio.`,
        })
      }

      return { success: true }
    }),

  // Fila de revisão: leads desqualificados cujo evento mais recente relevante ainda é a
  // própria desqualificação (ver adaptação 2 no topo do arquivo — sem coluna leadId em
  // notifications pra rastrear "lido/não lido" como o sistema antigo fazia).
  pendingDisqualificationReviews: adminProcedure.query(async ({ ctx }) => {
    const pendingLeads = await db.query.leads.findMany({
      where: and(eq(leads.empresaId, ctx.empresaId), eq(leads.status, 'desqualificado'), isNull(leads.deletedAt)),
    })
    if (pendingLeads.length === 0) return []

    const leadIds = pendingLeads.map((l) => l.id)
    const relevantHistory = await db.query.leadHistory.findMany({
      where: and(
        inArray(leadHistory.leadId, leadIds),
        inArray(leadHistory.action, ['status_alterado', 'desqualificacao_aprovada'])
      ),
      with: { user: { columns: { passwordHash: false } } },
      orderBy: (h, { desc }) => [desc(h.createdAt)],
    })

    const latestRelevantByLead = new Map<number, (typeof relevantHistory)[number]>()
    for (const h of relevantHistory) {
      if (h.action === 'status_alterado' && h.toStatus !== 'desqualificado') continue
      if (!latestRelevantByLead.has(h.leadId)) latestRelevantByLead.set(h.leadId, h)
    }

    const stillPending = pendingLeads.filter((l) => latestRelevantByLead.get(l.id)?.action === 'status_alterado')

    return stillPending
      .map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        ddd: l.ddd,
        company: l.company,
        disqualifyReason: l.disqualifyReason,
        statusChangedAt: l.statusChangedAt,
        disqualifiedBy: latestRelevantByLead.get(l.id)?.user?.name ?? 'Desconhecido',
      }))
      .sort((a, b) => (b.statusChangedAt ?? '').localeCompare(a.statusChangedAt ?? ''))
  }),

  // "Aprovar": admin concorda com a desqualificação, sai da fila de revisão sem mudar de
  // etapa. Pra devolver pro Kanban usa reopenDisqualified.
  approveDisqualification: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, input.id), isNull(leads.deletedAt)) })
    if (!existing) throw new Error('Lead não encontrado')
    if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
    if (existing.status !== 'desqualificado') throw new Error('Esse lead não está desqualificado')

    await db.insert(leadHistory).values({
      empresaId: ctx.empresaId,
      leadId: input.id,
      userId: ctx.user.id,
      action: 'desqualificacao_aprovada',
      details: `Desqualificação confirmada por ${ctx.user.name}`,
    })

    return { success: true }
  }),

  setNegotiationTag: protectedProcedure
    .input(z.object({ id: z.number(), tag: z.enum(['vermelho', 'amarelo']).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, input.id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && existing.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      await db
        .update(leads)
        .set({ negotiationTag: input.tag, updatedAt: sql`(datetime('now'))` })
        .where(eq(leads.id, input.id))
      return { success: true }
    }),

  addNote: protectedProcedure
    .input(z.object({ leadId: z.number(), type: z.enum(['nota', 'lembrete']), content: z.string().min(1), nextContactAt: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      if (input.type === 'lembrete') validateLeadNextContact(lead, input.nextContactAt)

      await db.insert(leadNotes).values({
        leadId: input.leadId,
        userId: ctx.user.id,
        type: input.type,
        content: input.content,
        nextContactAt: input.nextContactAt ?? null,
      })

      if (input.type === 'lembrete' && input.nextContactAt) {
        await db
          .update(leads)
          .set({ nextContactAt: input.nextContactAt, updatedAt: sql`(datetime('now'))` })
          .where(eq(leads.id, input.leadId))
      }

      return { success: true }
    }),

  updateNote: protectedProcedure
    .input(z.object({ id: z.number(), content: z.string().min(1), nextContactAt: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.query.leadNotes.findFirst({ where: eq(leadNotes.id, input.id) })
      if (!note) throw new Error('Anotação não encontrada')

      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, note.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      if (note.type === 'lembrete') validateLeadNextContact(lead, input.nextContactAt)

      await db
        .update(leadNotes)
        .set({ content: input.content, nextContactAt: input.nextContactAt ?? null })
        .where(eq(leadNotes.id, input.id))

      if (note.type === 'lembrete' && input.nextContactAt) {
        await db
          .update(leads)
          .set({ nextContactAt: input.nextContactAt, updatedAt: sql`(datetime('now'))` })
          .where(eq(leads.id, note.leadId))
      }

      return { success: true }
    }),

  addContactAttempt: protectedProcedure
    .input(z.object({ leadId: z.number(), channel: z.enum(CHANNEL_VALUES), result: z.enum(RESULT_VALUES), nextActionAt: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      if (!isTerminalStatus(lead.status) && !input.nextActionAt && !lead.nextContactAt) {
        throw new Error('Registrar uma tentativa requer uma data de próximo contato para leads ativos')
      }
      if (lead.status === 'abordagem' && input.nextActionAt) {
        const error = validateNextContactLimit(input.nextActionAt, ABORDAGEM_MAX_BUSINESS_DAYS)
        if (error) throw new Error(error)
      }

      await db.insert(leadContactAttempts).values({
        leadId: input.leadId,
        userId: ctx.user.id,
        channel: input.channel,
        result: input.result,
        nextActionAt: input.nextActionAt ?? null,
      })

      const now = new Date().toISOString()
      const newCount = (lead.attemptCount ?? 0) + 1

      await db
        .update(leads)
        .set({
          lastContactAt: now,
          updatedAt: sql`(datetime('now'))`,
          attemptCount: newCount,
          lastContactStaleAlertSentAt: null,
          slaStatus: null,
          abordagem4hAlertSentAt: null,
          nextContactAt: input.nextActionAt ?? lead.nextContactAt,
        })
        .where(eq(leads.id, input.leadId))

      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'tentativa_contato',
        details: `Tentativa #${newCount} via ${input.channel}: ${input.result}`,
      })

      return { success: true }
    }),

  updateContactAttempt: protectedProcedure
    .input(z.object({ id: z.number(), channel: z.enum(CHANNEL_VALUES), result: z.enum(RESULT_VALUES), nextActionAt: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await db.query.leadContactAttempts.findFirst({ where: eq(leadContactAttempts.id, input.id) })
      if (!attempt) throw new Error('Tentativa não encontrada')

      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, attempt.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      validateLeadNextContact(lead, input.nextActionAt)

      await db
        .update(leadContactAttempts)
        .set({ channel: input.channel, result: input.result, nextActionAt: input.nextActionAt ?? null })
        .where(eq(leadContactAttempts.id, input.id))

      if (input.nextActionAt) {
        await db
          .update(leads)
          .set({ nextContactAt: input.nextActionAt, updatedAt: sql`(datetime('now'))` })
          .where(eq(leads.id, attempt.leadId))
      }

      return { success: true }
    }),

  // Anexo já foi enviado por multipart pra /upload/lead-attachment (tRPC não
  // suporta multipart) — aqui só grava os metadados retornados por aquele
  // endpoint. Mesmo padrão de Cliente/Devolução no resto do CRM.
  addAttachment: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        filename: z.string(),
        originalName: z.string(),
        mimeType: z.string(),
        size: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

      const { leadId, ...rest } = input
      await db.insert(leadAttachments).values({ leadId, userId: ctx.user.id, ...rest })
      return { success: true }
    }),

  deleteAttachment: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const attachment = await db.query.leadAttachments.findFirst({ where: eq(leadAttachments.id, input.id) })
    if (!attachment) throw new Error('Anexo não encontrado')

    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, attachment.leadId), isNull(leads.deletedAt)) })
    if (!lead) throw new Error('Lead não encontrado')
    if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
    if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')

    await db.delete(leadAttachments).where(eq(leadAttachments.id, input.id))
    fs.unlink(path.join(process.env.UPLOADS_DIR ?? './uploads', attachment.filename), () => {})
    return { success: true }
  }),

  transfer: adminProcedure
    .input(z.object({ leadId: z.number(), newVendorId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')

      const newVendor = await db.query.users.findFirst({ where: eq(users.id, input.newVendorId) })
      if (!newVendor || newVendor.empresaId !== ctx.empresaId) throw new Error('Vendedor de destino inválido')

      const previousVendor = lead.vendorId
      await db
        .update(leads)
        .set({
          vendorId: input.newVendorId,
          assignedAt: new Date().toISOString(),
          updatedAt: sql`(datetime('now'))`,
          // Reseta o relógio do rodízio pro novo vendedor — sem isso um lead que já
          // passou por rodízio automático antes ficaria travado fora da rotação.
          idleAlertSentAt: null,
          autoReassignedAt: null,
        })
        .where(eq(leads.id, input.leadId))

      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'transferido',
        fromStatus: lead.status,
        toStatus: lead.status,
        fromVendorId: previousVendor,
        toVendorId: input.newVendorId,
        details: `Transferido do vendedor #${previousVendor} para #${input.newVendorId}. ${input.reason ?? ''}`,
      })

      await db.insert(notifications).values({
        vendedorId: input.newVendorId,
        type: 'lead_assigned',
        title: 'Lead transferido para você',
        message: `${lead.name} foi transferido para você agora.`,
      })

      return { success: true }
    }),

  // Transferência em massa — mesma lógica do `transfer` de 1 lead só (reseta
  // relógio de rodízio, grava histórico por lead), rodada em loop pra cada
  // id marcado na tela de Leads. 1 notificação só no final (em vez de 1 por
  // lead) pra não inundar o vendedor de destino.
  transferMuitos: adminProcedure
    .input(z.object({ leadIds: z.array(z.number()).min(1), newVendorId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const newVendor = await db.query.users.findFirst({ where: eq(users.id, input.newVendorId) })
      if (!newVendor || newVendor.empresaId !== ctx.empresaId) throw new Error('Vendedor de destino inválido')

      const leadsAlvo = await db.query.leads.findMany({
        where: and(inArray(leads.id, input.leadIds), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
      })
      if (!leadsAlvo.length) throw new Error('Nenhum lead válido selecionado')

      for (const lead of leadsAlvo) {
        const previousVendor = lead.vendorId
        await db
          .update(leads)
          .set({
            vendorId: input.newVendorId,
            assignedAt: new Date().toISOString(),
            updatedAt: sql`(datetime('now'))`,
            idleAlertSentAt: null,
            autoReassignedAt: null,
          })
          .where(eq(leads.id, lead.id))

        await db.insert(leadHistory).values({
          empresaId: ctx.empresaId,
          leadId: lead.id,
          userId: ctx.user.id,
          action: 'transferido',
          fromStatus: lead.status,
          toStatus: lead.status,
          fromVendorId: previousVendor,
          toVendorId: input.newVendorId,
          details: `Transferido em massa do vendedor #${previousVendor} para #${input.newVendorId}. ${input.reason ?? ''}`,
        })
      }

      await db.insert(notifications).values({
        vendedorId: input.newVendorId,
        type: 'lead_assigned',
        title: 'Leads transferidos para você',
        message: `${leadsAlvo.length} lead(s) foram transferidos para você agora.`,
      })

      return { success: true, total: leadsAlvo.length }
    }),

  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const existing = await db.query.leads.findFirst({
      where: and(eq(leads.id, input.id), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
    })
    if (!existing) throw new Error('Lead não encontrado')

    const now = new Date().toISOString()
    await db.update(leads).set({ deletedAt: now, deletedBy: ctx.user.id }).where(eq(leads.id, input.id))

    await db.insert(leadHistory).values({
      empresaId: ctx.empresaId,
      leadId: input.id,
      userId: ctx.user.id,
      action: 'excluido',
      details: `Lead "${existing.name}" excluído por ${ctx.user.name}`,
    })

    return { success: true }
  }),

  deleteAll: adminProcedure.input(z.object({ vendorId: z.number().optional() })).mutation(async ({ ctx, input }) => {
    const where = input.vendorId
      ? and(eq(leads.vendorId, input.vendorId), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt))
      : and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt))

    const toDelete = await db.query.leads.findMany({ where })
    if (toDelete.length === 0) return { success: true }

    const now = new Date().toISOString()
    await db.update(leads).set({ deletedAt: now, deletedBy: ctx.user.id }).where(where)

    await db.insert(leadHistory).values(
      toDelete.map((l) => ({
        empresaId: ctx.empresaId,
        leadId: l.id,
        userId: ctx.user.id,
        action: 'excluido' as const,
        details: `Lead "${l.name}" excluído por ${ctx.user.name} (limpeza em massa)`,
      }))
    )

    return { success: true }
  }),

  todayQueue: protectedProcedure.query(async ({ ctx }) => {
    const abordagemLeads = await db.query.leads.findMany({
      where: and(eq(leads.status, 'abordagem'), eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
      with: { vendor: { columns: { passwordHash: false } } },
    })

    const mine = ctx.user.role === 'vendor' ? abordagemLeads.filter((l) => l.vendorId === ctx.user.id) : abordagemLeads

    const severity = (l: (typeof mine)[number]) => (l.slaStatus === 'critico' ? 2 : l.slaStatus === 'em_risco' ? 1 : 0)

    return mine.slice().sort((a, b) => {
      const severityDiff = severity(b) - severity(a)
      if (severityDiff !== 0) return severityDiff
      const aStarted = a.statusChangedAt ?? a.updatedAt
      const bStarted = b.statusChangedAt ?? b.updatedAt
      return aStarted.localeCompare(bStarted)
    })
  }),

  stats: protectedProcedure
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const allLeadsRaw = await db.query.leads.findMany({
        where: and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt)),
        with: { vendor: { columns: { passwordHash: false } } },
      })

      let allLeads = allLeadsRaw
      if (input?.dateFrom) {
        const from = new Date(input.dateFrom)
        allLeads = allLeads.filter((l) => new Date(getLeadEffectiveDate(l)) >= from)
      }
      if (input?.dateTo) {
        const to = new Date(input.dateTo)
        to.setHours(23, 59, 59)
        allLeads = allLeads.filter((l) => new Date(getLeadEffectiveDate(l)) <= to)
      }

      const myLeads = ctx.user.role === 'vendor' ? allLeads.filter((l) => l.vendorId === ctx.user.id) : allLeads

      const byStatus = STATUS_VALUES.reduce((acc, s) => {
        acc[s] = myLeads.filter((l) => l.status === s).length
        return acc
      }, {} as Record<string, number>)

      const byVendor = allLeads.reduce((acc, l) => {
        const name = l.vendor?.name ?? 'Sem vendedor'
        acc[name] = (acc[name] ?? 0) + 1
        return acc
      }, {} as Record<string, number>)

      const total = myLeads.length
      const ganhos = byStatus['ganho'] ?? 0
      const conversion = total > 0 ? Math.round((ganhos / total) * 100) : 0

      return { total, byStatus, byVendor, conversion }
    }),

  // Leads com próximo contato agendado num intervalo de datas — alimenta a
  // Agenda (CalendarBoard.tsx), mesclado ali junto com `compromissos.listar`
  // como uma fonte de dado a mais (não vira linha em `compromissos`, ver
  // plano fase 2 bloco D). Mesmo formato de input de `compromissos.listar`.
  listReminders: protectedProcedure
    .input(z.object({ dataInicio: z.string(), dataFim: z.string(), vendedorId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.query.leads.findMany({
        where: and(eq(leads.empresaId, ctx.empresaId), isNull(leads.deletedAt), isNotNull(leads.nextContactAt)),
        with: { vendor: { columns: { id: true, name: true } } },
      })

      const inicio = new Date(`${input.dataInicio}T00:00:00`)
      const fim = new Date(`${input.dataFim}T23:59:59`)

      const filtrados = rows.filter((l) => {
        if (!l.nextContactAt) return false
        const data = new Date(l.nextContactAt.replace(' ', 'T'))
        if (data < inicio || data > fim) return false
        if (ctx.user.role === 'vendor') return l.vendorId === ctx.user.id
        if (input.vendedorId) return l.vendorId === input.vendedorId
        return true
      })

      return filtrados.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        status: l.status,
        nextContactAt: l.nextContactAt,
        vendor: l.vendor,
      }))
    }),

  // Lead "Ganho" vira cliente de verdade — pedido do João: Joitec/Odin Tubos
  // usam Carteira (esse cadastro completo aqui é o "vendedor obrigado a
  // completar o cadastro" antes do cliente entrar de vez). Odin Compressores
  // NÃO usa Carteira (ver transferirParaPropostas abaixo) — bloqueado aqui.
  transferirParaCarteira: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        razaoSocial: z.string().min(2),
        cnpj: z.string().optional(),
        cpf: z.string().optional(),
        inscricaoEstadual: z.string().optional(),
        regiao: z.enum(REGIAO_VALUES),
        estado: z.string().optional(),
        cidade: z.string().optional(),
        nomeContato: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')
      if (lead.status !== 'ganho') throw new Error('Só dá pra transferir um lead que já está na etapa Ganho')
      if (lead.convertidoParaClienteId || lead.convertidoParaPropostaId) throw new Error('Este lead já foi transferido')
      if (!lead.vendorId) throw new Error('Este lead não tem vendedor atribuído')

      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
      if (empresa?.slug === 'odin-compressores') throw new Error('Odin Compressores não usa Carteira — transfira pra Propostas')

      let cnpjLimpo: string | undefined
      if (input.cnpj) {
        if (!cnpjValido(input.cnpj)) throw new Error('CNPJ inválido')
        cnpjLimpo = limparCnpj(input.cnpj)
        const existente = await db.query.clientes.findFirst({ where: and(eq(clientes.cnpj, cnpjLimpo), eq(clientes.empresaId, ctx.empresaId)) })
        if (existente && !existente.deletedAt) throw new Error('Já existe um cliente com este CNPJ')
      }
      let cpfLimpo: string | undefined
      if (input.cpf) {
        if (!cpfValido(input.cpf)) throw new Error('CPF inválido')
        cpfLimpo = limparCpf(input.cpf)
        const existente = await db.query.clientes.findFirst({ where: and(eq(clientes.cpf, cpfLimpo), eq(clientes.empresaId, ctx.empresaId)) })
        if (existente && !existente.deletedAt) throw new Error('Já existe um cliente com este CPF')
      }

      const vendedorAtualId = lead.vendorId
      const result = await db.insert(clientes).values({
        empresaId: ctx.empresaId,
        razaoSocial: input.razaoSocial,
        cnpj: cnpjLimpo,
        cpf: cpfLimpo,
        codigo: `M${Date.now()}`,
        inscricaoEstadual: input.inscricaoEstadual,
        regiao: input.regiao,
        estado: input.estado,
        cidade: input.cidade || lead.city,
        telefoneWhatsapp: `${lead.ddd}${lead.phone}`,
        email: lead.email || undefined,
        nomeContato: input.nomeContato || lead.name,
        cadastradoPor: ctx.user.id,
        vendedorAtualId,
        origemMarketing: true,
      })
      const clienteId = Number(result.lastInsertRowid)

      await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedorAtualId })
      await db.insert(funilMensal).values({ clienteId, vendedorId: vendedorAtualId, mesReferencia: mesReferenciaAtual() })
      await db.update(leads).set({ convertidoParaClienteId: clienteId }).where(eq(leads.id, input.leadId))
      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'transferido_carteira',
        details: `Transferido pra Carteira como "${input.razaoSocial}" por ${ctx.user.name}`,
      })

      return { clienteId }
    }),

  // Mesma ideia, só que pra Odin Compressores: não vira cliente de Carteira,
  // vira uma Proposta (dali pra frente segue o funil normal de Propostas —
  // ver propostas.ts). Pedido do João: diferente da "Nova Proposta" comum
  // (que só exige nome), aqui exige produto/serviço já na transferência —
  // o vendedor não pode jogar o lead pra Propostas sem dizer o que está
  // sendo proposto.
  transferirParaPropostas: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        produtosDescricao: z.string().min(1, 'Descreva o que está sendo proposto'),
        clienteWhatsapp: z.string().optional(),
        formaPagamento: z.string().optional(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.empresaId !== ctx.empresaId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) throw new Error('Acesso negado')
      // Pedido do João, 2026-08-31: pra Odin Compressores o botão de
      // transferir pra Propostas libera já em "Em Negociação", não só em
      // "Ganho" — o time quer levar o lead pro módulo de Propostas (que já
      // acompanha revenda/comissão/arquivo) assim que a negociação começa
      // de verdade, sem esperar fechar antes de começar a trabalhar a
      // proposta formal. "Ganho" continua valendo também, pra não travar
      // quem já tinha passado direto dessa etapa antes da mudança.
      if (!ETAPAS_TRANSFERIVEIS_PROPOSTA.includes(lead.status)) throw new Error('Só dá pra transferir um lead que já está em Negociação ou Ganho')
      if (lead.convertidoParaClienteId || lead.convertidoParaPropostaId) throw new Error('Este lead já foi transferido')
      if (!lead.vendorId) throw new Error('Este lead não tem vendedor atribuído')

      const empresa = await db.query.empresas.findFirst({ where: eq(empresas.id, ctx.empresaId) })
      if (empresa?.slug !== 'odin-compressores') throw new Error('Essa empresa usa Carteira, não Propostas — transfira pra Carteira')

      const result = await db.insert(propostas).values({
        empresaId: ctx.empresaId,
        vendedorId: lead.vendorId,
        clienteNome: lead.name,
        clienteWhatsapp: input.clienteWhatsapp || `${lead.ddd}${lead.phone}`,
        produtosDescricao: input.produtosDescricao,
        formaPagamento: input.formaPagamento || undefined,
        observacoes: input.observacoes || undefined,
        stage: 'proposta',
      })
      const propostaId = Number(result.lastInsertRowid)

      await db.update(leads).set({ convertidoParaPropostaId: propostaId }).where(eq(leads.id, input.leadId))
      await db.insert(leadHistory).values({
        empresaId: ctx.empresaId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'transferido_propostas',
        details: `Transferido pra Propostas por ${ctx.user.name}`,
      })
      await notificarGestores(ctx.empresaId, 'Nova proposta (via Lead ganho)', `${lead.name} — proposta criada a partir do lead ganho por ${ctx.user.name}`)

      return { propostaId }
    }),
})
