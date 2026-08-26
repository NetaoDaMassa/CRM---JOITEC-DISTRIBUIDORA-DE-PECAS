CREATE TABLE `demanda_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`demanda_id` integer NOT NULL,
	`nome_arquivo` text NOT NULL,
	`path` text NOT NULL,
	`tamanho` integer,
	`enviado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`demanda_id`) REFERENCES `demandas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `demanda_comentarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`demanda_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`texto` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`demanda_id`) REFERENCES `demandas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `demanda_estagios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`concluido` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `demandas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`estagio_id` integer NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text,
	`criado_por_id` integer NOT NULL,
	`atribuido_para_id` integer,
	`data_limite` text,
	`lembrete_em` text,
	`mostrar_painel_financeiro` integer DEFAULT false NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`concluido_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estagio_id`) REFERENCES `demanda_estagios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`atribuido_para_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
