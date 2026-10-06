ALTER TABLE `clientes` ADD `revenda_id` integer REFERENCES revendas(id);--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_solicitado` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_solicitado_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_solicitado_em` text;--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_aprovado` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_aprovado_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `credito_aprovado_em` text;