-- Motivos de perda refeitos (João, 2026-11-25): categorias novas, concorrente,
-- tela pros setores (visto/resposta) e reclassificação dos perdidos de novembro.
ALTER TABLE `funil_mensal` ADD `motivo_perda_concorrente` text;--> statement-breakpoint
ALTER TABLE `funil_mensal` ADD `motivo_perda_reclassificar` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `funil_mensal` ADD `motivo_perda_categoria_antiga` text;--> statement-breakpoint
ALTER TABLE `funil_mensal` ADD `motivo_perda_texto_antigo` text;--> statement-breakpoint
ALTER TABLE `funil_mensal` ADD `motivo_perda_visto_por` integer;--> statement-breakpoint
ALTER TABLE `funil_mensal` ADD `motivo_perda_visto_em` text;--> statement-breakpoint
CREATE TABLE `funil_perda_comentarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funil_mensal_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`texto` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`funil_mensal_id`) REFERENCES `funil_mensal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_funil_perda_coment` ON `funil_perda_comentarios` (`funil_mensal_id`);--> statement-breakpoint
-- Todos os perdidos de novembro/2026 voltam pro vendedor reclassificar
-- (decisão do João: todos, mesmo os bem escritos). Guarda o que estava.
UPDATE `funil_mensal` SET
  `motivo_perda_reclassificar` = 1,
  `motivo_perda_categoria_antiga` = `motivo_perda_categoria`,
  `motivo_perda_texto_antigo` = `motivo_perda_observacao`
WHERE `etapa` = 'perdido' AND `deleted_at` IS NULL AND `data_entrada_etapa` >= '2026-11-01';
