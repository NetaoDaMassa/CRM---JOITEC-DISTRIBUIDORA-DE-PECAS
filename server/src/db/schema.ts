import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  channel: text('channel', {
    enum: ['facebook', 'instagram', 'google', 'whatsapp', 'site', 'indicacao', 'outro'],
  }).notNull().default('outro'),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'vendor'] }).notNull().default('vendor'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  companyUsername: unique().on(t.companyId, t.username),
}))

export const regions = sqliteTable('regions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const ddds = sqliteTable('ddds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  ddd: integer('ddd').notNull(),
  regionId: integer('region_id')
    .notNull()
    .references(() => regions.id, { onDelete: 'cascade' }),
}, (t) => ({
  companyDdd: unique().on(t.companyId, t.ddd),
}))

export const regionVendors = sqliteTable('region_vendors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  regionId: integer('region_id')
    .notNull()
    .references(() => regions.id, { onDelete: 'cascade' }),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const roundRobinState = sqliteTable('round_robin_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  regionId: integer('region_id')
    .notNull()
    .unique()
    .references(() => regions.id, { onDelete: 'cascade' }),
  nextIndex: integer('next_index').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const leads = sqliteTable('leads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  ddd: integer('ddd').notNull(),
  email: text('email'),
  company: text('company'),
  city: text('city'),
  segment: text('segment', {
    enum: ['assistente_tecnico', 'instalador', 'revendedor_lojista', 'outros'],
  }).default('outros'),
  status: text('status', {
    enum: ['novo', 'abordagem', 'qualificado', 'em_negociacao', 'ganho', 'perdido', 'desqualificado'],
  })
    .notNull()
    .default('novo'),
  vendorId: integer('vendor_id').references(() => users.id, { onDelete: 'set null' }),
  regionId: integer('region_id').references(() => regions.id, { onDelete: 'set null' }),
  campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  source: text('source'),
  observations: text('observations'),
  nextContactAt: text('next_contact_at'),
  followUpCount: integer('follow_up_count').notNull().default(0),
  requiresAttachment: integer('requires_attachment', { mode: 'boolean' }).notNull().default(false),
  statusChangedAt: text('status_changed_at'),
  idleAlertSentAt: text('idle_alert_sent_at'),
  autoReassignedAt: text('auto_reassigned_at'),
  lastContactAt: text('last_contact_at'),
  attemptCount: integer('attempt_count'),
  slaStatus: text('sla_status', { enum: ['em_risco', 'critico'] }),
  abordagem4hAlertSentAt: text('abordagem_4h_alert_sent_at'),
  lastContactStaleAlertSentAt: text('last_contact_stale_alert_sent_at'),
  codSap: text('cod_sap'),
  orderValue: real('order_value'),
  finalOrderValue: real('final_order_value'),
  paymentMethod: text('payment_method', { enum: ['avista', 'boleto', 'boleto_entrada'] }),
  lossReason: text('loss_reason'),
  disqualifyReason: text('disqualify_reason'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  assignedAt: text('assigned_at'),
})

export const leadNotes = sqliteTable('lead_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['nota', 'followup', 'lembrete'] }).notNull().default('nota'),
  content: text('content').notNull(),
  nextContactAt: text('next_contact_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const leadAttachments = sqliteTable('lead_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: [
      'lead_idle_1h',
      'lead_reassigned',
      'lead_auto_reverted',
      'abordagem_first_contact_pending',
      'abordagem_em_risco',
      'abordagem_critico',
      'abordagem_critico_escalation',
      'lead_cooling',
    ],
  }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const leadHistory = sqliteTable('lead_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  fromVendorId: integer('from_vendor_id').references(() => users.id, { onDelete: 'set null' }),
  toVendorId: integer('to_vendor_id').references(() => users.id, { onDelete: 'set null' }),
  details: text('details'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const messageTemplates = sqliteTable('message_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  whatsappText: text('whatsapp_text').notNull(),
  emailSubject: text('email_subject').notNull(),
  emailBody: text('email_body').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const leadContactAttempts = sqliteTable('lead_contact_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['ligacao', 'whatsapp', 'email'] }).notNull(),
  result: text('result', {
    enum: ['sem_resposta', 'nao_atendeu', 'reagendou', 'recusou', 'avancou'],
  }).notNull(),
  nextActionAt: text('next_action_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Relations
export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users),
  regions: many(regions),
  ddds: many(ddds),
  campaigns: many(campaigns),
  leads: many(leads),
  leadHistory: many(leadHistory),
  messageTemplates: many(messageTemplates),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  leads: many(leads),
  leadNotes: many(leadNotes),
  leadAttachments: many(leadAttachments),
  regionVendors: many(regionVendors),
  notifications: many(notifications),
  contactAttempts: many(leadContactAttempts),
}))

export const regionsRelations = relations(regions, ({ many, one }) => ({
  company: one(companies, { fields: [regions.companyId], references: [companies.id] }),
  ddds: many(ddds),
  regionVendors: many(regionVendors),
  leads: many(leads),
  roundRobinState: one(roundRobinState, {
    fields: [regions.id],
    references: [roundRobinState.regionId],
  }),
}))

export const dddRelations = relations(ddds, ({ one }) => ({
  region: one(regions, {
    fields: [ddds.regionId],
    references: [regions.id],
  }),
  company: one(companies, { fields: [ddds.companyId], references: [companies.id] }),
}))

export const regionVendorsRelations = relations(regionVendors, ({ one }) => ({
  region: one(regions, {
    fields: [regionVendors.regionId],
    references: [regions.id],
  }),
  vendor: one(users, {
    fields: [regionVendors.vendorId],
    references: [users.id],
  }),
}))

export const roundRobinRelations = relations(roundRobinState, ({ one }) => ({
  region: one(regions, {
    fields: [roundRobinState.regionId],
    references: [regions.id],
  }),
}))

export const leadsRelations = relations(leads, ({ one, many }) => ({
  company: one(companies, { fields: [leads.companyId], references: [companies.id] }),
  vendor: one(users, {
    fields: [leads.vendorId],
    references: [users.id],
  }),
  region: one(regions, {
    fields: [leads.regionId],
    references: [regions.id],
  }),
  campaign: one(campaigns, {
    fields: [leads.campaignId],
    references: [campaigns.id],
  }),
  notes: many(leadNotes),
  attachments: many(leadAttachments),
  history: many(leadHistory),
  notifications: many(notifications),
  contactAttempts: many(leadContactAttempts),
}))

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  company: one(companies, { fields: [campaigns.companyId], references: [companies.id] }),
  leads: many(leads),
}))

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadNotes.userId], references: [users.id] }),
}))

export const leadAttachmentsRelations = relations(leadAttachments, ({ one }) => ({
  lead: one(leads, { fields: [leadAttachments.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadAttachments.userId], references: [users.id] }),
}))

export const leadHistoryRelations = relations(leadHistory, ({ one }) => ({
  lead: one(leads, { fields: [leadHistory.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadHistory.userId], references: [users.id], relationName: 'leadHistoryUser' }),
  fromVendor: one(users, { fields: [leadHistory.fromVendorId], references: [users.id], relationName: 'leadHistoryFromVendor' }),
  toVendor: one(users, { fields: [leadHistory.toVendorId], references: [users.id], relationName: 'leadHistoryToVendor' }),
  company: one(companies, { fields: [leadHistory.companyId], references: [companies.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  vendor: one(users, { fields: [notifications.vendorId], references: [users.id] }),
  lead: one(leads, { fields: [notifications.leadId], references: [leads.id] }),
}))

export const leadContactAttemptsRelations = relations(leadContactAttempts, ({ one }) => ({
  lead: one(leads, { fields: [leadContactAttempts.leadId], references: [leads.id] }),
  user: one(users, { fields: [leadContactAttempts.userId], references: [users.id] }),
}))

export const messageTemplatesRelations = relations(messageTemplates, ({ one }) => ({
  company: one(companies, { fields: [messageTemplates.companyId], references: [companies.id] }),
}))
