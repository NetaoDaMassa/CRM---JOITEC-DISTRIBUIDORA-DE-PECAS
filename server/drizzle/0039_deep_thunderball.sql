CREATE TABLE `compras_nacionais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fornecedor` text NOT NULL,
	`produtos` text NOT NULL,
	`valor_total` real NOT NULL,
	`status` text DEFAULT 'aguardando_aprovacao' NOT NULL,
	`data_prevista_chegada` text,
	`observacoes` text,
	`solicitado_por` integer,
	`aprovado_por` integer,
	`aprovado_em` text,
	`motivo_recusa` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`solicitado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`aprovado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
