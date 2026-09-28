CREATE TABLE `demonstracao_item_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`texto` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `demonstracao_itens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `demonstracao_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`demonstracao_id` integer NOT NULL,
	`produto` text NOT NULL,
	`numero_serie` text,
	`status` text DEFAULT 'em_demonstracao' NOT NULL,
	`retorno_previsto_em` text,
	`retorno_efetivo_em` text,
	`numero_nota_retorno` text,
	`data_venda` text,
	`numero_nota_venda` text,
	`cliente_venda` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`demonstracao_id`) REFERENCES `demonstracoes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `demonstracao_itens_demonstracao_idx` ON `demonstracao_itens` (`demonstracao_id`);--> statement-breakpoint
CREATE INDEX `demonstracao_itens_status_idx` ON `demonstracao_itens` (`status`);--> statement-breakpoint
CREATE TABLE `demonstracoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_nome` text NOT NULL,
	`cliente_cidade` text,
	`cliente_estado` text,
	`vendedor_id` integer,
	`data_saida` text NOT NULL,
	`numero_nota_saida` text,
	`retorno_previsto_em` text,
	`observacao` text,
	`criado_por_user_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`criado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
