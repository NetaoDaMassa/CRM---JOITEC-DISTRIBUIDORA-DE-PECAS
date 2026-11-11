ALTER TABLE `vendas` ADD `nome_comprador` text;--> statement-breakpoint
ALTER TABLE `vendas` ADD `telefone_comprador` text;--> statement-breakpoint
ALTER TABLE `vendas` ADD `origem_marketing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `vendas` ADD `origem_marketing_tipo` text;
