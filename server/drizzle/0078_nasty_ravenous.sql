CREATE TABLE `prospeccao_registros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`observacao` text NOT NULL,
	`registrado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registrado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
