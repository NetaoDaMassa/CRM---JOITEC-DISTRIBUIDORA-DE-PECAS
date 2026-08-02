PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_itens_pedido` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venda_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`descricao` text NOT NULL,
	`quantidade` real,
	`valor_unitario` real,
	`valor_total` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`venda_id`) REFERENCES `vendas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `itens_pedido`;--> statement-breakpoint
ALTER TABLE `__new_itens_pedido` RENAME TO `itens_pedido`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `funil_mensal` DROP COLUMN `valor_fechado`;--> statement-breakpoint
ALTER TABLE `funil_mensal` DROP COLUMN `condicao_pagamento`;--> statement-breakpoint
ALTER TABLE `funil_mensal` DROP COLUMN `pdf_pedido_path`;