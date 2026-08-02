PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`razao_social` text NOT NULL,
	`cnpj` text,
	`codigo` text NOT NULL,
	`codigo_antigo` text,
	`inscricao_estadual` text,
	`regiao` text NOT NULL,
	`estado` text,
	`cidade` text,
	`telefone_whatsapp` text,
	`email` text,
	`vendedor_atual_id` integer,
	`data_ultima_compra` text,
	`ticket_medio_historico` real,
	`cadastrado_por` integer,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`motivo_exclusao` text,
	`comprovante_exclusao_path` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_atual_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cadastrado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_clientes`("id", "empresa_id", "razao_social", "cnpj", "codigo", "codigo_antigo", "inscricao_estadual", "regiao", "estado", "cidade", "telefone_whatsapp", "email", "vendedor_atual_id", "data_ultima_compra", "ticket_medio_historico", "cadastrado_por", "versao", "created_at", "updated_at", "deleted_at", "motivo_exclusao", "comprovante_exclusao_path") SELECT "id", "empresa_id", "razao_social", "cnpj", "codigo", "codigo_antigo", "inscricao_estadual", "regiao", "estado", "cidade", "telefone_whatsapp", "email", "vendedor_atual_id", "data_ultima_compra", "ticket_medio_historico", "cadastrado_por", "versao", "created_at", "updated_at", "deleted_at", "motivo_exclusao", "comprovante_exclusao_path" FROM `clientes`;--> statement-breakpoint
DROP TABLE `clientes`;--> statement-breakpoint
ALTER TABLE `__new_clientes` RENAME TO `clientes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_empresa_id_cnpj_unique` ON `clientes` (`empresa_id`,`cnpj`);--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_empresa_id_codigo_unique` ON `clientes` (`empresa_id`,`codigo`);--> statement-breakpoint
CREATE TABLE `__new_message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`label` text NOT NULL,
	`whatsapp_text` text NOT NULL,
	`email_subject` text NOT NULL,
	`email_body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_message_templates`("id", "empresa_id", "label", "whatsapp_text", "email_subject", "email_body", "created_at", "updated_at") SELECT "id", "empresa_id", "label", "whatsapp_text", "email_subject", "email_body", "created_at", "updated_at" FROM `message_templates`;--> statement-breakpoint
DROP TABLE `message_templates`;--> statement-breakpoint
ALTER TABLE `__new_message_templates` RENAME TO `message_templates`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'vendor' NOT NULL,
	`super_admin` integer DEFAULT false NOT NULL,
	`regiao` text,
	`foto_url` text,
	`tema_preferido` text DEFAULT 'claro' NOT NULL,
	`senha_trocar_no_login` integer DEFAULT false NOT NULL,
	`tentativas_login_falhas` integer DEFAULT 0 NOT NULL,
	`bloqueado_ate` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "empresa_id", "name", "username", "password_hash", "role", "super_admin", "regiao", "foto_url", "tema_preferido", "senha_trocar_no_login", "tentativas_login_falhas", "bloqueado_ate", "is_active", "created_at", "updated_at") SELECT "id", "empresa_id", "name", "username", "password_hash", "role", "super_admin", "regiao", "foto_url", "tema_preferido", "senha_trocar_no_login", "tentativas_login_falhas", "bloqueado_ate", "is_active", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);