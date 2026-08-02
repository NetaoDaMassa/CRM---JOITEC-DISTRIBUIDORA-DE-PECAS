CREATE TABLE `carteira_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`razao_social` text NOT NULL,
	`cnpj` text,
	`codigo` text NOT NULL,
	`codigo_antigo` text,
	`inscricao_estadual` text,
	`regiao` text NOT NULL,
	`estado` text,
	`cidade` text,
	`telefone_whatsapp` text,
	`email` text,
	`vendedor_atual_id` integer,
	`data_ultima_compra` text,
	`ticket_medio_historico` real,
	`cadastrado_por` integer,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vendedor_atual_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cadastrado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_cnpj_unique` ON `clientes` (`cnpj`);--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_codigo_unique` ON `clientes` (`codigo`);--> statement-breakpoint
CREATE TABLE `funil_mensal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`mes_referencia` text NOT NULL,
	`etapa` text DEFAULT 'novo' NOT NULL,
	`data_entrada_etapa` text DEFAULT (datetime('now')) NOT NULL,
	`qtd_tentativas_contato` integer DEFAULT 0 NOT NULL,
	`data_ultimo_contato` text,
	`valor_orcado` real,
	`valor_fechado` real,
	`condicao_pagamento` text,
	`pdf_pedido_path` text,
	`motivo_perda_categoria` text,
	`motivo_perda_opcao` text,
	`motivo_perda_item` text,
	`motivo_perda_observacao` text,
	`carregado_mes_anterior` integer DEFAULT false NOT NULL,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funil_mensal_cliente_id_mes_referencia_unique` ON `funil_mensal` (`cliente_id`,`mes_referencia`);--> statement-breakpoint
CREATE TABLE `itens_pedido` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funil_mensal_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`descricao` text NOT NULL,
	`quantidade` real,
	`valor_unitario` real,
	`valor_total` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`funil_mensal_id`) REFERENCES `funil_mensal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `log_auditoria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tabela` text NOT NULL,
	`registro_id` integer NOT NULL,
	`acao` text NOT NULL,
	`campo` text,
	`valor_anterior` text,
	`valor_novo` text,
	`alterado_por` integer,
	`alterado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`alterado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`whatsapp_text` text NOT NULL,
	`email_subject` text NOT NULL,
	`email_body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metas_mensais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendedor_id` integer NOT NULL,
	`mes_referencia` text NOT NULL,
	`meta_faturamento` real,
	`meta_pct_carteira_ativada` real,
	`meta_ligacoes_dia` integer DEFAULT 25 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metas_mensais_vendedor_id_mes_referencia_unique` ON `metas_mensais` (`vendedor_id`,`mes_referencia`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendedor_id` integer NOT NULL,
	`cliente_id` integer,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `registro_contato` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funil_mensal_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`resultado` text,
	`observacao` text NOT NULL,
	`data_hora` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`funil_mensal_id`) REFERENCES `funil_mensal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'vendor' NOT NULL,
	`regiao` text,
	`foto_url` text,
	`tema_preferido` text DEFAULT 'claro' NOT NULL,
	`senha_trocar_no_login` integer DEFAULT false NOT NULL,
	`tentativas_login_falhas` integer DEFAULT 0 NOT NULL,
	`bloqueado_ate` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);