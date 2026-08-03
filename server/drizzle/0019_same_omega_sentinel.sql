CREATE TABLE `cliente_vinculos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`cliente_vinculado_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_vinculado_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
