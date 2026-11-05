ALTER TABLE `clientes` ADD `prospeccao_etapa` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_origem` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_proximo_contato` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_motivo` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_info` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_desde` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `prospeccao_encerrado_em` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `banco_desqualificado` text;--> statement-breakpoint
ALTER TABLE `prospeccao_registros` ADD `resultado` text;--> statement-breakpoint
ALTER TABLE `prospeccao_registros` ADD `pendente` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prospeccao_registros` ADD `origem` text;--> statement-breakpoint
UPDATE `clientes` SET
  `prospeccao_origem` = 'manual',
  `prospeccao_desde` = `created_at`,
  `prospeccao_proximo_contato` = date('now', '-3 hours'),
  `prospeccao_etapa` = CASE WHEN EXISTS (SELECT 1 FROM `prospeccao_registros` r WHERE r.`cliente_id` = `clientes`.`id`) THEN 'tentando' ELSE 'novo' END
WHERE `em_prospeccao` = 1
  AND `deleted_at` IS NULL
  AND `vendedor_atual_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `vendas` v WHERE v.`cliente_id` = `clientes`.`id` AND v.`deleted_at` IS NULL)
  AND `empresa_id` NOT IN (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-compressores');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_clientes_prospeccao` ON `clientes` (`empresa_id`, `prospeccao_origem`, `vendedor_atual_id`);
