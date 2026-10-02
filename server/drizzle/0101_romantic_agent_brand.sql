ALTER TABLE `liberacoes_credito` ADD `status` text DEFAULT 'liberado' NOT NULL;--> statement-breakpoint
ALTER TABLE `liberacoes_credito` ADD `valor_liberado` real;--> statement-breakpoint
ALTER TABLE `liberacoes_credito` ADD `origem_solicitacao_id` integer REFERENCES solicitacoes_credito(id);