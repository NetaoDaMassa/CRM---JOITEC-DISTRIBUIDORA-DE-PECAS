CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`whatsapp_text` text NOT NULL,
	`email_subject` text NOT NULL,
	`email_body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
