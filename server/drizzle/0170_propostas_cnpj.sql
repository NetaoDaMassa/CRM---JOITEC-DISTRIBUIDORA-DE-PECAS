ALTER TABLE `propostas` ADD `cnpj` text;
--> statement-breakpoint
CREATE INDEX `propostas_empresa_cnpj_idx` ON `propostas` (`empresa_id`,`cnpj`);
--> statement-breakpoint
UPDATE `propostas` SET `cnpj` = (SELECT `l`.`cnpj` FROM `leads` `l` WHERE `l`.`convertido_para_proposta_id` = `propostas`.`id` AND `l`.`cnpj` IS NOT NULL AND `l`.`cnpj` <> '' LIMIT 1) WHERE `cnpj` IS NULL;
--> statement-breakpoint
UPDATE `propostas` SET `cnpj` = (SELECT `c`.`cnpj` FROM `ordens` `o` JOIN `clientes` `c` ON `c`.`id` = `o`.`cliente_id` WHERE `o`.`id` = `propostas`.`convertido_para_ordem_id` AND `c`.`cnpj` IS NOT NULL AND `c`.`cnpj` <> '') WHERE `cnpj` IS NULL AND `convertido_para_ordem_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `propostas` SET `cnpj` = (SELECT `c`.`cnpj` FROM `clientes` `c` WHERE `c`.`empresa_id` = `propostas`.`empresa_id` AND `c`.`codigo` = trim(`propostas`.`cod_sap`) AND `c`.`cnpj` IS NOT NULL AND `c`.`cnpj` <> '' LIMIT 1) WHERE `cnpj` IS NULL AND `cod_sap` IS NOT NULL;
--> statement-breakpoint
UPDATE `propostas` SET `cnpj` = replace(replace(replace(replace(json_extract(`geracao_dados`, '$.cliente.cnpj'), '.', ''), '/', ''), '-', ''), ' ', '') WHERE `cnpj` IS NULL AND `geracao_dados` IS NOT NULL AND json_valid(`geracao_dados`) AND length(replace(replace(replace(replace(json_extract(`geracao_dados`, '$.cliente.cnpj'), '.', ''), '/', ''), '-', ''), ' ', '')) IN (11, 14);
--> statement-breakpoint
UPDATE `propostas` SET `cnpj` = replace(replace(replace(replace(`cnpj`, '.', ''), '/', ''), '-', ''), ' ', '') WHERE `cnpj` IS NOT NULL;
