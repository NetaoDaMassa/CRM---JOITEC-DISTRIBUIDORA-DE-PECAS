CREATE TABLE `lead_contact_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`channel` text NOT NULL,
	`result` text NOT NULL,
	`next_action_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `lead_history` ADD `from_vendor_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `lead_history` ADD `to_vendor_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `leads` ADD `last_contact_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `attempt_count` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `sla_status` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `abordagem_4h_alert_sent_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `last_contact_stale_alert_sent_at` text;