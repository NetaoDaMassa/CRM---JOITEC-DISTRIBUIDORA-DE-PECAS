-- Marketing: números de TODAS as redes vindos da mLabs (pedido do João,
-- 2026-11-23). A mLabs não tem API pública; um robô do Claude lê a mLabs
-- 1x por dia e manda para POST /api/marketing/mlabs. Instagram continua
-- direto pela Meta (mkt_ig_*), de hora em hora.
CREATE TABLE `mkt_redes_resumo` (
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`rede` text NOT NULL,
	`data` text NOT NULL,
	`nome` text,
	`seguidores` integer,
	`ganho_periodo` integer,
	`crescimento_pct` real,
	`posts` integer,
	`reels` integer,
	`views_media_reel` real,
	`engajamento_pct` real,
	`periodo_inicio` text,
	`periodo_fim` text,
	PRIMARY KEY(`empresa_id`, `rede`, `data`)
);
--> statement-breakpoint
CREATE TABLE `mkt_redes_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`empresa_id` integer NOT NULL REFERENCES `empresas`(`id`),
	`rede` text NOT NULL,
	`publicado_em` text NOT NULL,
	`data` text NOT NULL,
	`tipo` text,
	`texto` text DEFAULT '' NOT NULL,
	`link` text,
	`views` integer,
	`alcance` integer,
	`curtidas` integer,
	`comentarios` integer,
	`compartilhamentos` integer,
	`salvos` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_redes_posts_empresa_data` ON `mkt_redes_posts` (`empresa_id`,`data`);
