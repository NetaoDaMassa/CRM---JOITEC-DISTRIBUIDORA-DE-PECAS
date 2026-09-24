CREATE TABLE `liberacoes_credito` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`vendedor_id` integer,
	`quem_liberou` text NOT NULL,
	`motivo` text NOT NULL,
	`url_arquivo` text,
	`nome_arquivo` text,
	`tipo_arquivo` text,
	`criado_por` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `liberacoes_credito_cliente_idx` ON `liberacoes_credito` (`cliente_id`);--> statement-breakpoint
CREATE INDEX `liberacoes_credito_created_at_idx` ON `liberacoes_credito` (`created_at`);