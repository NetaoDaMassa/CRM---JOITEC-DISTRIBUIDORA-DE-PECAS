CREATE TABLE `metas_marketing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`mes_referencia` text NOT NULL,
	`meta_taxa_conversao_pct` real,
	`meta_atendimento_rapido_horas` real,
	`meta_clientes_abertos` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metas_marketing_empresa_id_mes_referencia_unique` ON `metas_marketing` (`empresa_id`,`mes_referencia`);