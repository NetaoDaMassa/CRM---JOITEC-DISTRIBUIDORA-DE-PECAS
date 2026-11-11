ALTER TABLE `cotacoes_crm` ADD `transportadora_codigo` text;--> statement-breakpoint
CREATE TABLE `sap_transportadoras` (
	`codigo` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`usos` integer DEFAULT 0 NOT NULL,
	`atualizado_em` text NOT NULL
);
