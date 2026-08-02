CREATE TABLE `solicitacoes_carteira` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`vendedor_solicitante_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`motivo` text NOT NULL,
	`comprovante_path` text,
	`status` text DEFAULT 'pendente' NOT NULL,
	`vendedor_destino_id` integer,
	`resposta_observacao` text,
	`decidido_por` integer,
	`decidido_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_solicitante_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendedor_destino_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decidido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `clientes` ADD `canal_origem` text;