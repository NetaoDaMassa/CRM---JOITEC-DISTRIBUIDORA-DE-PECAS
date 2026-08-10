CREATE TABLE `goto_ligacoes_processadas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_space_id` text NOT NULL,
	`direcao` text,
	`numero_externo` text,
	`duracao_segundos` integer,
	`cliente_id` integer,
	`registro_contato_id` integer,
	`status` text DEFAULT 'processando' NOT NULL,
	`motivo_nao_registrado` text,
	`payload_bruto` text,
	`criado_em` text DEFAULT (datetime('now')) NOT NULL,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`registro_contato_id`) REFERENCES `registro_contato`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goto_ligacoes_processadas_conversation_space_id_unique` ON `goto_ligacoes_processadas` (`conversation_space_id`);--> statement-breakpoint
CREATE TABLE `goto_log_integracao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operacao` text NOT NULL,
	`metodo` text,
	`url` text,
	`status_code` integer,
	`request_body` text,
	`response_body` text,
	`sucesso` integer NOT NULL,
	`erro` text,
	`criado_em` text DEFAULT (datetime('now')) NOT NULL
);
