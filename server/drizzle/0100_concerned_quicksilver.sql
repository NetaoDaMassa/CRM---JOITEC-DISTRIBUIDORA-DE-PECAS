CREATE TABLE `solicitacao_credito_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`solicitacao_id` integer NOT NULL,
	`origem` text NOT NULL,
	`url_arquivo` text NOT NULL,
	`nome_arquivo` text NOT NULL,
	`tipo_arquivo` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`solicitacao_id`) REFERENCES `solicitacoes_credito`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `solicitacoes_credito` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_solicitante_id` integer NOT NULL,
	`status` text DEFAULT 'pendente' NOT NULL,
	`valor_solicitado` real,
	`informacoes_fiscais` text,
	`observacoes` text,
	`decidido_por` integer,
	`decidido_em` text,
	`valor_liberado` real,
	`quem_liberou` text,
	`motivo_resposta` text,
	`serasa_observacao` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_solicitante_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `solicitacoes_credito_cliente_idx` ON `solicitacoes_credito` (`cliente_id`);--> statement-breakpoint
CREATE INDEX `solicitacoes_credito_status_idx` ON `solicitacoes_credito` (`status`);