PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_devolucao_materiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`codigo_item` text,
	`descricao_item` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	`numero_serie` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_devolucao_materiais`("id", "chamado_id", "codigo_item", "descricao_item", "quantidade", "numero_serie", "created_at") SELECT "id", "chamado_id", "codigo_item", "descricao_item", "quantidade", "numero_serie", "created_at" FROM `devolucao_materiais`;--> statement-breakpoint
DROP TABLE `devolucao_materiais`;--> statement-breakpoint
ALTER TABLE `__new_devolucao_materiais` RENAME TO `devolucao_materiais`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_devolucao_mecanica_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`codigo_item` text,
	`descricao_item` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'enviado' NOT NULL,
	`enviado_em` text,
	`retornado_em` text,
	`testado_em` text,
	`resolvido_em` text,
	`atualizado_por_user_id` integer,
	`observacao` text,
	`descricao_manutencao` text,
	`condicao_retorno` text,
	`motivo_descarte` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`atualizado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_devolucao_mecanica_itens`("id", "chamado_id", "empresa_id", "codigo_item", "descricao_item", "quantidade", "status", "enviado_em", "retornado_em", "testado_em", "resolvido_em", "atualizado_por_user_id", "observacao", "descricao_manutencao", "condicao_retorno", "motivo_descarte", "created_at", "updated_at") SELECT "id", "chamado_id", "empresa_id", "codigo_item", "descricao_item", "quantidade", "status", "enviado_em", "retornado_em", "testado_em", "resolvido_em", "atualizado_por_user_id", "observacao", "descricao_manutencao", "condicao_retorno", "motivo_descarte", "created_at", "updated_at" FROM `devolucao_mecanica_itens`;--> statement-breakpoint
DROP TABLE `devolucao_mecanica_itens`;--> statement-breakpoint
ALTER TABLE `__new_devolucao_mecanica_itens` RENAME TO `devolucao_mecanica_itens`;