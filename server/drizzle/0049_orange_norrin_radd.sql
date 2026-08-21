CREATE TABLE `devolucao_analise_produtos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`analise_id` integer NOT NULL,
	`codigo_produto` text,
	`descricao_produto` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`analise_id`) REFERENCES `devolucao_analises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devolucao_analises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`resultado` text NOT NULL,
	`motivo_negativa` text,
	`credito_restante` real,
	`quem_errou` text,
	`tipo_resolucao` text,
	`impacta_comissao` integer DEFAULT false NOT NULL,
	`valor_impacto_comissao` real,
	`anexo_nota_devolucao_id` integer,
	`analisado_por_user_id` integer,
	`analisado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anexo_nota_devolucao_id`) REFERENCES `devolucao_anexos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`analisado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devolucao_analises_chamado_id_unique` ON `devolucao_analises` (`chamado_id`);--> statement-breakpoint
CREATE TABLE `devolucao_anexos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`contexto` text DEFAULT 'abertura' NOT NULL,
	`url_arquivo` text NOT NULL,
	`nome_arquivo` text NOT NULL,
	`tipo_arquivo` text,
	`enviado_por_user_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enviado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devolucao_atualizacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`autor_user_id` integer NOT NULL,
	`mensagem` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`autor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devolucao_chamados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`protocolo` text NOT NULL,
	`status` text DEFAULT 'novo' NOT NULL,
	`origem` text NOT NULL,
	`criado_por_user_id` integer,
	`vendedor_id` integer,
	`cliente_cnpj` text,
	`cliente_whatsapp` text,
	`cliente_email` text,
	`cliente_codigo` text,
	`cliente_nome` text,
	`numero_nota_fiscal` text,
	`numero_nota_fiscal_venda` text,
	`numero_pedido_venda` text,
	`descricao` text,
	`observacao` text,
	`transportadora_nome` text,
	`data_chegada_prevista` text,
	`data_saida_prevista` text,
	`data_inicio_tratamento` text,
	`pular_nota_fiscal_devolucao` integer DEFAULT false NOT NULL,
	`origem_demonstracao_id` integer,
	`fechado_em` text,
	`legacy_maquina_numero_serie` text,
	`legacy_maquina_modelo` text,
	`legacy_tecnico_pago` integer,
	`legacy_tecnico_valor_pagamento` real,
	`legacy_tecnico_descricao_servico` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`origem_demonstracao_id`) REFERENCES `devolucao_demonstracoes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devolucao_chamados_protocolo_unique` ON `devolucao_chamados` (`protocolo`);--> statement-breakpoint
CREATE TABLE `devolucao_demonstracao_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`demonstracao_id` integer NOT NULL,
	`descricao_produto` text NOT NULL,
	`numero_serie` text,
	`quantidade` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`demonstracao_id`) REFERENCES `devolucao_demonstracoes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devolucao_demonstracoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`cliente_nome` text NOT NULL,
	`anexo_nota_url` text,
	`vendedor_id` integer NOT NULL,
	`enviado_em` text DEFAULT (date('now')) NOT NULL,
	`retorno_previsto_em` text,
	`observacao` text,
	`status` text DEFAULT 'ativa' NOT NULL,
	`criado_por_user_id` integer,
	`contagem_renovacao` integer DEFAULT 0 NOT NULL,
	`numero_nota_venda` text,
	`chamado_vinculado_id` integer,
	`cliente_cnpj` text,
	`cliente_localizacao` text,
	`nome_cliente_venda` text,
	`data_venda` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`criado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chamado_vinculado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devolucao_feedbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`texto_feedback` text NOT NULL,
	`recebido_via` text DEFAULT 'whatsapp' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devolucao_historico_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`status_anterior` text,
	`status_novo` text NOT NULL,
	`alterado_por_user_id` integer,
	`nota` text,
	`alterado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alterado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devolucao_materiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`codigo_item` text NOT NULL,
	`descricao_item` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	`numero_serie` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devolucao_mecanica_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`status_anterior` text,
	`status_novo` text NOT NULL,
	`alterado_por_user_id` integer,
	`alterado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `devolucao_mecanica_itens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alterado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devolucao_mecanica_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`codigo_item` text NOT NULL,
	`descricao_item` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'enviado' NOT NULL,
	`enviado_em` text,
	`retornado_em` text,
	`testado_em` text,
	`resolvido_em` text,
	`atualizado_por_user_id` integer,
	`observacao` text,
	`descricao_manutencao` text,
	`condicao_retorno` text,
	`motivo_descarte` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`atualizado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devolucao_ocorrencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`rotulo_custom` text,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devolucao_ocorrencias_chamado_id_tipo_unique` ON `devolucao_ocorrencias` (`chamado_id`,`tipo`);--> statement-breakpoint
CREATE TABLE `devolucao_servicos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamado_id` integer NOT NULL,
	`teve_servico` integer NOT NULL,
	`valor_cobrado` real,
	`horas_trabalhadas` real,
	`executado_por` text,
	`status_pagamento` text,
	`valor_final` real,
	`registrado_por_user_id` integer,
	`registrado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chamado_id`) REFERENCES `devolucao_chamados`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registrado_por_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devolucao_servicos_chamado_id_unique` ON `devolucao_servicos` (`chamado_id`);