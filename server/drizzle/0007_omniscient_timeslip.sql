ALTER TABLE `leads` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `deleted_by` integer REFERENCES users(id);