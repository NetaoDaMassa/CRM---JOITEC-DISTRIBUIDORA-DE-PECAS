CREATE TABLE `funcao_template_features` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`feature` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `funcao_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funcao_template_features_template_id_feature_unique` ON `funcao_template_features` (`template_id`,`feature`);--> statement-breakpoint
CREATE TABLE `funcao_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `funcao_template_id` integer REFERENCES funcao_templates(id);