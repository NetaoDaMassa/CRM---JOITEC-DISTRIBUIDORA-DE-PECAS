CREATE TABLE `candidaturas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vaga_id` integer NOT NULL,
	`nome` text NOT NULL,
	`email` text NOT NULL,
	`telefone` text NOT NULL,
	`curriculo_path` text,
	`mensagem` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vaga_id`) REFERENCES `vagas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vagas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text NOT NULL,
	`requisitos` text,
	`beneficios` text,
	`localizacao` text,
	`tipo_contrato` text DEFAULT 'clt' NOT NULL,
	`ativa` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text
);
