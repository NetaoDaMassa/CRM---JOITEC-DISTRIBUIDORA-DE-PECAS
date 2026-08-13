CREATE TABLE `inadimplencia_empresas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`valor_total` real DEFAULT 0 NOT NULL,
	`quantidade_clientes` integer DEFAULT 0 NOT NULL,
	`atualizado_por` integer,
	`atualizado_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`atualizado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inadimplencia_empresas_empresa_id_unique` ON `inadimplencia_empresas` (`empresa_id`);