PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_boleto_pedidos_alteracao` (
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
INSERT INTO `__new_boleto_pedidos_alteracao`("id", "cliente_id", "numero_boleto", "valor", "tipo_alteracao", "descricao", "data_troca", "status", "criado_por_id", "created_at", "updated_at") SELECT "id", "cliente_id", "numero_boleto", "valor", "tipo_alteracao", "descricao", "data_troca", "status", "criado_por_id", "created_at", "updated_at" FROM `boleto_pedidos_alteracao`;--> statement-breakpoint
DROP TABLE `boleto_pedidos_alteracao`;--> statement-breakpoint
ALTER TABLE `__new_boleto_pedidos_alteracao` RENAME TO `boleto_pedidos_alteracao`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `devolucao_chamados` ADD `cliente_id` integer REFERENCES clientes(id);