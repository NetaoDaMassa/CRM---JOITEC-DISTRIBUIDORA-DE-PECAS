CREATE TABLE `boleto_alteracoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`boleto_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`valor_anterior` text,
	`valor_novo` text,
	`observacao` text,
	`alterado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`boleto_id`) REFERENCES `boletos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alterado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `boletos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`numero_boleto` text,
	`valor_original` real NOT NULL,
	`valor_atual` real NOT NULL,
	`vencimento` text NOT NULL,
	`status` text DEFAULT 'em_aberto' NOT NULL,
	`observacoes` text,
	`criado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clientes_cartorio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`valor` real,
	`enviado_em` text NOT NULL,
	`status` text DEFAULT 'aguardando' NOT NULL,
	`observacoes` text,
	`criado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clientes_rc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`valor` real,
	`enviado_em` text NOT NULL,
	`status` text DEFAULT 'em_negociacao' NOT NULL,
	`observacoes` text,
	`criado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cobrancas_registro` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`canal` text NOT NULL,
	`retorno_cliente` text NOT NULL,
	`registrado_por_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registrado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
