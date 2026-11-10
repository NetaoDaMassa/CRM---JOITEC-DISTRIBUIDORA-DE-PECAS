CREATE TABLE `cotacoes_crm` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`status` text DEFAULT 'rascunho' NOT NULL,
	`lista_preco` integer,
	`prazo_codigo` integer,
	`observacao` text,
	`total` real DEFAULT 0 NOT NULL,
	`maior_desconto_pct` real DEFAULT 0 NOT NULL,
	`aprovado_por_id` integer,
	`aprovado_em` text,
	`reprovacao_motivo` text,
	`enviada_cliente_em` text,
	`valida_ate` text,
	`motivo_perda` text,
	`motivo_perda_obs` text,
	`encerrada_em` text,
	`sap_doc_entry` integer,
	`sap_doc_num` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`aprovado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_cotacoes_crm_empresa` ON `cotacoes_crm` (`empresa_id`,`vendedor_id`);--> statement-breakpoint
CREATE INDEX `idx_cotacoes_crm_cliente` ON `cotacoes_crm` (`cliente_id`);--> statement-breakpoint
CREATE TABLE `cotacoes_crm_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cotacao_id` integer NOT NULL,
	`item_codigo` text NOT NULL,
	`nome` text NOT NULL,
	`quantidade` real NOT NULL,
	`preco_tabela` real NOT NULL,
	`desconto_pct` real DEFAULT 0 NOT NULL,
	`preco_unitario` real NOT NULL,
	`aceito` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`cotacao_id`) REFERENCES `cotacoes_crm`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_cotacoes_crm_itens_cotacao` ON `cotacoes_crm_itens` (`cotacao_id`);--> statement-breakpoint
CREATE TABLE `sap_catalogo_itens` (
	`item_codigo` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`codigo_antigo` text,
	`grupo` text,
	`unidade` text,
	`peso_kg` real,
	`ativo` integer DEFAULT true NOT NULL,
	`atualizado_em` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `sap_catalogo_precos` (
	`item_codigo` text NOT NULL,
	`lista` integer NOT NULL,
	`preco` real NOT NULL,
	PRIMARY KEY(`item_codigo`, `lista`)
);--> statement-breakpoint
CREATE TABLE `sap_clientes_comercial` (
	`card_code` text PRIMARY KEY NOT NULL,
	`lista_preco` integer,
	`prazo_codigo` integer,
	`bloqueado` integer DEFAULT false NOT NULL,
	`atualizado_em` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `sap_listas_preco` (
	`numero` integer PRIMARY KEY NOT NULL,
	`nome` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `sap_prazos_pagamento` (
	`codigo` integer PRIMARY KEY NOT NULL,
	`nome` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `cotacoes_crm_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cotacao_id` integer NOT NULL,
	`user_id` integer,
	`acao` text NOT NULL,
	`detalhe` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cotacao_id`) REFERENCES `cotacoes_crm`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_cotacoes_crm_historico_cotacao` ON `cotacoes_crm_historico` (`cotacao_id`);
