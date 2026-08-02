CREATE TABLE `vendas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funil_mensal_id` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_id` integer NOT NULL,
	`mes_referencia` text NOT NULL,
	`valor_fechado` real NOT NULL,
	`condicao_pagamento` text,
	`pdf_pedido_path` text,
	`data_fechamento` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`funil_mensal_id`) REFERENCES `funil_mensal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
