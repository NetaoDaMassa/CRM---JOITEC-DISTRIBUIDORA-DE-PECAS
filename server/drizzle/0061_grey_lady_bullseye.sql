CREATE TABLE `revendas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`nome_contato` text,
	`telefone_contato` text,
	`cidade` text,
	`estado` text,
	`observacoes` text,
	`responsavel` text,
	`criado_por` integer,
	`legacy_revenda_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revendas_legacy_revenda_id_unique` ON `revendas` (`legacy_revenda_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `revendas_empresa_id_nome_unique` ON `revendas` (`empresa_id`,`nome`);