ALTER TABLE `garantias` ADD `diretor_decisao` text;--> statement-breakpoint
ALTER TABLE `garantias` ADD `diretor_observacoes` text;--> statement-breakpoint
ALTER TABLE `garantias` ADD `diretor_decidido_por` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `garantias` ADD `diretor_decidido_em` text;