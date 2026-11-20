-- Módulo Marketing (pedido do João, 2026-11-20): planejamento de conteúdo das
-- 5 marcas (Odin Compressores, Odin Tubos, Odin Automação, Joitec, Compretec),
-- revisão de roteiros por IA, persona/SWOT, metas semanais e dados do
-- Instagram puxados direto da Meta (Graph API). `empresa_id` = a empresa do
-- CRM que representa a marca (Compretec = Compretec E-commerce).
CREATE TABLE `mkt_planos` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`mes` text NOT NULL,
	`dados` text DEFAULT '{}' NOT NULL,
	`atualizado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mkt_planos_empresa_mes` ON `mkt_planos` (`empresa_id`,`mes`);
--> statement-breakpoint
CREATE TABLE `mkt_pecas` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`plano_id` text NOT NULL REFERENCES `mkt_planos`(`id`) ON DELETE cascade,
	`data` text,
	`hora` text,
	`tipo` text DEFAULT 'Vídeo' NOT NULL,
	`pilar` text,
	`titulo` text DEFAULT '' NOT NULL,
	`gancho` text DEFAULT '' NOT NULL,
	`cta` text DEFAULT '' NOT NULL,
	`canais` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Ideia' NOT NULL,
	`roteiro` text DEFAULT '' NOT NULL,
	`legenda` text DEFAULT '' NOT NULL,
	`obs` text DEFAULT '' NOT NULL,
	`analise` text,
	`aprovado_em` text,
	`aprovado_por` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_pecas_empresa_data` ON `mkt_pecas` (`empresa_id`,`data`);
--> statement-breakpoint
CREATE INDEX `idx_mkt_pecas_plano` ON `mkt_pecas` (`plano_id`);
--> statement-breakpoint
CREATE TABLE `mkt_ideias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`url` text DEFAULT '' NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'nova' NOT NULL,
	`usada_em` text,
	`autor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_ideias_empresa` ON `mkt_ideias` (`empresa_id`,`status`);
--> statement-breakpoint
-- Análises de texto da IA (instagram, mês, directs, ideias) — uma por chave.
CREATE TABLE `mkt_analises` (
	`chave` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`tipo` text NOT NULL,
	`mes` text,
	`texto` text DEFAULT '' NOT NULL,
	`dados` text,
	`autor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_analises_empresa` ON `mkt_analises` (`empresa_id`,`tipo`);
--> statement-breakpoint
-- Persona, SWOT e concorrentes anotados de cada marca.
CREATE TABLE `mkt_perfis` (
	`empresa_id` integer PRIMARY KEY NOT NULL REFERENCES `empresas`(`id`),
	`personas` text DEFAULT '[]' NOT NULL,
	`swot` text DEFAULT '{}' NOT NULL,
	`concorrentes` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
-- Conta do Instagram de cada marca (descoberta pelo token da Meta).
CREATE TABLE `mkt_ig_contas` (
	`empresa_id` integer PRIMARY KEY NOT NULL REFERENCES `empresas`(`id`),
	`page_id` text NOT NULL,
	`page_nome` text,
	`ig_user_id` text NOT NULL,
	`username` text,
	`page_token` text,
	`ultimo_sync` text,
	`ultimo_erro` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mkt_ig_midias` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`tipo` text NOT NULL,
	`media_type` text,
	`permalink` text,
	`legenda` text DEFAULT '' NOT NULL,
	`publicado_em` text NOT NULL,
	`data` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`alcance` integer DEFAULT 0 NOT NULL,
	`curtidas` integer DEFAULT 0 NOT NULL,
	`comentarios` integer DEFAULT 0 NOT NULL,
	`compartilhamentos` integer DEFAULT 0 NOT NULL,
	`salvos` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_ig_midias_empresa_data` ON `mkt_ig_midias` (`empresa_id`,`data`);
--> statement-breakpoint
CREATE TABLE `mkt_ig_comentarios` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`midia_id` text NOT NULL,
	`usuario` text,
	`texto` text DEFAULT '' NOT NULL,
	`publicado_em` text NOT NULL,
	`respondido` integer DEFAULT 0 NOT NULL,
	`da_marca` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_ig_coment_empresa` ON `mkt_ig_comentarios` (`empresa_id`,`publicado_em`);
--> statement-breakpoint
CREATE TABLE `mkt_ig_conversas` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`contato` text,
	`ultima_mensagem` text DEFAULT '' NOT NULL,
	`ultima_em` text NOT NULL,
	`ultima_do_cliente` integer DEFAULT 0 NOT NULL,
	`mensagens` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_ig_conversas_empresa` ON `mkt_ig_conversas` (`empresa_id`,`ultima_em`);
--> statement-breakpoint
CREATE TABLE `mkt_ig_seguidores` (
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`data` text NOT NULL,
	`seguidores` integer NOT NULL,
	PRIMARY KEY(`empresa_id`, `data`)
);
--> statement-breakpoint
-- Foto diária de cada concorrente (Business Discovery da Meta).
CREATE TABLE `mkt_concorrentes_fotos` (
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`handle` text NOT NULL,
	`data` text NOT NULL,
	`seguidores` integer,
	`posts` integer,
	`midias` text DEFAULT '[]' NOT NULL,
	`erro` text,
	PRIMARY KEY(`empresa_id`, `handle`, `data`)
);
--> statement-breakpoint
-- Menu: "Marketing" dentro da pasta MARKETING de cada layout.
INSERT INTO `sidebar_group_items` (`group_id`, `link_to`, `ordem`)
SELECT g.`id`, '/admin/marketing-modulo', 0
FROM `sidebar_groups` g
WHERE UPPER(TRIM(g.`nome`)) = 'MARKETING'
AND NOT EXISTS (SELECT 1 FROM `sidebar_group_items` i WHERE i.`group_id` = g.`id` AND i.`link_to` = '/admin/marketing-modulo');
