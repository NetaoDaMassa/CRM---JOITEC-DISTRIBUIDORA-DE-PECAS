CREATE TABLE `instagram_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`ig_business_account_id` text NOT NULL,
	`ig_page_id` text NOT NULL,
	`ig_username` text,
	`page_access_token_enc` text NOT NULL,
	`status` text DEFAULT 'conectado' NOT NULL,
	`connected_at` text DEFAULT (datetime('now')) NOT NULL,
	`connected_by` integer,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instagram_accounts_empresa_id_unique` ON `instagram_accounts` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `instagram_automation_settings` (
	`empresa_id` integer PRIMARY KEY NOT NULL,
	`trigger_keywords` text DEFAULT '[]' NOT NULL,
	`comment_reply_message` text DEFAULT 'Oi! Te chamei no direct 😊' NOT NULL,
	`welcome_dm_message` text DEFAULT 'Olá! Obrigado por entrar em contato. Já já alguém te responde por aqui.' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `ig_user_id` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `ig_username` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `ig_trigger_text` text;--> statement-breakpoint
CREATE INDEX `leads_ig_user_idx` ON `leads` (`empresa_id`,`ig_user_id`);