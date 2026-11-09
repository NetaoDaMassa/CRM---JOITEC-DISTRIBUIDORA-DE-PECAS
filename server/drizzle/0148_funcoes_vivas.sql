CREATE TABLE `funcoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`descricao` text,
	`camada` text DEFAULT 'empresa' NOT NULL,
	`tipo_conta` text DEFAULT 'admin' NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `funcoes_nome_unique` ON `funcoes` (`nome`);--> statement-breakpoint
CREATE TABLE `funcao_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funcao_id` integer NOT NULL,
	`item` text NOT NULL,
	`nivel` integer NOT NULL,
	FOREIGN KEY (`funcao_id`) REFERENCES `funcoes`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `funcao_itens_funcao_id_item_unique` ON `funcao_itens` (`funcao_id`,`item`);--> statement-breakpoint
CREATE TABLE `usuario_excecoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`feature` text NOT NULL,
	`modo` text NOT NULL,
	`criado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_excecoes_user_id_feature_unique` ON `usuario_excecoes` (`user_id`,`feature`);--> statement-breakpoint
ALTER TABLE `users` ADD `funcao_id` integer REFERENCES funcoes(id) ON DELETE set null;--> statement-breakpoint
CREATE TABLE `permissoes_admin_antes_funcoes` AS SELECT * FROM `permissoes_admin`;
