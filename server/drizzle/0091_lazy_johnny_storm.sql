CREATE TABLE `email_marketing_eventos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`origem` text DEFAULT 'brevo' NOT NULL,
	`tipo` text NOT NULL,
	`email` text NOT NULL,
	`nome_campanha` text,
	`assunto` text,
	`url` text,
	`motivo` text,
	`conteudo` text,
	`lead_id` integer,
	`lead_criado_automaticamente` integer DEFAULT false NOT NULL,
	`payload_bruto` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`ddd` integer,
	`email` text,
	`company` text,
	`city` text,
	`segment` text DEFAULT 'outros',
	`status` text DEFAULT 'novo' NOT NULL,
	`vendor_id` integer,
	`region_id` integer,
	`campaign_id` integer,
	`source` text,
	`observations` text,
	`next_contact_at` text,
	`follow_up_count` integer DEFAULT 0 NOT NULL,
	`requires_attachment` integer DEFAULT false NOT NULL,
	`status_changed_at` text,
	`idle_alert_sent_at` text,
	`auto_reassigned_at` text,
	`last_contact_at` text,
	`attempt_count` integer,
	`sla_status` text,
	`abordagem_4h_alert_sent_at` text,
	`last_contact_stale_alert_sent_at` text,
	`cod_sap` text,
	`order_value` real,
	`final_order_value` real,
	`payment_method` text,
	`loss_reason` text,
	`disqualify_reason` text,
	`final_consumer_reason` text,
	`negotiation_tag` text,
	`tag_ppr_verde` integer DEFAULT false NOT NULL,
	`tag_outras_linhas` integer DEFAULT false NOT NULL,
	`convertido_para_cliente_id` integer,
	`convertido_para_proposta_id` integer,
	`origem_lead_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`assigned_at` text,
	`deleted_at` text,
	`deleted_by` integer,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`region_id`) REFERENCES `lead_regions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `lead_campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`convertido_para_cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`convertido_para_proposta_id`) REFERENCES `propostas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_leads`("id", "empresa_id", "name", "phone", "ddd", "email", "company", "city", "segment", "status", "vendor_id", "region_id", "campaign_id", "source", "observations", "next_contact_at", "follow_up_count", "requires_attachment", "status_changed_at", "idle_alert_sent_at", "auto_reassigned_at", "last_contact_at", "attempt_count", "sla_status", "abordagem_4h_alert_sent_at", "last_contact_stale_alert_sent_at", "cod_sap", "order_value", "final_order_value", "payment_method", "loss_reason", "disqualify_reason", "final_consumer_reason", "negotiation_tag", "tag_ppr_verde", "tag_outras_linhas", "convertido_para_cliente_id", "convertido_para_proposta_id", "origem_lead_id", "created_at", "updated_at", "assigned_at", "deleted_at", "deleted_by") SELECT "id", "empresa_id", "name", "phone", "ddd", "email", "company", "city", "segment", "status", "vendor_id", "region_id", "campaign_id", "source", "observations", "next_contact_at", "follow_up_count", "requires_attachment", "status_changed_at", "idle_alert_sent_at", "auto_reassigned_at", "last_contact_at", "attempt_count", "sla_status", "abordagem_4h_alert_sent_at", "last_contact_stale_alert_sent_at", "cod_sap", "order_value", "final_order_value", "payment_method", "loss_reason", "disqualify_reason", "final_consumer_reason", "negotiation_tag", "tag_ppr_verde", "tag_outras_linhas", "convertido_para_cliente_id", "convertido_para_proposta_id", "origem_lead_id", "created_at", "updated_at", "assigned_at", "deleted_at", "deleted_by" FROM `leads`;--> statement-breakpoint
DROP TABLE `leads`;--> statement-breakpoint
ALTER TABLE `__new_leads` RENAME TO `leads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_empresa_id_origem_lead_id_unique` ON `leads` (`empresa_id`,`origem_lead_id`);--> statement-breakpoint
ALTER TABLE `empresas` ADD `brevo_webhook_token` text;