ALTER TABLE `expedicao_colaboradores` ADD `limite_erros_qtd` integer;
--> statement-breakpoint
UPDATE `expedicao_colaboradores` SET `limite_erros_qtd` = 15 WHERE `empresa_id` = (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-tubos') AND (lower(`nome`) LIKE 'andr%' OR lower(`nome`) LIKE 'ian%');
--> statement-breakpoint
UPDATE `expedicao_colaboradores` SET `limite_erros_qtd` = 10 WHERE `empresa_id` = (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-tubos') AND (lower(`nome`) LIKE 'lucas%' OR lower(`nome`) LIKE 'leonardo%');
