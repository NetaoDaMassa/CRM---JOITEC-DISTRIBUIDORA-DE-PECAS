CREATE TABLE `atividade_diaria_usuario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`data` text NOT NULL,
	`segundos_online` integer DEFAULT 0 NOT NULL,
	`primeiro_ping_em` text NOT NULL,
	`ultimo_ping_em` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_atividade_diaria_usuario_usuario` ON `atividade_diaria_usuario` (`usuario_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `atividade_diaria_usuario_usuario_id_data_unique` ON `atividade_diaria_usuario` (`usuario_id`,`data`);--> statement-breakpoint
CREATE TABLE `log_acesso_usuario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`criado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_log_acesso_usuario_usuario` ON `log_acesso_usuario` (`usuario_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;