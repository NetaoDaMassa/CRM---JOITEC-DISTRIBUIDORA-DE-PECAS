ALTER TABLE `clientes_cartorio` ADD `cobranca_id` integer;--> statement-breakpoint
ALTER TABLE `cobrancas_registro` ADD `dias_cobrados` text;--> statement-breakpoint
ALTER TABLE `cobrancas_registro` ADD `cartorio_auto_em` text;
