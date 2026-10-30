ALTER TABLE `vendas` ADD `pedido_sap_entry` integer;
--> statement-breakpoint
ALTER TABLE `vendas` ADD `criada_pelo_sap` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_vendas_pedido_sap` ON `vendas` (`pedido_sap_entry`);
