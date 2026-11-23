CREATE TABLE `ligacao_avaliacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ligacao_id` integer NOT NULL REFERENCES `pabx_ligacoes_processadas`(`id`) ON DELETE cascade,
	`status` text NOT NULL DEFAULT 'processando',
	`transcricao` text,
	`fonte_transcricao` text,
	`nota` integer,
	`resumo` text,
	`pontos_fortes` text,
	`pontos_melhorar` text,
	`proximo_passo` text,
	`modelo` text,
	`erro` text,
	`criado_por_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`criado_em` text NOT NULL DEFAULT (datetime('now')),
	`atualizado_em` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ligacao_avaliacoes_ligacao` ON `ligacao_avaliacoes` (`ligacao_id`);
