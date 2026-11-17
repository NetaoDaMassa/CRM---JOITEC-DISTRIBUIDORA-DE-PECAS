ALTER TABLE `pabx_ligacoes_processadas` ADD `fonte` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `anexo_print` text;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `nao_efetiva_por_id` integer REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `pabx_ligacoes_processadas` ADD `nao_efetiva_em` text;
--> statement-breakpoint
INSERT INTO `configuracoes` (`chave`, `valor`) VALUES ('pabxone360_duracao_minima_segundos', '30') ON CONFLICT(`chave`) DO UPDATE SET `valor` = '30';
--> statement-breakpoint
INSERT INTO `configuracoes` (`chave`, `valor`) VALUES ('goto_duracao_minima_segundos', '30') ON CONFLICT(`chave`) DO UPDATE SET `valor` = '30';
