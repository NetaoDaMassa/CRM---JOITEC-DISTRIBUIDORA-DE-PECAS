CREATE TABLE `pos_venda_pesquisas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`ordem_id` integer NOT NULL REFERENCES `ordens`(`id`) ON DELETE cascade,
	`cliente_id` integer REFERENCES `clientes`(`id`) ON DELETE set null,
	`token` text NOT NULL,
	`transportadora` text,
	`tecnico_nome` text,
	`enviado_em` text,
	`enviado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`respondido_em` text,
	`respondido_via` text,
	`respondido_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`nota_odin` integer,
	`nota_transportadora` integer,
	`nota_tecnico` integer,
	`atendeu` text,
	`comentario` text,
	`quer_contato` integer DEFAULT false NOT NULL,
	`acompanhamento_resolvido_em` text,
	`acompanhamento_resolvido_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`acompanhamento_obs` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_venda_pesquisas_ordem_id_unique` ON `pos_venda_pesquisas` (`ordem_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pos_venda_pesquisas_token_unique` ON `pos_venda_pesquisas` (`token`);--> statement-breakpoint
CREATE TABLE `pos_venda_documentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`titulo` text NOT NULL,
	`modelo` text,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agendamentos_pecas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`ordem_id` integer REFERENCES `ordens`(`id`) ON DELETE set null,
	`cliente_id` integer NOT NULL REFERENCES `clientes`(`id`) ON DELETE cascade,
	`vendedor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`revenda_id` integer REFERENCES `revendas`(`id`) ON DELETE set null,
	`status` text DEFAULT 'aberto' NOT NULL,
	`proximo_contato` text,
	`observacoes` text,
	`resultado` text,
	`concluido_em` text,
	`concluido_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agendamentos_pecas_ordem_id_unique` ON `agendamentos_pecas` (`ordem_id`);--> statement-breakpoint
CREATE INDEX `agendamentos_pecas_empresa_status_idx` ON `agendamentos_pecas` (`empresa_id`, `status`);--> statement-breakpoint
CREATE TABLE `agendamento_pecas_contatos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agendamento_id` integer NOT NULL REFERENCES `agendamentos_pecas`(`id`) ON DELETE cascade,
	`user_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`tipo` text DEFAULT 'whatsapp' NOT NULL,
	`observacao` text NOT NULL,
	`encaminhamento` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agendamento_pecas_contatos_agendamento_idx` ON `agendamento_pecas_contatos` (`agendamento_id`);
--> statement-breakpoint
ALTER TABLE `ordem_rastreio` ADD `previsao_chegada` text;
--> statement-breakpoint
ALTER TABLE `maquinas_cliente` ADD `preventiva_desconsiderada` integer DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO `ordem_historico` (`ordem_id`, `action`, `field_name`, `old_value`, `new_value`, `description`, `stage`) SELECT `id`, 'stage_change', 'stage', 'concluido', 'pos_venda', 'Peça: Concluído + Feedback/Finalizado viraram a etapa Pós-venda (mudança do sistema)', 'pos_venda' FROM `ordens` WHERE `order_type` = 'peca' AND `stage` = 'concluido' AND `status` = 'ativo';
--> statement-breakpoint
UPDATE `ordens` SET `stage` = 'pos_venda' WHERE `order_type` = 'peca' AND `stage` = 'concluido' AND `status` = 'ativo';
