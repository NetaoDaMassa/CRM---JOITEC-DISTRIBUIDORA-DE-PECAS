-- Financeiro (Izabelly/Rubia, 2026-11-13): consulta de crédito responde
-- primeiro se o cliente está limpo no Serasa e quando foi a consulta; pedido
-- de limite traz também o valor do pedido de venda. Registros de liberação
-- ganham celular obrigatório e edição.
ALTER TABLE `solicitacoes_credito` ADD `valor_pedido` real;
--> statement-breakpoint
ALTER TABLE `solicitacoes_credito` ADD `serasa_limpo` integer;
--> statement-breakpoint
ALTER TABLE `solicitacoes_credito` ADD `serasa_consulta_em` text;
--> statement-breakpoint
ALTER TABLE `liberacoes_credito` ADD `celular` text;
--> statement-breakpoint
ALTER TABLE `liberacoes_credito` ADD `editado_em` text;
--> statement-breakpoint
ALTER TABLE `liberacoes_credito` ADD `editado_por` integer REFERENCES users(id);
