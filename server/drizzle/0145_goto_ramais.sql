CREATE TABLE `goto_ramais` (
	`ramal` text PRIMARY KEY NOT NULL,
	`nome` text,
	`user_id` integer,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `goto_ligacoes_processadas` ADD `tentativas` integer DEFAULT 0 NOT NULL;
