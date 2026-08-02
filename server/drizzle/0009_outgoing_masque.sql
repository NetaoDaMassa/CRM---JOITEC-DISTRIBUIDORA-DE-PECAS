CREATE TABLE `empresas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `empresas_slug_unique` ON `empresas` (`slug`);--> statement-breakpoint
ALTER TABLE `clientes` ADD `empresa_id` integer REFERENCES empresas(id);--> statement-breakpoint
ALTER TABLE `message_templates` ADD `empresa_id` integer REFERENCES empresas(id);--> statement-breakpoint
ALTER TABLE `users` ADD `empresa_id` integer REFERENCES empresas(id);--> statement-breakpoint
ALTER TABLE `users` ADD `super_admin` integer DEFAULT false NOT NULL;