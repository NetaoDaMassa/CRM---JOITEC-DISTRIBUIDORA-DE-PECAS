PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_solicitacoes_credito` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_id` integer,
	`cnpj_avulso` text,
	`nome_avulso` text,
	`vendedor_solicitante_id` integer NOT NULL,
	`status` text DEFAULT 'pendente' NOT NULL,
	`tipo` text DEFAULT 'consulta' NOT NULL,
	`tipo_consulta` text,
	`valor_solicitado` real,
	`informacoes_fiscais` text,
	`observacoes` text,
	`decidido_por` integer,
	`decidido_em` text,
	`valor_liberado` real,
	`quem_liberou` text,
	`motivo_resposta` text,
	`serasa_observacao` text,
	`serasa_limpo` integer,
	`serasa_consulta_em` text,
	`valor_pedido` real,
	`cotacao_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_solicitante_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_solicitacoes_credito` (`id`, `empresa_id`, `cliente_id`, `vendedor_solicitante_id`, `status`, `tipo`, `tipo_consulta`, `valor_solicitado`, `informacoes_fiscais`, `observacoes`, `decidido_por`, `decidido_em`, `valor_liberado`, `quem_liberou`, `motivo_resposta`, `serasa_observacao`, `serasa_limpo`, `serasa_consulta_em`, `valor_pedido`, `cotacao_id`, `created_at`, `updated_at`) SELECT `id`, `empresa_id`, `cliente_id`, `vendedor_solicitante_id`, `status`, `tipo`, `tipo_consulta`, `valor_solicitado`, `informacoes_fiscais`, `observacoes`, `decidido_por`, `decidido_em`, `valor_liberado`, `quem_liberou`, `motivo_resposta`, `serasa_observacao`, `serasa_limpo`, `serasa_consulta_em`, `valor_pedido`, `cotacao_id`, `created_at`, `updated_at` FROM `solicitacoes_credito`;--> statement-breakpoint
DROP TABLE `solicitacoes_credito`;--> statement-breakpoint
ALTER TABLE `__new_solicitacoes_credito` RENAME TO `solicitacoes_credito`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `solicitacoes_credito_cliente_idx` ON `solicitacoes_credito` (`cliente_id`);--> statement-breakpoint
CREATE INDEX `solicitacoes_credito_status_idx` ON `solicitacoes_credito` (`status`);--> statement-breakpoint
CREATE INDEX `solicitacoes_credito_cnpj_avulso_idx` ON `solicitacoes_credito` (`cnpj_avulso`);
