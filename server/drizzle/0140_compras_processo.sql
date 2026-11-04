CREATE TABLE `compras_fornecedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`razao_social` text,
	`cnpj` text,
	`contato` text,
	`telefone` text,
	`email` text,
	`cidade` text,
	`uf` text,
	`fornece` text,
	`condicao_pagamento` text,
	`prazo_entrega_dias` integer,
	`avaliacao` integer,
	`observacoes` text,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_por` integer,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `compras_categorias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`tipo` text DEFAULT 'ambos' NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `compras_categorias` (`nome`, `tipo`) VALUES
	('Mercadoria para revenda', 'revenda'),
	('Matéria-prima / insumos', 'revenda'),
	('Embalagens', 'ambos'),
	('Material de escritório', 'uso_consumo'),
	('Limpeza e copa', 'uso_consumo'),
	('Manutenção e ferramentas', 'uso_consumo'),
	('EPI / Segurança', 'uso_consumo'),
	('Informática / TI', 'uso_consumo'),
	('Veículos / Frota', 'uso_consumo'),
	('Marketing / Brindes', 'uso_consumo'),
	('Serviços', 'ambos'),
	('Outros', 'ambos');
--> statement-breakpoint
CREATE TABLE `compras_solicitacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`categoria_id` integer,
	`titulo` text NOT NULL,
	`justificativa` text,
	`prioridade` text DEFAULT 'normal' NOT NULL,
	`data_necessidade` text,
	`setor` text,
	`etapa` text DEFAULT 'solicitacao' NOT NULL,
	`etapa_desde` text DEFAULT (datetime('now')) NOT NULL,
	`solicitante_id` integer,
	`comprador_id` integer,
	`valor_estimado` real,
	`cotacao_escolhida_id` integer,
	`fornecedor_id` integer,
	`valor_final` real,
	`valor_inicial` real,
	`aprovado_por` integer,
	`aprovado_em` text,
	`observacao_aprovacao` text,
	`numero_pedido` text,
	`data_pedido` text,
	`previsao_entrega` text,
	`condicao_pagamento` text,
	`forma_pagamento` text,
	`data_recebimento` text,
	`nota_fiscal` text,
	`recebimento_situacao` text,
	`recebimento_obs` text,
	`recebido_por` integer,
	`finalizado_em` text,
	`motivo_encerramento` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoria_id`) REFERENCES `compras_categorias`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`solicitante_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`comprador_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `compras_fornecedores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recebido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_compras_sol_etapa` ON `compras_solicitacoes` (`etapa`);
--> statement-breakpoint
CREATE INDEX `idx_compras_sol_solicitante` ON `compras_solicitacoes` (`solicitante_id`);
--> statement-breakpoint
CREATE INDEX `idx_compras_sol_data_pedido` ON `compras_solicitacoes` (`data_pedido`);
--> statement-breakpoint
CREATE TABLE `compras_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`solicitacao_id` integer NOT NULL,
	`descricao` text NOT NULL,
	`quantidade` real DEFAULT 1 NOT NULL,
	`unidade` text DEFAULT 'un' NOT NULL,
	`codigo` text,
	`observacao` text,
	`quantidade_recebida` real,
	`ordem` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`solicitacao_id`) REFERENCES `compras_solicitacoes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compras_cotacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`solicitacao_id` integer NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`valor_total` real NOT NULL,
	`frete` real,
	`valor_negociado` real,
	`prazo_entrega_dias` integer,
	`condicao_pagamento` text,
	`validade` text,
	`observacoes` text,
	`anexo_url` text,
	`anexo_nome` text,
	`registrado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`solicitacao_id`) REFERENCES `compras_solicitacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `compras_fornecedores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`registrado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `compras_cotacao_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cotacao_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`valor_unitario` real NOT NULL,
	FOREIGN KEY (`cotacao_id`) REFERENCES `compras_cotacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `compras_itens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compras_cotacao_itens_unique` ON `compras_cotacao_itens` (`cotacao_id`,`item_id`);
--> statement-breakpoint
CREATE TABLE `compras_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`solicitacao_id` integer NOT NULL,
	`user_id` integer,
	`tipo` text NOT NULL,
	`de_etapa` text,
	`para_etapa` text,
	`texto` text,
	`anexo_url` text,
	`anexo_nome` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`solicitacao_id`) REFERENCES `compras_solicitacoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_compras_hist_sol` ON `compras_historico` (`solicitacao_id`);
--> statement-breakpoint
-- Menu: pasta "Compras" com todas as telas do setor (pedido do João,
-- 2026-11-04). Uma pasta por layout (padrão + cada empresa com sidebar
-- própria); se já existir uma pasta chamada Compras, usa ela.
INSERT INTO `sidebar_groups` (`nome`, `icone`, `ordem`, `empresa_id`)
SELECT 'Compras', 'ShoppingBag',
	(SELECT COALESCE(MAX(g2.`ordem`), 0) + 1 FROM `sidebar_groups` g2 WHERE g2.`empresa_id` IS s.`empresa_id`),
	s.`empresa_id`
FROM (SELECT DISTINCT `empresa_id` FROM `sidebar_groups` UNION SELECT NULL) s
WHERE NOT EXISTS (SELECT 1 FROM `sidebar_groups` g WHERE g.`empresa_id` IS s.`empresa_id` AND UPPER(TRIM(g.`nome`)) = 'COMPRAS');
--> statement-breakpoint
DELETE FROM `sidebar_group_items` WHERE `link_to` IN (
	'/admin/compras', '/admin/compras-solicitar', '/admin/compras-aprovar', '/admin/compras-quadro', '/admin/compras-fornecedores', '/admin/compras-dashboard', '/admin/compras-relatorios',
	'/vendedor/compras-solicitar', '/vendedor/compras-aprovar', '/vendedor/compras-quadro', '/vendedor/compras-fornecedores', '/vendedor/compras-dashboard', '/vendedor/compras-relatorios'
);
--> statement-breakpoint
INSERT INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`)
SELECT g.`id`, l.`link`, l.`ordem`
FROM `sidebar_groups` g
JOIN (
	SELECT '/admin/compras-solicitar' AS `link`, 1 AS `ordem`
	UNION ALL SELECT '/admin/compras-aprovar', 2
	UNION ALL SELECT '/admin/compras-quadro', 3
	UNION ALL SELECT '/admin/compras-fornecedores', 4
	UNION ALL SELECT '/admin/compras-dashboard', 5
	UNION ALL SELECT '/admin/compras-relatorios', 6
	UNION ALL SELECT '/admin/compras', 7
	UNION ALL SELECT '/vendedor/compras-solicitar', 1
	UNION ALL SELECT '/vendedor/compras-aprovar', 2
	UNION ALL SELECT '/vendedor/compras-quadro', 3
	UNION ALL SELECT '/vendedor/compras-fornecedores', 4
	UNION ALL SELECT '/vendedor/compras-dashboard', 5
	UNION ALL SELECT '/vendedor/compras-relatorios', 6
) l
WHERE UPPER(TRIM(g.`nome`)) = 'COMPRAS';
