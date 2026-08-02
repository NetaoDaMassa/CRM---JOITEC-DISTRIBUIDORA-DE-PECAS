CREATE TABLE `compromissos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendedor_id` integer NOT NULL,
	`cliente_id` integer,
	`tipo` text DEFAULT 'outro' NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text,
	`data_hora` text NOT NULL,
	`concluido` integer DEFAULT false NOT NULL,
	`notificado` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
