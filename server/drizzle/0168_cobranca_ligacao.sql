ALTER TABLE `cobranca_contatos` ADD `pabx_ligacao_id` integer REFERENCES `pabx_ligacoes_processadas`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_cobranca_contatos_ligacao` ON `cobranca_contatos` (`pabx_ligacao_id`);
