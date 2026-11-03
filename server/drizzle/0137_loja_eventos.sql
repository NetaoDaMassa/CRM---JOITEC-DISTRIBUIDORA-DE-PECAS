CREATE TABLE `loja_eventos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`event_id` text NOT NULL,
	`visitor_id` integer,
	`visitor_uid` text NOT NULL,
	`session_id` text,
	`event_type` text NOT NULL,
	`ocorreu_em` text NOT NULL,
	`page_url` text,
	`page_path` text,
	`page_title` text,
	`referrer` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`produto_sku` text,
	`produto_nome` text,
	`produto_preco` real,
	`valor` real,
	`duracao_ms` integer,
	`engajado_ms` integer,
	`elemento` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`) REFERENCES `lead_tracking_visitors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loja_eventos_empresa_event_unique` ON `loja_eventos` (`empresa_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_loja_eventos_empresa_quando` ON `loja_eventos` (`empresa_id`,`ocorreu_em`);
--> statement-breakpoint
CREATE INDEX `idx_loja_eventos_empresa_sku` ON `loja_eventos` (`empresa_id`,`produto_sku`);
--> statement-breakpoint
CREATE INDEX `idx_loja_eventos_empresa_sessao` ON `loja_eventos` (`empresa_id`,`session_id`);
