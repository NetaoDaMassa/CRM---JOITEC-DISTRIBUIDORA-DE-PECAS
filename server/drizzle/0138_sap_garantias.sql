CREATE TABLE `sap_garantias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`pedido_sap_entry` integer NOT NULL,
	`numero_pedido` text NOT NULL,
	`data_pedido` text NOT NULL,
	`valor` real DEFAULT 0 NOT NULL,
	`vendedor_sap` text,
	`observacao` text,
	`nf_numero` text,
	`cancelado` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sap_garantias_pedido_unique` ON `sap_garantias` (`pedido_sap_entry`);
--> statement-breakpoint
CREATE INDEX `idx_sap_garantias_cliente` ON `sap_garantias` (`cliente_id`,`data_pedido`);
