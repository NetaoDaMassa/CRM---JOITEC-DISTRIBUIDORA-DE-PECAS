PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lead_contact_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`channel` text NOT NULL,
	`result` text,
	`next_action_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_lead_contact_attempts`("id", "lead_id", "user_id", "channel", "result", "next_action_at", "created_at") SELECT "id", "lead_id", "user_id", "channel", "result", "next_action_at", "created_at" FROM `lead_contact_attempts`;--> statement-breakpoint
DROP TABLE `lead_contact_attempts`;--> statement-breakpoint
ALTER TABLE `__new_lead_contact_attempts` RENAME TO `lead_contact_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;