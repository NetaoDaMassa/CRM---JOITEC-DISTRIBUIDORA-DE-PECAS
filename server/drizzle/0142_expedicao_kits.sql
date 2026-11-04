ALTER TABLE `expedicao_itens` ADD `eh_kit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `expedicao_itens` ADD `qtd_venda` real;--> statement-breakpoint
ALTER TABLE `expedicao_itens` ADD `unidade_venda` text;--> statement-breakpoint
CREATE TABLE `expedicao_kits` (
	`item_codigo` text PRIMARY KEY NOT NULL,
	`descricao` text NOT NULL,
	`modo` text DEFAULT 'kit' NOT NULL,
	`quantidade_base` real DEFAULT 1 NOT NULL,
	`componentes` text DEFAULT '[]' NOT NULL,
	`atualizado_sap_em` text,
	`alterado_por` integer,
	`alterado_em` text,
	FOREIGN KEY (`alterado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
