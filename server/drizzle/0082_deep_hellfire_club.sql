ALTER TABLE `clientes` ADD `classificacao_comercial` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_situacao` text DEFAULT 'novo' NOT NULL;