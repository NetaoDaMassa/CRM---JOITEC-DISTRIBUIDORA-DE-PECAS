-- Índices de desempenho (2026-10-21). Sem eles a tarefa de toda hora
-- (reset mensal + alerta "cliente sem contato") lia funil_mensal e
-- notifications inteiras a cada cliente e travava o servidor ~1min47s/hora.
-- IF NOT EXISTS: seguro rodar de novo. As tabelas SAP e sidebar_groups.cor
-- já foram criadas pelas migrações 0118-0120 (escritas à mão) — o snapshot
-- desta migração só acerta o meta com elas, sem recriar nada.
CREATE INDEX IF NOT EXISTS `idx_clientes_vendedor` ON `clientes` (`vendedor_atual_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_funil_mensal_cliente_mes` ON `funil_mensal` (`cliente_id`,`mes_referencia`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_funil_mensal_vendedor_mes` ON `funil_mensal` (`vendedor_id`,`mes_referencia`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_lead_contact_attempts_lead` ON `lead_contact_attempts` (`lead_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_lead_history_lead` ON `lead_history` (`lead_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notifications_cliente_tipo` ON `notifications` (`cliente_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notifications_vendedor` ON `notifications` (`vendedor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_registro_contato_funil` ON `registro_contato` (`funil_mensal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_registro_contato_vendedor_data` ON `registro_contato` (`vendedor_id`,`data_hora`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vendas_cliente` ON `vendas` (`cliente_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vendas_funil` ON `vendas` (`funil_mensal_id`);
