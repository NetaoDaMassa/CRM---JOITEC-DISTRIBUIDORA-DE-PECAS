CREATE TABLE `links_pagamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`) ON DELETE cascade,
	`cliente_id` integer REFERENCES `clientes`(`id`) ON DELETE set null,
	`cliente_nome` text NOT NULL,
	`documento` text,
	`vendedor_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`valor` real NOT NULL,
	`parcelas` integer DEFAULT 1 NOT NULL,
	`numero_pedido` text,
	`descricao` text,
	`email_cliente` text,
	`telefone_cliente` text,
	`observacao_vendedor` text,
	`status` text DEFAULT 'solicitado' NOT NULL,
	`link` text,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`criado_em` text,
	`observacao_financeiro` text,
	`pago_em` text,
	`cancelado_em` text,
	`motivo_cancelamento` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_links_pagamento_status` ON `links_pagamento` (`status`);
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `pagamento_status` text;
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `pagamento_alterado_em` text;
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `pagamento_alterado_por` integer;
--> statement-breakpoint
CREATE TABLE `contabilidade_pastas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`) ON DELETE cascade,
	`nome` text NOT NULL,
	`pasta_pai_id` integer REFERENCES `contabilidade_pastas`(`id`) ON DELETE cascade,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contabilidade_arquivos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`) ON DELETE cascade,
	`pasta_id` integer REFERENCES `contabilidade_pastas`(`id`) ON DELETE cascade,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`excluido_em` text,
	`excluido_por` integer REFERENCES `users`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_contabilidade_arquivos_pasta` ON `contabilidade_arquivos` (`empresa_id`,`pasta_id`);
