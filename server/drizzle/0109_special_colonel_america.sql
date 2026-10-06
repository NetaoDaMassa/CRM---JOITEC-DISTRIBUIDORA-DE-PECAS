CREATE TABLE `devolucao_ecommerce` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`criado_por` integer,
	`data` text NOT NULL,
	`marketplace` text NOT NULL,
	`loja` text NOT NULL,
	`pedido` text NOT NULL,
	`nf_entrada` text,
	`nf_devolucao` text,
	`valor_venda` real DEFAULT 0 NOT NULL,
	`motivo` text NOT NULL,
	`status_recurso` text DEFAULT 'sem_recurso' NOT NULL,
	`valor_recurso` real,
	`custo_devolucao` real,
	`erro_expedicao` integer DEFAULT false NOT NULL,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `devolucao_ecommerce_empresa_data_idx` ON `devolucao_ecommerce` (`empresa_id`,`data`);