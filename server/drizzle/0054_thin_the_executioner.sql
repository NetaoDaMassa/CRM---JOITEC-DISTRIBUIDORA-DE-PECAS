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
CREATE TABLE `lead_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'outro' NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `lead_ddds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`ddd` integer NOT NULL,
	`region_id` integer NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`region_id`) REFERENCES `lead_regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_ddds_empresa_id_ddd_unique` ON `lead_ddds` (`empresa_id`,`ddd`);--> statement-breakpoint
CREATE TABLE `lead_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`from_vendor_id` integer,
	`to_vendor_id` integer,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
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
CREATE TABLE `lead_region_vendedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`region_id` integer NOT NULL,
	`vendor_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `lead_regions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lead_regions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lead_round_robin_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`region_id` integer NOT NULL,
	`next_index` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`region_id`) REFERENCES `lead_regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_round_robin_state_region_id_unique` ON `lead_round_robin_state` (`region_id`);--> statement-breakpoint
CREATE TABLE `lead_tracking_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visitor_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`page_url` text,
	`page_title` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `lead_tracking_visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lead_tracking_events_visitor` ON `lead_tracking_events` (`visitor_id`);--> statement-breakpoint
CREATE INDEX `idx_lead_tracking_events_empresa_type` ON `lead_tracking_events` (`empresa_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `lead_tracking_visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`visitor_uid` text NOT NULL,
	`first_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`lead_id` integer,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_lead_tracking_visitors_lead` ON `lead_tracking_visitors` (`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lead_tracking_visitors_empresa_id_visitor_uid_unique` ON `lead_tracking_visitors` (`empresa_id`,`visitor_uid`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`ddd` integer NOT NULL,
	`email` text,
	`company` text,
	`city` text,
	`segment` text DEFAULT 'outros',
	`status` text DEFAULT 'novo' NOT NULL,
	`vendor_id` integer,
	`region_id` integer,
	`campaign_id` integer,
	`source` text,
	`observations` text,
	`next_contact_at` text,
	`follow_up_count` integer DEFAULT 0 NOT NULL,
	`requires_attachment` integer DEFAULT false NOT NULL,
	`status_changed_at` text,
	`idle_alert_sent_at` text,
	`auto_reassigned_at` text,
	`last_contact_at` text,
	`attempt_count` integer,
	`sla_status` text,
	`abordagem_4h_alert_sent_at` text,
	`last_contact_stale_alert_sent_at` text,
	`cod_sap` text,
	`order_value` real,
	`final_order_value` real,
	`payment_method` text,
	`loss_reason` text,
	`disqualify_reason` text,
	`final_consumer_reason` text,
	`negotiation_tag` text,
	`origem_lead_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`assigned_at` text,
	`deleted_at` text,
	`deleted_by` integer,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`region_id`) REFERENCES `lead_regions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `lead_campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_empresa_id_origem_lead_id_unique` ON `leads` (`empresa_id`,`origem_lead_id`);