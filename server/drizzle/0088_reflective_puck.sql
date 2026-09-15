CREATE TABLE `requisicao_posto` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`colaborador_id` integer NOT NULL,
	`veiculo_id` integer NOT NULL,
	`data` text NOT NULL,
	`valor` real NOT NULL,
	`canhoto_entregue` integer DEFAULT false NOT NULL,
	`criado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`colaborador_id`) REFERENCES `requisicao_posto_colaboradores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`veiculo_id`) REFERENCES `requisicao_posto_veiculos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `requisicao_posto_data_idx` ON `requisicao_posto` (`data`);--> statement-breakpoint
CREATE TABLE `requisicao_posto_colaboradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`empresa_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `requisicao_posto_veiculos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`placa` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requisicao_posto_veiculos_placa_unique` ON `requisicao_posto_veiculos` (`placa`);