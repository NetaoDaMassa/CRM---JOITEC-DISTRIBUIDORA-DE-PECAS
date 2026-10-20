-- Cotações/orçamentos do SAP (só consulta, por lote) — pedido do João,
-- 2026-10-20. Lotes reaproveitam sap_importacoes, agora com `tipo`.
ALTER TABLE `sap_importacoes` ADD `tipo` text DEFAULT 'vendas' NOT NULL;
--> statement-breakpoint
CREATE TABLE `sap_cotacoes_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`importacao_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`codigo_cliente` text,
	`nome_cliente` text,
	`data_cotacao` text NOT NULL,
	`numero_cotacao` text NOT NULL,
	`valor` real NOT NULL,
	`status` text NOT NULL,
	`casado_por` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importacao_id`) REFERENCES `sap_importacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_historico_cliente` ON `sap_cotacoes_historico` (`cliente_id`,`data_cotacao`);
--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_historico_importacao` ON `sap_cotacoes_historico` (`importacao_id`);
--> statement-breakpoint
CREATE INDEX `idx_sap_cotacoes_historico_numero` ON `sap_cotacoes_historico` (`empresa_id`,`numero_cotacao`);
