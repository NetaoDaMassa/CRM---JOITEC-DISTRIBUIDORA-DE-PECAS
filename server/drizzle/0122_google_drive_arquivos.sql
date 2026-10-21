CREATE TABLE `google_drive_conexao` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text,
	`refresh_token_enc` text NOT NULL,
	`raiz_folder_id` text,
	`restritos_folder_id` text,
	`conectado_por` integer,
	`conectado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`conectado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `google_drive_empresas` (
	`empresa_id` integer PRIMARY KEY NOT NULL,
	`folder_id` text,
	`restritos_folder_id` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `marketing_arquivos` ADD `drive_file_id` text;--> statement-breakpoint
ALTER TABLE `marketing_arquivos` ADD `drive_sync_pendente` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `marketing_arquivos` ADD `drive_tentativas` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `marketing_arquivos` ADD `drive_erro` text;--> statement-breakpoint
CREATE INDEX `idx_marketing_arquivos_drive_pendente` ON `marketing_arquivos` (`drive_sync_pendente`);--> statement-breakpoint
ALTER TABLE `marketing_pastas` ADD `drive_folder_id` text;--> statement-breakpoint
ALTER TABLE `marketing_pastas` ADD `drive_sync_pendente` integer DEFAULT true NOT NULL;