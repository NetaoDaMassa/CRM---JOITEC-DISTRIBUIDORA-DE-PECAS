CREATE TABLE `ordem_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`stage` text NOT NULL,
	`file_category` text,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ordem_aprovacao_frete` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`cotacao_selecionada_id` integer,
	`retirada_local` integer DEFAULT false NOT NULL,
	`retirada_empresa` text,
	`retirada_data` text,
	`sem_frete` integer DEFAULT false NOT NULL,
	`sem_frete_observacoes` text,
	`aprovado_por` integer,
	`aprovado_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cotacao_selecionada_id`) REFERENCES `ordem_cotacoes_frete`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_aprovacao_frete_ordem_id_unique` ON `ordem_aprovacao_frete` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_coleta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`data_coleta` text,
	`hora_coleta_inicio` text,
	`hora_coleta_fim` text,
	`transportadora` text,
	`observacoes` text,
	`confirmado` integer DEFAULT false NOT NULL,
	`confirmado_por` integer,
	`confirmado_em` text,
	`entrada_em` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_coleta_ordem_id_unique` ON `ordem_coleta` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_conferencia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`placa_ok` integer DEFAULT false NOT NULL,
	`adesivo_ok` integer DEFAULT false NOT NULL,
	`ficha_tecnica_ok` integer DEFAULT false NOT NULL,
	`kit_compressor` integer DEFAULT false NOT NULL,
	`kit_reservatorio` integer DEFAULT false NOT NULL,
	`kit_secador` integer DEFAULT false NOT NULL,
	`inspecao_visual_avaria` integer,
	`embalagem_ok` integer DEFAULT false NOT NULL,
	`embalagem_confirmado_por` integer,
	`embalagem_confirmado_em` text,
	`observacoes` text,
	`observacoes_gerais` text,
	`confirmado` integer DEFAULT false NOT NULL,
	`confirmado_por` integer,
	`confirmado_em` text,
	`entrada_em` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`embalagem_confirmado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`confirmado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_conferencia_ordem_id_unique` ON `ordem_conferencia` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_conferencia_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`maquina_id` integer NOT NULL,
	`placa_ok` integer DEFAULT false NOT NULL,
	`adesivo_ok` integer DEFAULT false NOT NULL,
	`ficha_tecnica_ok` integer DEFAULT false NOT NULL,
	`voltagem_ok` integer DEFAULT false NOT NULL,
	`kit_ok` integer DEFAULT false NOT NULL,
	`inspecao_visual_avaria` integer,
	`nao_aplicavel` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`maquina_id`) REFERENCES `ordem_maquinas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_conferencia_itens_ordem_id_maquina_id_unique` ON `ordem_conferencia_itens` (`ordem_id`,`maquina_id`);--> statement-breakpoint
CREATE TABLE `ordem_cotacoes_frete` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`numero_sequencial` integer NOT NULL,
	`numero_cotacao_transportadora` text,
	`transportadora` text,
	`valor` real,
	`peso` real,
	`volume` real,
	`prazo` text,
	`tipo_frete` text,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ordem_detalhes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`numero_pedido` text,
	`observacoes` text,
	`prioridade_despacho` text,
	`comissao_revenda` text,
	`valor_pedido` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_detalhes_ordem_id_unique` ON `ordem_detalhes` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_faturamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`pagamento_confirmado` integer DEFAULT false NOT NULL,
	`data_pagamento` text,
	`numero_nota_fiscal` text,
	`numero_picking` text,
	`data_faturamento` text,
	`confirmado_por` integer,
	`confirmado_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_faturamento_ordem_id_unique` ON `ordem_faturamento` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_frete_finalizado` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`confirmado` integer DEFAULT false NOT NULL,
	`confirmado_por` integer,
	`confirmado_em` text,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_frete_finalizado_ordem_id_unique` ON `ordem_frete_finalizado` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`field_name` text,
	`old_value` text,
	`new_value` text,
	`description` text NOT NULL,
	`stage` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ordem_liberacao_financeira` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`forma_pagamento` text,
	`condicao_pagamento` text,
	`data_pagamento_prevista` text,
	`observacoes` text,
	`aprovado` integer DEFAULT false NOT NULL,
	`aprovado_por` integer,
	`aprovado_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_liberacao_financeira_ordem_id_unique` ON `ordem_liberacao_financeira` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_maquinas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`modelo` text NOT NULL,
	`numero_serie` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ordem_pos_venda` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`feedback_cliente` text,
	`nps_score` integer,
	`data_lembrete` text,
	`nota_lembrete` text,
	`venda_peca` integer DEFAULT false NOT NULL,
	`primeira_preventiva` text,
	`nome_revenda` text,
	`data_recebimento_mercadoria` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_pos_venda_ordem_id_unique` ON `ordem_pos_venda` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_preparacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`data_entrada_estoque` text,
	`observacoes` text,
	`aprovado_gestor` integer DEFAULT false NOT NULL,
	`aprovado_por` integer,
	`aprovado_em` text,
	`entrada_em` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_preparacao_ordem_id_unique` ON `ordem_preparacao` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_qualidade` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_qualidade_ordem_id_unique` ON `ordem_qualidade` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordem_rastreio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordem_id` integer NOT NULL,
	`transportadora` text,
	`codigo_rastreio` text,
	`link_rastreio` text,
	`observacoes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ordem_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordem_rastreio_ordem_id_unique` ON `ordem_rastreio` (`ordem_id`);--> statement-breakpoint
CREATE TABLE `ordens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_id` integer,
	`vendedor_id` integer,
	`criado_por` integer,
	`order_type` text NOT NULL,
	`stage` text DEFAULT 'cadastro' NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`cancel_motivo` text,
	`cancelado_por` integer,
	`cancelado_em` text,
	`pausado_motivo` text,
	`pausado_por` integer,
	`pausado_em` text,
	`endereco_entrega_cep` text,
	`endereco_entrega_logradouro` text,
	`endereco_entrega_cidade` text,
	`endereco_entrega_estado` text,
	`legacy_ordem_id` integer,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pausado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ordens_legacy_ordem_id_unique` ON `ordens` (`legacy_ordem_id`);--> statement-breakpoint
CREATE INDEX `ordens_empresa_stage_idx` ON `ordens` (`empresa_id`,`stage`);--> statement-breakpoint
CREATE INDEX `ordens_empresa_status_idx` ON `ordens` (`empresa_id`,`status`);