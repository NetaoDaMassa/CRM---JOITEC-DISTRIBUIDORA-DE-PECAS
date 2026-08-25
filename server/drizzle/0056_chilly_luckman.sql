CREATE TABLE `sidebar_group_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`link_to` text NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `sidebar_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sidebar_group_items_group_id_link_to_unique` ON `sidebar_group_items` (`group_id`,`link_to`);--> statement-breakpoint
CREATE TABLE `sidebar_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`icone` text NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
