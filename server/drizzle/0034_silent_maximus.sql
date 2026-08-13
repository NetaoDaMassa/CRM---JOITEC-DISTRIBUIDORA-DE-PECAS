ALTER TABLE `compromissos` ADD `recorrencia` text DEFAULT 'nenhuma' NOT NULL;--> statement-breakpoint
ALTER TABLE `compromissos` ADD `recorrencia_grupo_id` integer;--> statement-breakpoint
CREATE INDEX `idx_compromissos_vendedor_data` ON `compromissos` (`vendedor_id`,`data_hora`);--> statement-breakpoint
CREATE INDEX `idx_compromissos_grupo` ON `compromissos` (`recorrencia_grupo_id`);