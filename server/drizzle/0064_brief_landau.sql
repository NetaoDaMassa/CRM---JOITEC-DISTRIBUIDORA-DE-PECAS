CREATE TABLE `condicoes_pagamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`criado_por` integer,
	`legacy_condicao_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `condicoes_pagamento_legacy_condicao_id_unique` ON `condicoes_pagamento` (`legacy_condicao_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `condicoes_pagamento_empresa_id_nome_unique` ON `condicoes_pagamento` (`empresa_id`,`nome`);--> statement-breakpoint
CREATE TABLE `modelos_email_odin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`assunto` text NOT NULL,
	`mensagem` text NOT NULL,
	`etapa` text,
	`criado_por` integer,
	`legacy_modelo_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modelos_email_odin_legacy_modelo_id_unique` ON `modelos_email_odin` (`legacy_modelo_id`);--> statement-breakpoint
CREATE TABLE `transportadoras_odin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`telefone_contato` text,
	`observacoes` text,
	`criado_por` integer,
	`legacy_transportadora_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transportadoras_odin_legacy_transportadora_id_unique` ON `transportadoras_odin` (`legacy_transportadora_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transportadoras_odin_empresa_id_nome_unique` ON `transportadoras_odin` (`empresa_id`,`nome`);