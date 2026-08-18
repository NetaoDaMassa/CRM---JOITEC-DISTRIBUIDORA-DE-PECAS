ALTER TABLE `vendas` ADD `tipo_comprovante` text;--> statement-breakpoint
ALTER TABLE `vendas` ADD `faturado` integer DEFAULT false NOT NULL;