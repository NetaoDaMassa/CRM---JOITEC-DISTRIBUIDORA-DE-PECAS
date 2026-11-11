ALTER TABLE `cotacoes_crm` ADD `forma_pagamento` text;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `qtd_embalagens` integer;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `desc_embalagem` text;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `marca` text;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `peso_liquido` real;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `peso_bruto` real;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `despesas_extras` text;--> statement-breakpoint
ALTER TABLE `cotacoes_crm` ADD `anexos` text;--> statement-breakpoint
ALTER TABLE `cotacoes_crm_itens` ADD `utilizacao` integer;--> statement-breakpoint
ALTER TABLE `solicitacoes_credito` ADD `cotacao_id` integer;
