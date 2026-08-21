CREATE TABLE `pabx_ligacoes_processadas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamada_id` text NOT NULL,
	`direcao` text,
	`numero_externo` text,
	`duracao_segundos` integer,
	`sip_code` text,
	`cliente_id` integer,
	`registro_contato_id` integer,
	`motivo_nao_registrado` text,
	`criado_em` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`registro_contato_id`) REFERENCES `registro_contato`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pabx_ligacoes_processadas_chamada_id_unique` ON `pabx_ligacoes_processadas` (`chamada_id`);