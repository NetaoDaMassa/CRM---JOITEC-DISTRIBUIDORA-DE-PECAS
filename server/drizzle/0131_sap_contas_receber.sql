CREATE TABLE `sap_titulos_abertos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo_cliente` text NOT NULL,
	`nome_cliente` text,
	`tipo` text NOT NULL,
	`documento` text NOT NULL,
	`parcela` text,
	`emissao` text,
	`vencimento` text,
	`valor_aberto` real NOT NULL,
	`filial_sap` integer,
	`empresa_slug` text,
	`vendedor_sap` text,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sap_titulos_abertos_cliente` ON `sap_titulos_abertos` (`codigo_cliente`,`vencimento`);
--> statement-breakpoint
CREATE TABLE `sap_saldos_clientes` (
	`codigo_cliente` text PRIMARY KEY NOT NULL,
	`nome_cliente` text,
	`saldo_sap` real NOT NULL,
	`saldo_calculado` real NOT NULL,
	`atualizado_em` text DEFAULT (datetime('now')) NOT NULL
);
