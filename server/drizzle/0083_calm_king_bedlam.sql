CREATE TABLE `marketing_pasta_acessos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pasta_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`pasta_id`) REFERENCES `marketing_pastas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `marketing_pasta_acessos_pasta_idx` ON `marketing_pasta_acessos` (`pasta_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_pasta_acessos_pasta_id_user_id_unique` ON `marketing_pasta_acessos` (`pasta_id`,`user_id`);