CREATE TABLE `expedicao_fotos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expedicao_id` integer NOT NULL,
	`url` text NOT NULL,
	`colaborador_id` integer,
	`enviado_por_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`expedicao_id`) REFERENCES `expedicao_pedidos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`colaborador_id`) REFERENCES `expedicao_colaboradores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`enviado_por_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_expedicao_fotos_expedicao` ON `expedicao_fotos` (`expedicao_id`);
