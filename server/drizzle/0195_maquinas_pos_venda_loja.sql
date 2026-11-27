-- Pós-venda da Compretec Loja Física (João, 2026-11-27): compressor vendido
-- fica cadastrado no cliente e o CRM agenda a manutenção — 1º contato 30 dias
-- depois da venda; depois, cada nova compra marca o próximo para +90 dias.
CREATE TABLE `cliente_maquinas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`cliente_id` integer NOT NULL REFERENCES `clientes`(`id`) ON DELETE cascade,
	`vendedor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`funil_mensal_id` integer REFERENCES `funil_mensal`(`id`) ON DELETE set null,
	`venda_id` integer REFERENCES `vendas`(`id`) ON DELETE set null,
	`tipo` text DEFAULT 'pistao' NOT NULL,
	`modelo` text NOT NULL,
	`numero_serie` text,
	`data_venda` text NOT NULL,
	`proximo_contato` text,
	`base_data` text,
	`base_motivo` text,
	`compromisso_id` integer REFERENCES `compromissos`(`id`) ON DELETE set null,
	`status` text DEFAULT 'ativo' NOT NULL,
	`encerrado_motivo` text,
	`observacoes` text,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_cliente_maquinas_empresa` ON `cliente_maquinas` (`empresa_id`,`status`,`proximo_contato`);--> statement-breakpoint
CREATE INDEX `idx_cliente_maquinas_cliente` ON `cliente_maquinas` (`cliente_id`);--> statement-breakpoint
CREATE TABLE `cliente_maquina_contatos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`maquina_id` integer NOT NULL REFERENCES `cliente_maquinas`(`id`) ON DELETE cascade,
	`user_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`tipo` text DEFAULT 'whatsapp' NOT NULL,
	`observacao` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_cliente_maquina_contatos_maquina` ON `cliente_maquina_contatos` (`maquina_id`);
