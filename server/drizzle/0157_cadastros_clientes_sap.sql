-- Cadastro de cliente feito no CRM → SAP (João, 2026-11-11): o vendedor
-- cadastra no CRM com o que o SAP precisa, o CRM cria o cliente INATIVO no
-- SAP e a Izabelly (financeiro) confere e aprova — aí o cliente fica ativo.
CREATE TABLE `cadastros_clientes_sap` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `empresa_id` integer NOT NULL REFERENCES empresas(id) ON DELETE cascade,
  `vendedor_id` integer REFERENCES users(id) ON DELETE set null,
  `cliente_id` integer REFERENCES clientes(id) ON DELETE set null,
  `status` text DEFAULT 'rascunho' NOT NULL,
  `card_code` text,
  `dados` text NOT NULL,
  `motivo_devolucao` text,
  `erro_sap` text,
  `historico` text DEFAULT '[]' NOT NULL,
  `enviado_em` text,
  `aprovado_em` text,
  `aprovado_por_id` integer REFERENCES users(id) ON DELETE set null,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cadastros_sap_status` ON `cadastros_clientes_sap` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_cadastros_sap_cliente` ON `cadastros_clientes_sap` (`cliente_id`);
