CREATE TABLE `catalogo_compressores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`modelo` text NOT NULL,
	`linha` text,
	`bar` real,
	`energia_kw` real,
	`motor_hp` real,
	`pcm` real,
	`nivel_ruido` text,
	`resfriamento` text,
	`eletricidade` text,
	`peso_kg` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogo_compressores_empresa_id_modelo_unique` ON `catalogo_compressores` (`empresa_id`,`modelo`);