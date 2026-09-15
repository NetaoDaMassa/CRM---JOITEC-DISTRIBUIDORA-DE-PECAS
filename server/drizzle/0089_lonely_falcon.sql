CREATE TABLE `cartao_gasto_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gasto_id` integer NOT NULL,
	`url_arquivo` text NOT NULL,
	`nome_arquivo` text NOT NULL,
	`tipo_arquivo` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`gasto_id`) REFERENCES `cartao_gastos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cartao_gastos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendedor_id` integer NOT NULL,
	`data` text NOT NULL,
	`valor` real NOT NULL,
	`categoria` text,
	`descricao` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
