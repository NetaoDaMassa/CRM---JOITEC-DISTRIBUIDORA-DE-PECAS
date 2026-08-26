CREATE TABLE `boleto_pedidos_alteracao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`descricao` text NOT NULL,
	`status` text DEFAULT 'lancado' NOT NULL,
	`criado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `cobrancas_registro` ADD `valor` real;--> statement-breakpoint
ALTER TABLE `cobrancas_registro` ADD `data_vencimento` text;--> statement-breakpoint
ALTER TABLE `cobrancas_registro` ADD `status` text DEFAULT 'pendente' NOT NULL;