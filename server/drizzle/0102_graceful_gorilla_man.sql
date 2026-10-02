CREATE TABLE `chat_conversas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo_origem` text NOT NULL,
	`id_origem` integer,
	`titulo_snapshot` text,
	`criado_por` integer NOT NULL,
	`ultima_mensagem_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_conversas_origem_idx` ON `chat_conversas` (`tipo_origem`,`id_origem`);--> statement-breakpoint
CREATE TABLE `chat_mensagens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversa_id` integer NOT NULL,
	`autor_id` integer NOT NULL,
	`tipo` text DEFAULT 'texto' NOT NULL,
	`texto` text,
	`url_arquivo` text,
	`nome_arquivo` text,
	`tipo_arquivo_mime` text,
	`duracao_audio_segundos` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`conversa_id`) REFERENCES `chat_conversas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`autor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_mensagens_conversa_idx` ON `chat_mensagens` (`conversa_id`);--> statement-breakpoint
CREATE TABLE `chat_participantes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversa_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`entrou_em` text DEFAULT (datetime('now')) NOT NULL,
	`ultima_leitura_em` text,
	FOREIGN KEY (`conversa_id`) REFERENCES `chat_conversas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_participantes_user_idx` ON `chat_participantes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_participantes_conversa_id_user_id_unique` ON `chat_participantes` (`conversa_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `chat_online` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `chat_ultima_atividade_em` text;