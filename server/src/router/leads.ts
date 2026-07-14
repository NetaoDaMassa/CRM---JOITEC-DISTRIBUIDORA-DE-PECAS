import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { router, protectedProcedure, adminProcedure } from './_base.js'
import { db } from '../db/client.js'
import { leads, leadNotes, leadHistory, leadAttachments, leadContactAttempts, users, notifications } from '../db/schema.js'
import { getVendorByDDD, getRegionIdByDDD } from '../lib/roundrobin.js'
import {
  STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  isTerminalStatus,
  getMissingRequiredFields,
} from '../lib/status.js'
import { toLocalDateKey } from '../lib/businessHours.js'

const CHANNEL_VALUES = ['ligacao', 'whatsapp', 'email'] as const
const RESULT_VALUES = ['sem_resposta', 'nao_atendeu', 'reagendou', 'recusou', 'avancou'] as const

const SEGMENT_VALUES = ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'] as const

const STATUS_FIELD_LABELS: Record<string, string> = {
  codSap: 'Código SAP',
  orderValue: 'Valor do Pedido',
  finalOrderValue: 'Valor Final do Pedido',
  paymentMethod: 'Forma de Pagamento',
  lossReason: 'Motivo da Perda',
  disqualifyReason: 'Motivo da Desqualificação',
}

export const leadsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(STATUS_VALUES).optional(),
        vendorId: z.number().optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, status, vendorId, dateFrom, dateTo } = input
      const offset = (page - 1) * pageSize

      const allLeads = await db.query.leads.findMany({
        where: and(eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt)),
        with: {
          vendor: { columns: { passwordHash: false } },
          region: true,
        },
        orderBy: (l, { desc }) => [desc(l.createdAt)],
      })

      let filtered = allLeads

      // Vendedor só vê seus próprios leads
      if (ctx.user.role === 'vendor') {
        filtered = filtered.filter((l) => l.vendorId === ctx.user.id)
      } else if (vendorId) {
        filtered = filtered.filter((l) => l.vendorId === vendorId)
      }

      if (status) filtered = filtered.filter((l) => l.status === status)

      if (search) {
        const s = search.toLowerCase()
        filtered = filtered.filter(
          (l) =>
            l.name.toLowerCase().includes(s) ||
            l.phone.includes(s) ||
            (l.company?.toLowerCase().includes(s) ?? false)
        )
      }

      if (dateFrom) {
        const from = new Date(dateFrom)
        filtered = filtered.filter((l) => new Date(l.createdAt) >= from)
      }
      if (dateTo) {
        const to = new Date(dateTo)
        to.setHours(23, 59, 59)
        filtered = filtered.filter((l) => new Date(l.createdAt) <= to)
      }

      const total = filtered.length
      const data = filtered.slice(offset, offset + pageSize)
      return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({
        where: and(eq(leads.id, input.id), isNull(leads.deletedAt)),
        with: {
          vendor: { columns: { passwordHash: false } },
          region: true,
          notes: {
            with: { user: { columns: { passwordHash: false } } },
            orderBy: (n, { desc }) => [desc(n.createdAt)],
          },
          attachments: {
            with: { user: { columns: { passwordHash: false } } },
            orderBy: (a, { desc }) => [desc(a.createdAt)],
          },
          history: {
            with: { user: { columns: { passwordHash: false } } },
            orderBy: (h, { desc }) => [desc(h.createdAt)],
          },
        },
      })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.companyId !== ctx.user.companyId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id) {
        throw new Error('Acesso negado')
      }
      return lead
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
        // Vendedor só pode cadastrar lead para si mesmo — nunca escolhe outro vendedor nem rodízio
        vendorId = ctx.user.id
        regionId = await getRegionIdByDDD(input.ddd, ctx.user.companyId)
      } else if (input.vendorId) {
        const targetVendor = await db.query.users.findFirst({ where: eq(users.id, input.vendorId) })
        if (!targetVendor || targetVendor.companyId !== ctx.user.companyId || targetVendor.role !== 'vendor') {
          throw new Error('Vendedor inválido')
        }
        vendorId = input.vendorId
        regionId = await getRegionIdByDDD(input.ddd, ctx.user.companyId)
      } else if (input.autoAssign) {
        vendorId = await getVendorByDDD(input.ddd, ctx.user.companyId)
        regionId = await getRegionIdByDDD(input.ddd, ctx.user.companyId)
      }

      const result = await db.insert(leads).values({
        companyId: ctx.user.companyId,
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
        companyId: ctx.user.companyId,
        leadId,
        userId: ctx.user.id,
        action: 'criado',
        toStatus: 'novo',
        details: `Lead criado${vendorId ? ` e atribuído ao vendedor` : ' sem vendedor'}`,
      })

      if (vendorId && vendorId !== ctx.user.id) {
        await db.insert(notifications).values({
          vendorId,
          leadId,
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
      if (existing.companyId !== ctx.user.companyId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && existing.vendorId !== ctx.user.id)
        throw new Error('Acesso negado')

      const updates: Record<string, unknown> = { ...rest }
      if (nextContactAt !== undefined) {
        if (nextContactAt === null && !isTerminalStatus(existing.status)) {
          throw new Error('Todo lead ativo precisa manter uma data de próximo contato agendada')
        }
        updates.nextContactAt = nextContactAt
      }

      await db.update(leads).set(updates).where(eq(leads.id, id))
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
          orderValue: z.number().optional(),
          finalOrderValue: z.number().optional(),
          paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
          lossReason: z.string().optional(),
          disqualifyReason: z.string().optional(),
        })
        .superRefine((input, ctx) => {
          const missing = getMissingRequiredFields(input.status, input)
          for (const key of missing) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${STATUS_FIELD_LABELS[key]} é obrigatório para essa etapa`,
            })
          }
          if (!isTerminalStatus(input.status) && !input.nextContactAt) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['nextContactAt'],
              message: 'É necessário agendar o próximo contato para manter o lead ativo',
            })
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.leads.findFirst({ where: and(eq(leads.id, input.id), isNull(leads.deletedAt)) })
      if (!existing) throw new Error('Lead não encontrado')
      if (existing.companyId !== ctx.user.companyId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && existing.vendorId !== ctx.user.id)
        throw new Error('Acesso negado')

      if (input.status === 'desqualificado') {
        const attempts = await db.query.leadContactAttempts.findMany({
          where: eq(leadContactAttempts.leadId, input.id),
        })
        const distinctDates = new Set(attempts.map((a) => toLocalDateKey(a.createdAt)))
        if (attempts.length < 3 || distinctDates.size < 3) {
          const missing = Math.max(3 - attempts.length, 3 - distinctDates.size)
          throw new Error(
            `Faltam ${missing} tentativa(s) de contato para desqualificar este lead (mínimo 3, em datas diferentes)`
          )
        }
      }

      const now = new Date().toISOString()
      const updates: Record<string, unknown> = {
        status: input.status,
        statusChangedAt: now,
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

      await db.update(leads).set(updates).where(eq(leads.id, input.id))

      await db.insert(leadHistory).values({
        companyId: ctx.user.companyId,
        leadId: input.id,
        userId: ctx.user.id,
        action: 'status_alterado',
        fromStatus: existing.status,
        toStatus: input.status,
        details: `Status alterado de "${existing.status}" para "${input.status}"`,
      })

      return { success: true }
    }),

  addNote: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        type: z.enum(['nota', 'lembrete']),
        content: z.string().min(1),
        nextContactAt: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.companyId !== ctx.user.companyId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id)
        throw new Error('Acesso negado')

      await db.insert(leadNotes).values({
        leadId: input.leadId,
        userId: ctx.user.id,
        type: input.type,
        content: input.content,
        nextContactAt: input.nextContactAt ?? null,
      })

      return { success: true }
    }),

  addContactAttempt: protectedProcedure
    .input(
      z.object({
        leadId: z.number(),
        channel: z.enum(CHANNEL_VALUES),
        result: z.enum(RESULT_VALUES),
        nextActionAt: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.companyId !== ctx.user.companyId) throw new Error('Acesso negado')
      if (ctx.user.role === 'vendor' && lead.vendorId !== ctx.user.id)
        throw new Error('Acesso negado')

      if (!isTerminalStatus(lead.status) && !input.nextActionAt && !lead.nextContactAt) {
        throw new Error('Registrar uma tentativa requer uma data de próximo contato para leads ativos')
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
          attemptCount: newCount,
          lastContactStaleAlertSentAt: null,
          nextContactAt: input.nextActionAt ?? lead.nextContactAt,
        })
        .where(eq(leads.id, input.leadId))

      await db.insert(leadHistory).values({
        companyId: ctx.user.companyId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'tentativa_contato',
        details: `Tentativa #${newCount} via ${input.channel}: ${input.result}`,
      })

      return { success: true }
    }),

  transfer: adminProcedure
    .input(
      z.object({
        leadId: z.number(),
        newVendorId: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), isNull(leads.deletedAt)) })
      if (!lead) throw new Error('Lead não encontrado')
      if (lead.companyId !== ctx.user.companyId) throw new Error('Acesso negado')

      const newVendor = await db.query.users.findFirst({ where: eq(users.id, input.newVendorId) })
      if (!newVendor || newVendor.companyId !== ctx.user.companyId) {
        throw new Error('Vendedor de destino inválido')
      }

      const previousVendor = lead.vendorId
      await db
        .update(leads)
        .set({ vendorId: input.newVendorId, assignedAt: new Date().toISOString() })
        .where(eq(leads.id, input.leadId))

      await db.insert(leadHistory).values({
        companyId: ctx.user.companyId,
        leadId: input.leadId,
        userId: ctx.user.id,
        action: 'transferido',
        fromVendorId: previousVendor,
        toVendorId: input.newVendorId,
        details: `Transferido do vendedor #${previousVendor} para #${input.newVendorId}. ${input.reason ?? ''}`,
      })

      await db.insert(notifications).values({
        vendorId: input.newVendorId,
        leadId: input.leadId,
        type: 'lead_assigned',
        title: 'Lead transferido para você',
        message: `${lead.name} foi transferido para você agora.`,
      })

      return { success: true }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.query.leads.findFirst({
        where: and(eq(leads.id, input.id), eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt)),
      })
      if (!existing) throw new Error('Lead não encontrado')

      const now = new Date().toISOString()
      await db
        .update(leads)
        .set({ deletedAt: now, deletedBy: ctx.user.id })
        .where(eq(leads.id, input.id))

      await db.insert(leadHistory).values({
        companyId: ctx.user.companyId,
        leadId: input.id,
        userId: ctx.user.id,
        action: 'excluido',
        details: `Lead "${existing.name}" excluído por ${ctx.user.name}`,
      })

      return { success: true }
    }),

  deleteAll: adminProcedure
    .input(z.object({ vendorId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const where = input.vendorId
        ? and(eq(leads.vendorId, input.vendorId), eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt))
        : and(eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt))

      const toDelete = await db.query.leads.findMany({ where })
      if (toDelete.length === 0) return { success: true }

      const now = new Date().toISOString()
      await db.update(leads).set({ deletedAt: now, deletedBy: ctx.user.id }).where(where)

      await db.insert(leadHistory).values(
        toDelete.map((l) => ({
          companyId: ctx.user.companyId,
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
      where: and(eq(leads.status, 'abordagem'), eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt)),
      with: { vendor: { columns: { passwordHash: false } } },
    })

    const mine =
      ctx.user.role === 'vendor'
        ? abordagemLeads.filter((l) => l.vendorId === ctx.user.id)
        : abordagemLeads

    const severity = (l: (typeof mine)[number]) => (l.slaStatus === 'critico' ? 2 : l.slaStatus === 'em_risco' ? 1 : 0)

    return mine.slice().sort((a, b) => {
      const severityDiff = severity(b) - severity(a)
      if (severityDiff !== 0) return severityDiff
      const aStarted = a.statusChangedAt ?? a.updatedAt
      const bStarted = b.statusChangedAt ?? b.updatedAt
      return aStarted.localeCompare(bStarted)
    })
  }),

  slaCriticalCount: protectedProcedure.query(async ({ ctx }) => {
    const abordagemLeads = await db.query.leads.findMany({
      where: and(
        eq(leads.status, 'abordagem'),
        eq(leads.slaStatus, 'critico'),
        eq(leads.companyId, ctx.user.companyId),
        isNull(leads.deletedAt)
      ),
    })
    const count =
      ctx.user.role === 'vendor'
        ? abordagemLeads.filter((l) => l.vendorId === ctx.user.id).length
        : abordagemLeads.length
    return { count }
  }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const allLeads = await db.query.leads.findMany({
      where: and(eq(leads.companyId, ctx.user.companyId), isNull(leads.deletedAt)),
      with: { vendor: { columns: { passwordHash: false } } },
    })

    const myLeads = ctx.user.role === 'vendor'
      ? allLeads.filter((l) => l.vendorId === ctx.user.id)
      : allLeads

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
})
