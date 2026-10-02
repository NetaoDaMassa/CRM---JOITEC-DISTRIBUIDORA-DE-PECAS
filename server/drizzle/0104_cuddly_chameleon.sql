CREATE TABLE `garantia_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`garantia_id` integer NOT NULL,
	`stage` text NOT NULL,
	`nome_original` text NOT NULL,
	`nome_armazenado` text NOT NULL,
	`tipo_arquivo` text,
	`tamanho_bytes` integer,
	`enviado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`garantia_id`) REFERENCES `garantias`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `garantia_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`garantia_id` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`field_name` text,
	`old_value` text,
	`new_value` text,
	`description` text NOT NULL,
	`stage` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`garantia_id`) REFERENCES `garantias`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `garantia_oficina` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`garantia_id` integer NOT NULL,
	`oficina_etapa` text DEFAULT 'entrada' NOT NULL,
	`entrada_em` text,
	`modelo` text,
	`numero_serie` text,
	`nome_cliente` text,
	`avaliacao_tecnica` text,
	`destinacao` text,
	`pecas_usadas` text,
	`aprovado_por` integer,
	`aprovado_em` text,
	`entrega_estoque_em` text,
	`entregue_por` text,
	`recebido_por` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`garantia_id`) REFERENCES `garantias`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `garantia_oficina_garantia_id_unique` ON `garantia_oficina` (`garantia_id`);--> statement-breakpoint
CREATE TABLE `garantias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`pedido_id` integer,
	`cliente_id` integer NOT NULL,
	`criado_por` integer,
	`tipo_atendimento` text NOT NULL,
	`com_retorno` integer NOT NULL,
	`destino_envio` text NOT NULL,
	`descricao_defeito` text NOT NULL,
	`modelo_maquina` text,
	`numero_serie` text,
	`tecnico_nome` text,
	`tecnico_whatsapp` text,
	`stage` text DEFAULT 'aberto' NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`cancel_motivo` text,
	`nf_devolucao_numero` text,
	`nf_devolucao_data` text,
	`preparacao_novo_item_em` text,
	`preparacao_observacao` text,
	`nf_saida_numero` text,
	`nf_saida_data` text,
	`envio_transportadora` text,
	`envio_codigo_rastreio` text,
	`rastreio_observacao` text,
	`retorno_solicitado_em` text,
	`retorno_observacao` text,
	`recebido_odin_em` text,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pedido_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `garantias_empresa_stage_idx` ON `garantias` (`empresa_id`,`stage`);--> statement-breakpoint
CREATE INDEX `garantias_empresa_status_idx` ON `garantias` (`empresa_id`,`status`);