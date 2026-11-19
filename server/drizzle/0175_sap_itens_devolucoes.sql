CREATE TABLE `sap_itens_devolucoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`cliente_id` integer NOT NULL REFERENCES `clientes`(`id`) ON DELETE cascade,
	`codigo_cliente` text,
	`doc_entry` integer NOT NULL,
	`numero_doc` text NOT NULL,
	`data` text NOT NULL,
	`codigo_item` text NOT NULL,
	`descricao` text NOT NULL,
	`quantidade` real NOT NULL,
	`valor` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sap_itens_devolucoes_empresa_data` ON `sap_itens_devolucoes` (`empresa_id`,`data`);
--> statement-breakpoint
CREATE INDEX `idx_sap_itens_devolucoes_doc` ON `sap_itens_devolucoes` (`doc_entry`);
