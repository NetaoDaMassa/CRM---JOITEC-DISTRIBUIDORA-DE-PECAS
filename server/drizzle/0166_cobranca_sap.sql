CREATE TABLE `cobranca_titulos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chave` text NOT NULL,
	`empresa_slug` text,
	`codigo_cliente` text NOT NULL,
	`nome_cliente` text,
	`tipo` text NOT NULL,
	`documento` text NOT NULL,
	`parcela` text,
	`emissao` text,
	`vencimento` text NOT NULL,
	`valor` real NOT NULL,
	`vendedor_sap` text,
	`status` text DEFAULT 'cobrar' NOT NULL,
	`cartorio_em` text,
	`cartorio_aviso_em` text,
	`retorno_em` text,
	`retorno_verificado_em` text,
	`retorno_resultado` text,
	`rc_em` text,
	`pago_em` text,
	`pago_auto` integer DEFAULT 0 NOT NULL,
	`observacao` text,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cobranca_titulos_chave` ON `cobranca_titulos` (`chave`);
--> statement-breakpoint
CREATE INDEX `idx_cobranca_titulos_status` ON `cobranca_titulos` (`status`,`codigo_cliente`);
--> statement-breakpoint
CREATE TABLE `cobranca_contatos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`titulo_id` integer NOT NULL REFERENCES `cobranca_titulos`(`id`) ON DELETE cascade,
	`canal` text NOT NULL,
	`tipo` text DEFAULT 'cobranca' NOT NULL,
	`dia_regua` integer,
	`observacao` text,
	`user_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cobranca_contatos_titulo` ON `cobranca_contatos` (`titulo_id`);
