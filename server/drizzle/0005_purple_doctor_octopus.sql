CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_unique` ON `companies` (`slug`);--> statement-breakpoint
DROP INDEX IF EXISTS `ddds_ddd_unique`;--> statement-breakpoint
ALTER TABLE `ddds` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
CREATE UNIQUE INDEX `ddds_company_id_ddd_unique` ON `ddds` (`company_id`,`ddd`);--> statement-breakpoint
DROP INDEX IF EXISTS `regions_name_unique`;--> statement-breakpoint
ALTER TABLE `regions` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
DROP INDEX IF EXISTS `users_username_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
CREATE UNIQUE INDEX `users_company_id_username_unique` ON `users` (`company_id`,`username`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `lead_history` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `leads` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `message_templates` ADD `company_id` integer REFERENCES companies(id);