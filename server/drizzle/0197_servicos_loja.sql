-- Controle de serviços da Compretec Loja Física (João, 2026-11-27): substitui
-- a planilha "Controle de serviços". Cliente da carteira, lead do marketing ou
-- prospect vira um serviço (manutenção, rede de ar, instalação — um ou vários
-- juntos) com as mesmas situações da planilha. Finalizado vira venda no card
-- do cliente (Fechado), pro pós-venda seguir dali.
CREATE TABLE `servicos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`vendedor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`cliente_id` integer REFERENCES `clientes`(`id`) ON DELETE set null,
	`lead_id` integer REFERENCES `leads`(`id`) ON DELETE set null,
	`origem` text DEFAULT 'carteira' NOT NULL,
	`cliente_nome` text NOT NULL,
	`telefone` text,
	`manutencao` integer DEFAULT 0 NOT NULL,
	`rede_ar` integer DEFAULT 0 NOT NULL,
	`instalacao` integer DEFAULT 0 NOT NULL,
	`compressor` text,
	`descricao` text,
	`endereco` text,
	`valor_mao_obra` real,
	`valor_material` real,
	`status` text DEFAULT 'montando_orcamento' NOT NULL,
	`status_desde` text DEFAULT (datetime('now')) NOT NULL,
	`prazo_orcamento` text,
	`orcamento_respondido_em` text,
	`proximo_contato` text,
	`compromisso_id` integer REFERENCES `compromissos`(`id`) ON DELETE set null,
	`data_execucao` text,
	`motivo_nao_aprovou_categoria` text,
	`motivo_nao_aprovou` text,
	`finalizado_em` text,
	`venda_id` integer REFERENCES `vendas`(`id`) ON DELETE set null,
	`funil_mensal_id` integer REFERENCES `funil_mensal`(`id`) ON DELETE set null,
	`criado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text
);--> statement-breakpoint
CREATE INDEX `idx_servicos_empresa_status` ON `servicos` (`empresa_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_servicos_cliente` ON `servicos` (`cliente_id`);--> statement-breakpoint
CREATE INDEX `idx_servicos_lead` ON `servicos` (`lead_id`);--> statement-breakpoint
CREATE TABLE `servico_eventos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`servico_id` integer NOT NULL REFERENCES `servicos`(`id`) ON DELETE cascade,
	`user_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`tipo` text NOT NULL,
	`status_de` text,
	`status_para` text,
	`texto` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_servico_eventos_servico` ON `servico_eventos` (`servico_id`);--> statement-breakpoint
CREATE TABLE `servico_visitas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`servico_id` integer NOT NULL REFERENCES `servicos`(`id`) ON DELETE cascade,
	`vendedor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`objetivo` text DEFAULT 'levantamento' NOT NULL,
	`endereco` text,
	`checkin_em` text NOT NULL,
	`lat_checkin` real,
	`lng_checkin` real,
	`precisao_checkin_m` real,
	`checkout_em` text,
	`lat_checkout` real,
	`lng_checkout` real,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_servico_visitas_servico` ON `servico_visitas` (`servico_id`);
