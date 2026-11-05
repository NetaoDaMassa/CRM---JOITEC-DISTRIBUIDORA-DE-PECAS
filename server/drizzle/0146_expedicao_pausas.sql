CREATE TABLE `expedicao_pausas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expedicao_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`motivo` text,
	`pausado_em` text NOT NULL,
	`pausado_por` integer,
	`retomado_em` text,
	FOREIGN KEY (`expedicao_id`) REFERENCES `expedicao_pedidos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pausado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_expedicao_pausas_expedicao` ON `expedicao_pausas` (`expedicao_id`);--> statement-breakpoint
CREATE INDEX `idx_expedicao_pausas_pausado_em` ON `expedicao_pausas` (`pausado_em`);--> statement-breakpoint
INSERT INTO `expedicao_pausas` (`expedicao_id`, `tipo`, `motivo`, `pausado_em`, `pausado_por`)
SELECT `id`,
  CASE WHEN lower(`pausa_motivo`) LIKE '%falta%' THEN 'falta_item' WHEN lower(`pausa_motivo`) LIKE '%troca%' THEN 'troca_item' ELSE 'outro' END,
  `pausa_motivo`, `pausado_em`, `pausado_por`
FROM `expedicao_pedidos` WHERE `pausado_em` IS NOT NULL;
