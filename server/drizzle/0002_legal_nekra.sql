CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `status_changed_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `idle_alert_sent_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `auto_reassigned_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `cod_sap` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `order_value` real;--> statement-breakpoint
ALTER TABLE `leads` ADD `final_order_value` real;--> statement-breakpoint
ALTER TABLE `leads` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `loss_reason` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `disqualify_reason` text;