CREATE TABLE `expedicao_colaboradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`cargo` text NOT NULL,
	`limite_erro` real DEFAULT 0.01 NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expedicao_pedidos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`pick_list_sap` integer NOT NULL,
	`pedidos_sap` text NOT NULL,
	`order_entries_sap` text NOT NULL,
	`cotacao_sap` text,
	`cliente_codigo` text,
	`cliente_nome` text,
	`vendedor_sap` text,
	`observacao_sap` text,
	`endereco_entrega` text,
	`picking_gerado_por` text,
	`data_picking` text NOT NULL,
	`status_picking_sap` text,
	`inicio_prazo` text NOT NULL,
	`itens` integer DEFAULT 0 NOT NULL,
	`pecas` real DEFAULT 0 NOT NULL,
	`etapa` text DEFAULT 'separacao' NOT NULL,
	`historico` integer DEFAULT false NOT NULL,
	`separacao_colaborador_id` integer,
	`separacao_inicio` text,
	`separacao_fim` text,
	`conferencia_colaborador_id` integer,
	`conferencia_inicio` text,
	`conferencia_fim` text,
	`embalagem_colaborador_id` integer,
	`embalagem_inicio` text,
	`embalagem_fim` text,
	`volumes` integer,
	`cabecotes` integer,
	`paletes` integer,
	`nf_numero` text,
	`nf_emissao` text,
	`transportadora` text,
	`coleta_agendada` text,
	`agendado_em` text,
	`coletado_em` text,
	`coletado_colaborador_id` integer,
	`observacao` text,
	`alerta_atraso_em` text,
	`alterado_sap_em` text,
	`alteracao_sap` text,
	`substitui_id` integer,
	`descartado_em` text,
	`descartado_por` integer,
	`motivo_descarte` text,
	`etapa_antes_cancelar` text,
	`pausado_em` text,
	`pausado_por` integer,
	`pausa_motivo` text,
	`finalizado_manual` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`separacao_colaborador_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conferencia_colaborador_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embalagem_colaborador_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`coletado_colaborador_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_expedicao_pedidos_pick_list` ON `expedicao_pedidos` (`pick_list_sap`);
--> statement-breakpoint
CREATE INDEX `idx_expedicao_pedidos_empresa_etapa` ON `expedicao_pedidos` (`empresa_id`,`etapa`);
--> statement-breakpoint
CREATE TABLE `expedicao_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expedicao_id` integer NOT NULL,
	`pedido_sap` integer,
	`order_entry_sap` integer,
	`linha_pedido_sap` integer,
	`item_codigo` text,
	`descricao` text NOT NULL,
	`deposito` text,
	`quantidade` real NOT NULL,
	`localizacao` text,
	`qtd_conferida` real,
	`conferido_em` text,
	`tentativas_conferencia` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`expedicao_id`) REFERENCES `expedicao_pedidos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expedicao_itens_expedicao` ON `expedicao_itens` (`expedicao_id`);
--> statement-breakpoint
CREATE TABLE `expedicao_erros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expedicao_id` integer NOT NULL,
	`etapa` text NOT NULL,
	`responsavel_id` integer,
	`registrado_por_id` integer,
	`item_codigo` text,
	`descricao` text,
	`tipo` text NOT NULL,
	`quantidade` real,
	`observacao` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`expedicao_id`) REFERENCES `expedicao_pedidos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responsavel_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`registrado_por_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_expedicao_erros_expedicao` ON `expedicao_erros` (`expedicao_id`);
--> statement-breakpoint
CREATE TABLE `sap_pedidos_pendentes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo_cliente` text NOT NULL,
	`tipo` text NOT NULL,
	`numero` text NOT NULL,
	`data` text,
	`valor` real,
	`vendedor_sap` text,
	`empresa_slug` text,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sap_pedidos_pendentes_cliente` ON `sap_pedidos_pendentes` (`codigo_cliente`);
--> statement-breakpoint
INSERT INTO `expedicao_colaboradores` (`empresa_id`, `nome`, `cargo`, `limite_erro`)
SELECT e.id, v.nome, v.cargo, v.limite FROM `empresas` e
JOIN (SELECT 'Elias' AS nome, 'separador' AS cargo, 0.05 AS limite
      UNION ALL SELECT 'Kayke', 'separador', 0.01
      UNION ALL SELECT 'Jordão', 'separador', 0.01
      UNION ALL SELECT 'Wesley', 'conferente', 0.01
      UNION ALL SELECT 'Alademir', 'embalador', 0.01
      UNION ALL SELECT 'Daniel', 'embalador', 0.01) v
WHERE e.slug = 'joitec';
--> statement-breakpoint
INSERT INTO `expedicao_colaboradores` (`empresa_id`, `nome`, `cargo`, `limite_erro`)
SELECT e.id, v.nome, v.cargo, 0.01 FROM `empresas` e
JOIN (SELECT 'Estoque Odin Automação' AS nome, 'geral' AS cargo UNION ALL SELECT 'Pamela', 'conferente') v
WHERE e.slug = 'joitec-automacao';
--> statement-breakpoint
INSERT INTO `expedicao_colaboradores` (`empresa_id`, `nome`, `cargo`, `limite_erro`)
SELECT e.id, v.nome, 'geral', 0.01 FROM `empresas` e
JOIN (SELECT 'Lucas' AS nome UNION ALL SELECT 'André' UNION ALL SELECT 'Ian' UNION ALL SELECT 'Leonardo') v
WHERE e.slug = 'odin-tubos';
--> statement-breakpoint
INSERT INTO `sidebar_groups` (`nome`, `icone`, `cor`, `empresa_id`, `ordem`)
SELECT 'CONTROLE DO ESTOQUE', 'Layers', '#14b8a6', NULL, COALESCE((SELECT MAX(`ordem`) FROM `sidebar_groups` WHERE `empresa_id` IS NULL), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM `sidebar_groups` WHERE `nome` = 'CONTROLE DO ESTOQUE');
--> statement-breakpoint
INSERT INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`)
SELECT g.id, l.link, l.ordem FROM `sidebar_groups` g
JOIN (SELECT '/admin/expedicao' AS link, 0 AS ordem UNION ALL SELECT '/admin/expedicao-desempenho', 1 UNION ALL SELECT '/admin/expedicao-equipe', 2) l
WHERE g.nome = 'CONTROLE DO ESTOQUE' AND g.empresa_id IS NULL;
--> statement-breakpoint
INSERT INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`)
SELECT g.id, '/painel-tv-logistica', 99 FROM `sidebar_groups` g
WHERE g.nome = 'PAINEL TV' AND g.empresa_id IS NULL
AND NOT EXISTS (SELECT 1 FROM `sidebar_group_items` i WHERE i.group_id = g.id AND i.link_to = '/painel-tv-logistica');
