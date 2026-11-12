ALTER TABLE `expedicao_pedidos` ADD `packs` integer;
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `sacos` integer;
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `caixas` integer;
--> statement-breakpoint
ALTER TABLE `expedicao_fotos` ADD `tipo` text DEFAULT 'conferencia' NOT NULL;
