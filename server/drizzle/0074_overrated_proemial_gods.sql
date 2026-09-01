PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `boleto_pedidos_alteracao`;--> statement-breakpoint
CREATE TABLE `boleto_pedidos_alteracao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`numero_boleto` text,
	`valor` real,
	`tipo_alteracao` text NOT NULL,
	`descricao` text,
	`data_troca` text,
	`status` text DEFAULT 'lancado' NOT NULL,
	`criado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `devolucao_chamados` ADD `cliente_id` integer REFERENCES clientes(id);
