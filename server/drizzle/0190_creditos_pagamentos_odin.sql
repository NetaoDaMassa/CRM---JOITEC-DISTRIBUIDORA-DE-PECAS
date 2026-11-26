-- Créditos Odin + Pagamentos Odin (Financeiro), João 2026-11-26.
ALTER TABLE `ordem_detalhes` ADD `comissao_modalidade` text;--> statement-breakpoint
ALTER TABLE `ordem_detalhes` ADD `comissao_valor` real;--> statement-breakpoint
CREATE TABLE `revenda_creditos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`revenda_id` integer NOT NULL REFERENCES `revendas`(`id`),
	`cliente_id` integer REFERENCES `clientes`(`id`) ON DELETE set null,
	`cliente_nome` text,
	`equipamento` text,
	`numero_serie` text,
	`servico_executado` text NOT NULL,
	`data_atendimento` text,
	`garantia_id` integer REFERENCES `garantias`(`id`) ON DELETE set null,
	`valor_solicitado` real NOT NULL,
	`valor_aprovado` real,
	`stage` text DEFAULT 'analise' NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`cancel_motivo` text,
	`analise_observacao` text,
	`decisao_observacao` text,
	`decidido_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`decidido_em` text,
	`responsavel_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `revenda_creditos_revenda_idx` ON `revenda_creditos` (`revenda_id`);--> statement-breakpoint
CREATE TABLE `revenda_credito_movimentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`revenda_id` integer NOT NULL REFERENCES `revendas`(`id`),
	`tipo` text NOT NULL,
	`valor` real NOT NULL,
	`data` text NOT NULL,
	`numero_pedido` text,
	`descricao` text,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`deleted_at` text,
	`deleted_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `revenda_credito_movimentos_revenda_idx` ON `revenda_credito_movimentos` (`revenda_id`);--> statement-breakpoint
CREATE TABLE `revenda_pagamentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`tipo` text NOT NULL,
	`origem` text DEFAULT 'manual' NOT NULL,
	`ordem_id` integer REFERENCES `ordens`(`id`) ON DELETE set null,
	`revenda_id` integer REFERENCES `revendas`(`id`) ON DELETE set null,
	`revenda_nome` text NOT NULL,
	`cliente_id` integer REFERENCES `clientes`(`id`) ON DELETE set null,
	`cliente_nome` text,
	`numero_pedido` text,
	`equipamento` text,
	`descricao` text,
	`valor_venda` real,
	`comissao_modalidade` text,
	`comissao_percentual` real,
	`valor` real NOT NULL,
	`stage` text DEFAULT 'comissao_registrada' NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`cancel_motivo` text,
	`data_prevista_pagamento` text,
	`data_pagamento` text,
	`nf_numero` text,
	`observacoes` text,
	`responsavel_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `revenda_pagamentos_ordem_id_unique` ON `revenda_pagamentos` (`ordem_id`);--> statement-breakpoint
CREATE INDEX `revenda_pagamentos_stage_idx` ON `revenda_pagamentos` (`status`,`stage`);--> statement-breakpoint
CREATE TABLE `revenda_financeiro_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`ref_id` integer NOT NULL,
	`revenda_id` integer,
	`user_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`descricao` text NOT NULL,
	`stage` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `revenda_fin_hist_ref_idx` ON `revenda_financeiro_historico` (`tipo`,`ref_id`);--> statement-breakpoint
CREATE TABLE `revenda_financeiro_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`ref_id` integer NOT NULL,
	`categoria` text DEFAULT 'outro' NOT NULL,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `revenda_fin_anexos_ref_idx` ON `revenda_financeiro_anexos` (`tipo`,`ref_id`);
