ALTER TABLE `pabx_ligacoes_processadas` ADD `empresa_id` integer REFERENCES empresas(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `user_id` integer REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `ramal` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `data_hora` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `efetiva` integer;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `status_chamada` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `lead_id` integer REFERENCES leads(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `link_gravacao` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `resumo` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `transcricao` text;
--> statement-breakpoint
CREATE INDEX `idx_pabx_ligacoes_data` ON `pabx_ligacoes_processadas` (`data_hora`);
--> statement-breakpoint
CREATE INDEX `idx_pabx_ligacoes_user_data` ON `pabx_ligacoes_processadas` (`user_id`,`data_hora`);
--> statement-breakpoint
CREATE TABLE `pabx_ramais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ramal` text NOT NULL,
	`nome` text,
	`user_id` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pabx_ramais_ramal_unique` ON `pabx_ramais` (`ramal`);
--> statement-breakpoint
INSERT OR IGNORE INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`) SELECT `id`, '/admin/ligacoes', 999 FROM `sidebar_groups` WHERE upper(`nome`) LIKE '%RELAT%';
