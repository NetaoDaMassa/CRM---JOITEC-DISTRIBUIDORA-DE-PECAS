-- Histórico de vendas do SAP (só consulta, separado de `vendas`) + lotes de
-- importação que podem ser desligados/excluídos. Pedido do João, 2026-10-20.
CREATE TABLE `sap_importacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome_arquivo` text NOT NULL,
	`importado_por` integer,
	`ativo` integer DEFAULT true NOT NULL,
	`total_linhas` integer DEFAULT 0 NOT NULL,
	`importadas` integer DEFAULT 0 NOT NULL,
	`nao_encontradas` integer DEFAULT 0 NOT NULL,
	`valor_total` real DEFAULT 0 NOT NULL,
	`data_inicio` text,
	`data_fim` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sap_vendas_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`importacao_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`codigo_cliente` text,
	`nome_cliente` text,
	`cnpj` text,
	`data_pedido` text NOT NULL,
	`numero_pedido` text,
	`valor` real NOT NULL,
	`casado_por` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importacao_id`) REFERENCES `sap_importacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sap_vendas_historico_cliente` ON `sap_vendas_historico` (`cliente_id`,`data_pedido`);
--> statement-breakpoint
CREATE INDEX `idx_sap_vendas_historico_importacao` ON `sap_vendas_historico` (`importacao_id`);
