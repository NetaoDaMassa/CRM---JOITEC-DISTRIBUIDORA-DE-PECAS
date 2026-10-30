CREATE TABLE `sap_conferencia_ignorados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`referencia` integer NOT NULL,
	`motivo` text,
	`ignorado_por` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ignorado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sap_conferencia_ignorados` ON `sap_conferencia_ignorados` (`tipo`,`referencia`);
