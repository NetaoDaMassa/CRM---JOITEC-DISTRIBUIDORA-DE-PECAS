CREATE TABLE `marketing_arquivo_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`arquivo_id` integer NOT NULL,
	`user_id` integer,
	`baixado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`arquivo_id`) REFERENCES `marketing_arquivos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `marketing_arquivo_downloads_arquivo_idx` ON `marketing_arquivo_downloads` (`arquivo_id`);--> statement-breakpoint
CREATE TABLE `marketing_arquivos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`pasta_id` integer,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pasta_id`) REFERENCES `marketing_pastas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `marketing_arquivos_empresa_pasta_idx` ON `marketing_arquivos` (`empresa_id`,`pasta_id`);--> statement-breakpoint
CREATE TABLE `marketing_pastas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`pasta_pai_id` integer,
	`criado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pasta_pai_id`) REFERENCES `marketing_pastas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `marketing_pastas_empresa_pasta_pai_idx` ON `marketing_pastas` (`empresa_id`,`pasta_pai_id`);