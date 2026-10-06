PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_garantias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`pedido_id` integer,
	`cliente_id` integer NOT NULL,
	`criado_por` integer,
	`tipo_atendimento` text,
	`com_retorno` integer,
	`destino_envio` text,
	`descricao_defeito` text,
	`reclamacao_cliente` text,
	`diagnostico` text,
	`solucao_sem_garantia` text,
	`resolvido_sem_garantia_por` integer,
	`resolvido_sem_garantia_em` text,
	`modelo_maquina` text,
	`numero_serie` text,
	`tecnico_nome` text,
	`tecnico_whatsapp` text,
	`stage` text DEFAULT 'analise' NOT NULL,
	`status` text DEFAULT 'ativo' NOT NULL,
	`cancel_motivo` text,
	`nf_devolucao_numero` text,
	`nf_devolucao_data` text,
	`preparacao_novo_item_em` text,
	`preparacao_observacao` text,
	`nf_saida_numero` text,
	`nf_saida_data` text,
	`envio_transportadora` text,
	`envio_codigo_rastreio` text,
	`rastreio_observacao` text,
	`retorno_solicitado_em` text,
	`retorno_observacao` text,
	`recebido_odin_em` text,
	`versao` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pedido_id`) REFERENCES `ordens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolvido_sem_garantia_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_garantias`("id", "empresa_id", "pedido_id", "cliente_id", "criado_por", "tipo_atendimento", "com_retorno", "destino_envio", "descricao_defeito", "reclamacao_cliente", "diagnostico", "solucao_sem_garantia", "resolvido_sem_garantia_por", "resolvido_sem_garantia_em", "modelo_maquina", "numero_serie", "tecnico_nome", "tecnico_whatsapp", "stage", "status", "cancel_motivo", "nf_devolucao_numero", "nf_devolucao_data", "preparacao_novo_item_em", "preparacao_observacao", "nf_saida_numero", "nf_saida_data", "envio_transportadora", "envio_codigo_rastreio", "rastreio_observacao", "retorno_solicitado_em", "retorno_observacao", "recebido_odin_em", "versao", "created_at", "updated_at") SELECT "id", "empresa_id", "pedido_id", "cliente_id", "criado_por", "tipo_atendimento", "com_retorno", "destino_envio", "descricao_defeito", "reclamacao_cliente", "diagnostico", "solucao_sem_garantia", "resolvido_sem_garantia_por", "resolvido_sem_garantia_em", "modelo_maquina", "numero_serie", "tecnico_nome", "tecnico_whatsapp", "stage", "status", "cancel_motivo", "nf_devolucao_numero", "nf_devolucao_data", "preparacao_novo_item_em", "preparacao_observacao", "nf_saida_numero", "nf_saida_data", "envio_transportadora", "envio_codigo_rastreio", "rastreio_observacao", "retorno_solicitado_em", "retorno_observacao", "recebido_odin_em", "versao", "created_at", "updated_at" FROM `garantias`;--> statement-breakpoint
DROP TABLE `garantias`;--> statement-breakpoint
ALTER TABLE `__new_garantias` RENAME TO `garantias`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `garantias_empresa_stage_idx` ON `garantias` (`empresa_id`,`stage`);--> statement-breakpoint
CREATE INDEX `garantias_empresa_status_idx` ON `garantias` (`empresa_id`,`status`);