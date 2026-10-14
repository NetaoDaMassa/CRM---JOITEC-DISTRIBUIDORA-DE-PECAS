CREATE TABLE `solicitacao_credito_respostas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`solicitacao_id` integer NOT NULL,
	`status` text NOT NULL,
	`valor_liberado` real,
	`quem_liberou` text NOT NULL,
	`motivo_resposta` text NOT NULL,
	`serasa_observacao` text,
	`decidido_por` integer,
	`decidido_em` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`solicitacao_id`) REFERENCES `solicitacoes_credito`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
