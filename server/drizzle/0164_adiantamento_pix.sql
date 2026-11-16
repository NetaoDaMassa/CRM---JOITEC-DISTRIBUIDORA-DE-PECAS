CREATE TABLE `adiantamentos_pix` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venda_id` integer NOT NULL REFERENCES `vendas`(`id`) ON DELETE cascade,
	`comprovante_path` text,
	`comprovante_nome` text,
	`anexado_em` text,
	`anexado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`conferido_em` text,
	`conferido_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`observacao` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_adiantamentos_pix_venda` ON `adiantamentos_pix` (`venda_id`);
