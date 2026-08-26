CREATE TABLE `estoque_catalogo_modelos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`categoria` text NOT NULL,
	`linha` text,
	`modelo` text NOT NULL,
	`especificacoes` text,
	`legacy_catalogo_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_catalogo_modelos_legacy_catalogo_id_unique` ON `estoque_catalogo_modelos` (`legacy_catalogo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_catalogo_modelos_empresa_id_modelo_unique` ON `estoque_catalogo_modelos` (`empresa_id`,`modelo`);--> statement-breakpoint
CREATE TABLE `estoque_maquinas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`numero_serie` text NOT NULL,
	`modelo` text,
	`voltagem` text,
	`pressao_bar` text,
	`porte` text DEFAULT 'pequeno' NOT NULL,
	`status` text DEFAULT 'estoque' NOT NULL,
	`vaga_id` integer,
	`ordem_id` integer,
	`data_entrada` text,
	`observacoes` text,
	`criado_por` integer,
	`legacy_maquina_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vaga_id`) REFERENCES `estoque_vagas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_maquinas_legacy_maquina_id_unique` ON `estoque_maquinas` (`legacy_maquina_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_maquinas_empresa_id_numero_serie_unique` ON `estoque_maquinas` (`empresa_id`,`numero_serie`);--> statement-breakpoint
CREATE TABLE `estoque_porta_pallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`codigo` text NOT NULL,
	`andares_count` integer DEFAULT 1 NOT NULL,
	`observacoes` text,
	`legacy_rack_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_porta_pallets_legacy_rack_id_unique` ON `estoque_porta_pallets` (`legacy_rack_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_porta_pallets_empresa_id_codigo_unique` ON `estoque_porta_pallets` (`empresa_id`,`codigo`);--> statement-breakpoint
CREATE TABLE `estoque_vagas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`porta_pallet_id` integer NOT NULL,
	`andar` integer NOT NULL,
	`posicao` integer NOT NULL,
	`capacidade` integer DEFAULT 2 NOT NULL,
	`legacy_slot_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`porta_pallet_id`) REFERENCES `estoque_porta_pallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_vagas_legacy_slot_id_unique` ON `estoque_vagas` (`legacy_slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estoque_vagas_porta_pallet_id_andar_posicao_unique` ON `estoque_vagas` (`porta_pallet_id`,`andar`,`posicao`);