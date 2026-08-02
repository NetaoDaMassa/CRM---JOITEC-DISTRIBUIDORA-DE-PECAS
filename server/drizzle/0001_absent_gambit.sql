CREATE TABLE `configuracoes` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
