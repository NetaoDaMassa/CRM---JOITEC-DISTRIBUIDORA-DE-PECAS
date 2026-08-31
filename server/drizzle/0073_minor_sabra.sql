ALTER TABLE `ordem_aprovacao_frete` ADD `cotacao_finalizada` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ordem_aprovacao_frete` ADD `cotacao_finalizada_em` text;--> statement-breakpoint
ALTER TABLE `ordem_aprovacao_frete` ADD `cotacao_finalizada_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_conferencia` ADD `embalagem_por` text;--> statement-breakpoint
ALTER TABLE `ordem_conferencia` ADD `obs_travada_em` text;--> statement-breakpoint
ALTER TABLE `ordem_conferencia` ADD `obs_travada_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `obs_travada_em` text;--> statement-breakpoint
ALTER TABLE `ordem_liberacao_financeira` ADD `obs_travada_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_preparacao` ADD `obs_travada_em` text;--> statement-breakpoint
ALTER TABLE `ordem_preparacao` ADD `obs_travada_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ordem_preparacao` ADD `operador_finalizou` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ordem_preparacao` ADD `operador_finalizou_em` text;--> statement-breakpoint
ALTER TABLE `ordem_preparacao` ADD `operador_finalizou_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `propostas` ADD `produtos_itens` text;--> statement-breakpoint
ALTER TABLE `propostas` ADD `sem_proposta` integer DEFAULT false NOT NULL;