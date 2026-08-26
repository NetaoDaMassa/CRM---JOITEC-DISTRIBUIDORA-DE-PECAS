CREATE TABLE `proposta_alteracoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposta_id` integer NOT NULL,
	`solicitado_por` integer,
	`conteudo` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proposta_id`) REFERENCES `propostas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`solicitado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `proposta_arquivos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposta_id` integer NOT NULL,
	`file_category` text,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proposta_id`) REFERENCES `propostas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `proposta_feedbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposta_id` integer NOT NULL,
	`vendedor_id` integer,
	`conteudo` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proposta_id`) REFERENCES `propostas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `proposta_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposta_id` integer NOT NULL,
	`user_id` integer,
	`etapa_anterior` text,
	`etapa_nova` text NOT NULL,
	`nota` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proposta_id`) REFERENCES `propostas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `propostas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`cliente_nome` text NOT NULL,
	`cliente_whatsapp` text,
	`produtos_descricao` text,
	`comissao` text,
	`revenda` text,
	`forma_pagamento` text,
	`observacoes` text,
	`prioridade` text DEFAULT 'normal' NOT NULL,
	`motivo_urgencia` text,
	`motivo_perda` text,
	`data_retorno` text,
	`ultima_alteracao_solicitada_em` text,
	`stage` text DEFAULT 'proposta' NOT NULL,
	`convertido_para_ordem_id` integer,
	`legacy_proposta_id` integer,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`convertido_para_ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `propostas_legacy_proposta_id_unique` ON `propostas` (`legacy_proposta_id`);--> statement-breakpoint
CREATE INDEX `propostas_empresa_stage_idx` ON `propostas` (`empresa_id`,`stage`);--> statement-breakpoint
CREATE INDEX `propostas_vendedor_idx` ON `propostas` (`vendedor_id`);