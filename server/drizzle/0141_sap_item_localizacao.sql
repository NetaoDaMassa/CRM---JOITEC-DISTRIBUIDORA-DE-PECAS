CREATE TABLE `sap_item_localizacao` (
	`deposito` text NOT NULL,
	`item_codigo` text NOT NULL,
	`localizacao` text NOT NULL,
	`bin_code` text NOT NULL,
	`pick_list_sap` integer NOT NULL,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`deposito`, `item_codigo`)
);--> statement-breakpoint
CREATE TABLE `sap_localizacao_picks_lidos` (
	`pick_list_sap` integer PRIMARY KEY NOT NULL,
	`lido_em` text DEFAULT (datetime('now')) NOT NULL
);
