CREATE TABLE `restricoes_credito` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`quantidade_pendencias` integer,
	`valor_pendencia` real,
	`motivo` text,
	`criado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `restricoes_credito_cliente_id_unique` ON `restricoes_credito` (`cliente_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`razao_social` text NOT NULL,
	`cnpj` text,
	`cpf` text,
	`codigo` text NOT NULL,
	`codigo_antigo` text,
	`inscricao_estadual` text,
	`regiao` text,
	`estado` text,
	`cidade` text,
	`endereco` text,
	`numero` text,
	`complemento` text,
	`bairro` text,
	`cep` text,
	`telefone_whatsapp` text,
	`email` text,
	`nome_contato` text,
	`status_fiscal` text,
	`vendedor_atual_id` integer,
	`origem_banco` text,
	`data_ultima_compra` text,
	`observacoes` text,
	`ticket_medio_historico` real,
	`cadastrado_por` integer,
	`em_prospeccao` integer DEFAULT false NOT NULL,
	`canal_origem` text,
	`origem_marketing` integer DEFAULT false NOT NULL,
	`classificacao_comercial` text,
	`prospeccao_situacao` text DEFAULT 'novo' NOT NULL,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`motivo_exclusao` text,
	`comprovante_exclusao_path` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendedor_atual_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cadastrado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_clientes`("id", "empresa_id", "razao_social", "cnpj", "cpf", "codigo", "codigo_antigo", "inscricao_estadual", "regiao", "estado", "cidade", "endereco", "numero", "complemento", "bairro", "cep", "telefone_whatsapp", "email", "nome_contato", "status_fiscal", "vendedor_atual_id", "origem_banco", "data_ultima_compra", "observacoes", "ticket_medio_historico", "cadastrado_por", "em_prospeccao", "canal_origem", "origem_marketing", "classificacao_comercial", "prospeccao_situacao", "versao", "created_at", "updated_at", "deleted_at", "motivo_exclusao", "comprovante_exclusao_path") SELECT "id", "empresa_id", "razao_social", "cnpj", "cpf", "codigo", "codigo_antigo", "inscricao_estadual", "regiao", "estado", "cidade", "endereco", "numero", "complemento", "bairro", "cep", "telefone_whatsapp", "email", "nome_contato", "status_fiscal", "vendedor_atual_id", "origem_banco", "data_ultima_compra", "observacoes", "ticket_medio_historico", "cadastrado_por", "em_prospeccao", "canal_origem", "origem_marketing", "classificacao_comercial", "prospeccao_situacao", "versao", "created_at", "updated_at", "deleted_at", "motivo_exclusao", "comprovante_exclusao_path" FROM `clientes`;--> statement-breakpoint
DROP TABLE `clientes`;--> statement-breakpoint
ALTER TABLE `__new_clientes` RENAME TO `clientes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_empresa_id_cnpj_unique` ON `clientes` (`empresa_id`,`cnpj`);--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_empresa_id_codigo_unique` ON `clientes` (`empresa_id`,`codigo`);