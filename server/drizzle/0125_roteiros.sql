CREATE TABLE `roteiro_paradas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roteiro_id` integer NOT NULL,
	`ordem` integer DEFAULT 0 NOT NULL,
	`tipo` text DEFAULT 'cliente' NOT NULL,
	`nome` text NOT NULL,
	`endereco` text,
	`cidade` text,
	`lat` real,
	`lng` real,
	`localizacao_fonte` text,
	`objetivo` text NOT NULL,
	`motivo_sugestao` text,
	`cliente_id` integer,
	`quantidade_prevista` integer,
	`status` text DEFAULT 'pendente' NOT NULL,
	`motivo_pulo` text,
	`extra` integer DEFAULT false NOT NULL,
	`extra_status` text,
	`extra_justificativa` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`roteiro_id`) REFERENCES `roteiros`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `roteiro_paradas_roteiro_idx` ON `roteiro_paradas` (`roteiro_id`);--> statement-breakpoint
CREATE TABLE `roteiros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'rascunho' NOT NULL,
	`hora_saida` text DEFAULT '08:00' NOT NULL,
	`km_previsto` real,
	`enviado_em` text,
	`aprovado_em` text,
	`aprovado_por` integer,
	`aprovacao_automatica` integer DEFAULT false NOT NULL,
	`comentario_gestor` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `roteiros_empresa_data_idx` ON `roteiros` (`empresa_id`,`data`);--> statement-breakpoint
CREATE UNIQUE INDEX `roteiros_vendedor_data_uq` ON `roteiros` (`vendedor_id`,`data`);--> statement-breakpoint
ALTER TABLE `users` ADD `casa_endereco` text;--> statement-breakpoint
ALTER TABLE `users` ADD `casa_lat` real;--> statement-breakpoint
ALTER TABLE `users` ADD `casa_lng` real;--> statement-breakpoint
ALTER TABLE `visitas` ADD `roteiro_parada_id` integer REFERENCES roteiro_paradas(id);--> statement-breakpoint
ALTER TABLE `visitas` ADD `distancia_parada_m` real;