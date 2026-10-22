CREATE TABLE `sap_cotacoes_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`importacao_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`codigo_cliente` text,
	`numero_cotacao` text NOT NULL,
	`data_cotacao` text NOT NULL,
	`status` text NOT NULL,
	`valor_cotacao` real,
	`linha` integer,
	`codigo_item` text,
	`descricao` text NOT NULL,
	`quantidade` real,
	`valor_unitario` real,
	`valor_total` real,
	`filial_sap` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importacao_id`) REFERENCES `sap_importacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_itens_cliente` ON `sap_cotacoes_itens` (`cliente_id`,`data_cotacao`);--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_itens_empresa_data` ON `sap_cotacoes_itens` (`empresa_id`,`data_cotacao`);--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_itens_importacao` ON `sap_cotacoes_itens` (`importacao_id`);--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_itens_numero` ON `sap_cotacoes_itens` (`empresa_id`,`numero_cotacao`);