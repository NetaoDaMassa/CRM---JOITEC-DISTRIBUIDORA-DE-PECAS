CREATE TABLE `solicitacoes_design` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendedor_solicitante_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`descricao` text NOT NULL,
	`preco` text,
	`produto` text,
	`quantidade` text,
	`data_limite_entrega` text,
	`data_limite_validade` text,
	`observacoes` text,
	`status` text DEFAULT 'pendente' NOT NULL,
	`resposta_observacao` text,
	`decidido_por` integer,
	`decidido_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`vendedor_solicitante_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidido_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
