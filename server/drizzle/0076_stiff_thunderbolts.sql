CREATE TABLE `banco_clientes_liberacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`origem_banco` text NOT NULL,
	`vendedor_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `banco_clientes_liberacoes_empresa_id_origem_banco_vendedor_id_unique` ON `banco_clientes_liberacoes` (`empresa_id`,`origem_banco`,`vendedor_id`);