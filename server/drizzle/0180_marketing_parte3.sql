-- Módulo Marketing, parte 3 (pedido do João, 2026-11-23):
--  - quadro novo: Ideia → Roteiro → Aprovação do roteiro → Produção (gravação
--    e edição) → Aprovação final → Agendado na mLabs
--  - revisores (João, Maria, Gaby) aprovam roteiro e peça final; cada mudança
--    no roteiro fica guardada (mkt_peca_versoes) para pintar de outra cor
--  - anexo obrigatório: vídeo/arte da peça e entrega do pedido vão para uma
--    pasta em Arquivos/Mídia
--  - base de conhecimento da empresa (a IA lê) e ideias do brainstorm com mais campos
ALTER TABLE `mkt_pecas` ADD `anexos` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `pasta_id` integer;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `roteiro_aprovado_em` text;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `roteiro_aprovado_por` text;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `final_aprovado_em` text;
--> statement-breakpoint
ALTER TABLE `mkt_pecas` ADD `final_aprovado_por` text;
--> statement-breakpoint
UPDATE `mkt_pecas` SET `status` = 'Produção' WHERE `status` IN ('Gravação', 'Edição');
--> statement-breakpoint
UPDATE `mkt_pecas` SET `status` = 'Aprovação final' WHERE `status` = 'Aprovação';
--> statement-breakpoint
UPDATE `mkt_pecas` SET `status` = 'Agendado na mLabs' WHERE `status` = 'Publicado';
--> statement-breakpoint
UPDATE `mkt_pecas` SET `roteiro_aprovado_em` = COALESCE(`aprovado_em`, datetime('now')), `roteiro_aprovado_por` = 'antes da mudança' WHERE `status` IN ('Produção', 'Aprovação final', 'Agendado na mLabs');
--> statement-breakpoint
UPDATE `mkt_pecas` SET `final_aprovado_em` = datetime('now'), `final_aprovado_por` = 'antes da mudança' WHERE `status` = 'Agendado na mLabs';
--> statement-breakpoint
ALTER TABLE `mkt_demandas` ADD `anexos` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_demandas` ADD `pasta_id` integer;
--> statement-breakpoint
UPDATE `mkt_demandas` SET `status` = 'Produção' WHERE `status` IN ('Em produção', 'Aprovação');
--> statement-breakpoint
ALTER TABLE `mkt_ideias` ADD `titulo` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_ideias` ADD `detalhes` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mkt_ideias` ADD `adaptacao` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `mkt_peca_versoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`peca_id` text NOT NULL REFERENCES `mkt_pecas`(`id`) ON DELETE cascade,
	`roteiro` text DEFAULT '' NOT NULL,
	`autor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`autor_nome` text DEFAULT '' NOT NULL,
	`revisor` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_peca_versoes_peca` ON `mkt_peca_versoes` (`peca_id`);
--> statement-breakpoint
CREATE TABLE `mkt_conhecimento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer REFERENCES `empresas`(`id`),
	`categoria` text DEFAULT 'Informações gerais' NOT NULL,
	`titulo` text DEFAULT '' NOT NULL,
	`texto` text DEFAULT '' NOT NULL,
	`arquivo_nome` text,
	`arquivo_path` text,
	`autor_id` integer REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_conhecimento_empresa` ON `mkt_conhecimento` (`empresa_id`);
