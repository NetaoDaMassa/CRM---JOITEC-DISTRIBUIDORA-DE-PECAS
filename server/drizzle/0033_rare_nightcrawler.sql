CREATE TABLE `itens_manutencao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`intervalo_horas` integer NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `maquina_manutencao_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`maquina_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`horas_na_referencia` real DEFAULT 0 NOT NULL,
	`data_referencia` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`maquina_id`) REFERENCES `maquinas_cliente`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `itens_manutencao`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maquina_manutencao_status_maquina_id_item_id_unique` ON `maquina_manutencao_status` (`maquina_id`,`item_id`);--> statement-breakpoint
ALTER TABLE `maquinas_cliente` ADD `consumidor_final_nome` text;--> statement-breakpoint
ALTER TABLE `maquinas_cliente` ADD `consumidor_final_telefone` text;--> statement-breakpoint
ALTER TABLE `maquinas_cliente` DROP COLUMN `intervalo_filtro_ar_horas`;--> statement-breakpoint
ALTER TABLE `maquinas_cliente` DROP COLUMN `intervalo_filtro_oleo_horas`;--> statement-breakpoint
ALTER TABLE `maquinas_cliente` DROP COLUMN `data_ultima_troca_filtro_ar`;--> statement-breakpoint
ALTER TABLE `maquinas_cliente` DROP COLUMN `data_ultima_troca_filtro_oleo`;