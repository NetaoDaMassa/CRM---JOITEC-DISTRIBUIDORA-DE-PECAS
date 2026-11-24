-- Marketing (João, 2026-11-24): registrar a data em que cada peça entrou e
-- saiu de cada etapa do Quadro. Gatilhos no banco: qualquer caminho que mude
-- o status (arrastar, revisão, link de aprovação, peças da semana…) registra.
CREATE TABLE `mkt_peca_etapas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`peca_id` text NOT NULL REFERENCES `mkt_pecas`(`id`) ON DELETE cascade,
	`etapa` text NOT NULL,
	`entrou_em` text DEFAULT (datetime('now')) NOT NULL,
	`saiu_em` text,
	`por_nome` text DEFAULT '' NOT NULL,
	`estimado` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_peca_etapas_peca` ON `mkt_peca_etapas` (`peca_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_mkt_pecas_etapa_ins` AFTER INSERT ON `mkt_pecas`
BEGIN
	INSERT INTO `mkt_peca_etapas` (`peca_id`, `etapa`) VALUES (NEW.`id`, NEW.`status`);
END;
--> statement-breakpoint
CREATE TRIGGER `trg_mkt_pecas_etapa_upd` AFTER UPDATE OF `status` ON `mkt_pecas`
WHEN OLD.`status` IS NOT NEW.`status`
BEGIN
	UPDATE `mkt_peca_etapas` SET `saiu_em` = datetime('now') WHERE `peca_id` = NEW.`id` AND `saiu_em` IS NULL;
	INSERT INTO `mkt_peca_etapas` (`peca_id`, `etapa`) VALUES (NEW.`id`, NEW.`status`);
END;
--> statement-breakpoint
-- Peças que já existiam: a data exata da etapa atual não é conhecida; usa a
-- última alteração da peça e marca como estimada (aparece com "≈").
INSERT INTO `mkt_peca_etapas` (`peca_id`, `etapa`, `entrou_em`, `estimado`)
	SELECT `id`, `status`, `updated_at`, 1 FROM `mkt_pecas`;
