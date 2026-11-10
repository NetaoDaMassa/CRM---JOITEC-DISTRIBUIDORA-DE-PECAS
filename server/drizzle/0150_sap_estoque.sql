CREATE TABLE `sap_estoque_itens` (
	`filial` integer NOT NULL,
	`item_codigo` text NOT NULL,
	`item_nome` text,
	`codigo_antigo` text,
	`quantidade` real NOT NULL,
	`valor` real NOT NULL,
	`atualizado_em` text NOT NULL,
	PRIMARY KEY(`filial`, `item_codigo`)
);--> statement-breakpoint
CREATE TABLE `sap_item_movimentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`origem` text NOT NULL,
	`doc_entry` integer NOT NULL,
	`filial` integer NOT NULL,
	`item_codigo` text NOT NULL,
	`item_nome` text,
	`dia` text NOT NULL,
	`quantidade` real NOT NULL,
	`valor` real NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_sap_item_mov_filial` ON `sap_item_movimentos` (`filial`,`tipo`,`dia`);--> statement-breakpoint
CREATE INDEX `idx_sap_item_mov_origem` ON `sap_item_movimentos` (`origem`,`dia`);
