CREATE TABLE `expedicao_agendamentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expedicao_id` integer NOT NULL,
	`transportadora` text,
	`coleta_agendada` text NOT NULL,
	`registrado_em` text NOT NULL,
	`registrado_por` integer,
	FOREIGN KEY (`expedicao_id`) REFERENCES `expedicao_pedidos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registrado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_expedicao_agendamentos_expedicao` ON `expedicao_agendamentos` (`expedicao_id`);--> statement-breakpoint
INSERT INTO `expedicao_agendamentos` (`expedicao_id`, `transportadora`, `coleta_agendada`, `registrado_em`)
SELECT `id`, `transportadora`, `coleta_agendada`, COALESCE(`agendado_em`, `updated_at`)
FROM `expedicao_pedidos` WHERE `coleta_agendada` IS NOT NULL;
