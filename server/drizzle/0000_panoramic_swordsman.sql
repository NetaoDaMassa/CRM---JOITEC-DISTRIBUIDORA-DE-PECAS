CREATE TABLE `ddds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ddd` integer NOT NULL,
	`region_id` integer NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ddds_ddd_unique` ON `ddds` (`ddd`);--> statement-breakpoint
CREATE TABLE `lead_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lead_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lead_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`type` text DEFAULT 'nota' NOT NULL,
	`content` text NOT NULL,
	`next_contact_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`ddd` integer NOT NULL,
	`email` text,
	`company` text,
	`segment` text DEFAULT 'outros',
	`status` text DEFAULT 'novo' NOT NULL,
	`vendor_id` integer,
	`region_id` integer,
	`source` text,
	`observations` text,
	`next_contact_at` text,
	`follow_up_count` integer DEFAULT 0 NOT NULL,
	`requires_attachment` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`assigned_at` text,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `region_vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`region_id` integer NOT NULL,
	`vendor_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `regions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regions_name_unique` ON `regions` (`name`);--> statement-breakpoint
CREATE TABLE `round_robin_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`region_id` integer NOT NULL,
	`next_index` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_robin_state_region_id_unique` ON `round_robin_state` (`region_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'vendor' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);