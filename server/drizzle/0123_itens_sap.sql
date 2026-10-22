CREATE TABLE `sap_itens_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`importacao_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`codigo_cliente` text,
	`numero_nota` text NOT NULL,
	`data_nota` text NOT NULL,
	`codigo_item` text,
	`descricao` text NOT NULL,
	`quantidade` real,
	`valor_unitario` real,
	`valor_total` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importacao_id`) REFERENCES `sap_importacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sap_itens_historico_cliente` ON `sap_itens_historico` (`cliente_id`,`data_nota`);--> statement-breakpoint
CREATE INDEX `idx_sap_itens_historico_empresa_data` ON `sap_itens_historico` (`empresa_id`,`data_nota`);--> statement-breakpoint
CREATE INDEX `idx_sap_itens_historico_importacao` ON `sap_itens_historico` (`importacao_id`);--> statement-breakpoint
CREATE INDEX `idx_sap_itens_historico_nota` ON `sap_itens_historico` (`empresa_id`,`numero_nota`);