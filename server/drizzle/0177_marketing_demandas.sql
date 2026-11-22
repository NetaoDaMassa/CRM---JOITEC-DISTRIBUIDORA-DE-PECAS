-- Módulo Marketing, parte 2 (pedido do João, 2026-11-22): quadro por etapa com
-- responsável e prazo, peças da semana criadas sozinhas, link de aprovação
-- (aprovar/pedir ajuste pelo celular, sem login) e fila de pedidos de outros
-- setores para o marketing.
ALTER TABLE `mkt_pecas` ADD `responsavel_id` integer REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `checklist` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `origem` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `link_midia` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `mkt_peca_comentarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`peca_id` text NOT NULL REFERENCES `mkt_pecas`(`id`) ON DELETE cascade,
	`tipo` text DEFAULT 'comentario' NOT NULL,
	`autor_nome` text DEFAULT '' NOT NULL,
	`autor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`texto` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_peca_comentarios_peca` ON `mkt_peca_comentarios` (`peca_id`);
--> statement-breakpoint
CREATE TABLE `mkt_aprov_links` (
	`token` text PRIMARY KEY NOT NULL,
	`titulo` text DEFAULT '' NOT NULL,
	`peca_ids` text DEFAULT '[]' NOT NULL,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`expira_em` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mkt_demandas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer REFERENCES `empresas`(`id`),
	`solicitante_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`titulo` text NOT NULL,
	`descricao` text DEFAULT '' NOT NULL,
	`tipo` text DEFAULT 'Arte' NOT NULL,
	`prioridade` text DEFAULT 'Normal' NOT NULL,
	`prazo` text,
	`status` text DEFAULT 'Novo' NOT NULL,
	`responsavel_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`link_entrega` text DEFAULT '' NOT NULL,
	`resposta` text DEFAULT '' NOT NULL,
	`concluido_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_demandas_status` ON `mkt_demandas` (`status`);
--> statement-breakpoint
-- "Pedir ao marketing" entra no menu ao lado do "Solicitar Arte" (mesmo grupo).
INSERT INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`)
SELECT i.`group_id`, '/admin/pedir-marketing', i.`ordem`
FROM `sidebar_group_items` i
WHERE i.`link_to` = '/admin/solicitar-design'
AND NOT EXISTS (SELECT 1 FROM `sidebar_group_items` x WHERE x.`group_id` = i.`group_id` AND x.`link_to` = '/admin/pedir-marketing');
