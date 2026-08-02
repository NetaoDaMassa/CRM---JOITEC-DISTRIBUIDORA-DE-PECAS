CREATE TABLE `maquinas_cliente` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`modelo` text NOT NULL,
	`quantidade` integer DEFAULT 1 NOT NULL,
	`data_instalacao` text NOT NULL,
	`horas_uso_dia` real NOT NULL,
	`intervalo_filtro_ar_horas` integer DEFAULT 1000 NOT NULL,
	`intervalo_filtro_oleo_horas` integer DEFAULT 2000 NOT NULL,
	`data_ultima_troca_filtro_ar` text,
	`data_ultima_troca_filtro_oleo` text,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
