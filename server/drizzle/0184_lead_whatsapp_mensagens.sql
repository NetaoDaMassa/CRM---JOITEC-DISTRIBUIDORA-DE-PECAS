-- WhatsApp → captura de leads (Fase 1, João 2026-11-25): conversa do número
-- da empresa ligada ao lead. Só leitura (o CRM não envia nada por essa sessão).
CREATE TABLE `lead_whatsapp_mensagens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`lead_id` integer,
	`wa_message_id` text NOT NULL,
	`jid` text NOT NULL,
	`telefone` text,
	`direcao` text NOT NULL,
	`tipo` text DEFAULT 'texto' NOT NULL,
	`texto` text DEFAULT '' NOT NULL,
	`push_name` text,
	`enviada_em` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lead_wa_msg` ON `lead_whatsapp_mensagens` (`empresa_id`,`wa_message_id`);--> statement-breakpoint
CREATE INDEX `idx_lead_wa_msg_lead` ON `lead_whatsapp_mensagens` (`lead_id`,`enviada_em`);--> statement-breakpoint
CREATE INDEX `idx_lead_wa_msg_jid` ON `lead_whatsapp_mensagens` (`empresa_id`,`jid`);
