PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inadimplencia_empresas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`valor_total` real DEFAULT 0 NOT NULL,
	`quantidade_clientes` integer DEFAULT 0 NOT NULL,
	`atualizado_por` integer,
	`atualizado_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`atualizado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Sem INSERT...SELECT aqui de propósito: tabela nova (migração 0031),
-- sempre vazia até este ponto — não existe empresa_id -> card_key pra
-- migrar de verdade.
DROP TABLE `inadimplencia_empresas`;--> statement-breakpoint
ALTER TABLE `__new_inadimplencia_empresas` RENAME TO `inadimplencia_empresas`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `inadimplencia_empresas_card_key_unique` ON `inadimplencia_empresas` (`card_key`);