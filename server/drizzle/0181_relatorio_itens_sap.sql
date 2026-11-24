-- Itens do SAP mês a mês ganha permissão própria (pedido do João,
-- 2026-11-24): antes vinha junto com "Aba Orçamentos e vendas"
-- (relatorio_orcamentos) e não dava pra liberar sozinho em Acessos.
-- Quem tem relatorio_orcamentos hoje (pessoa, função ou exceção) passa a ter
-- relatorio_itens_sap também — ninguém perde o relatório.
INSERT OR IGNORE INTO permissoes_admin (user_id, feature)
SELECT user_id, 'relatorio_itens_sap' FROM permissoes_admin WHERE feature = 'relatorio_orcamentos';
--> statement-breakpoint
INSERT OR IGNORE INTO funcao_itens (funcao_id, item, nivel)
SELECT funcao_id, 'relatorio_itens_sap', nivel FROM funcao_itens WHERE item = 'relatorio_orcamentos';
--> statement-breakpoint
INSERT OR IGNORE INTO usuario_excecoes (user_id, feature, modo, criado_por)
SELECT user_id, 'relatorio_itens_sap', modo, criado_por FROM usuario_excecoes WHERE feature = 'relatorio_orcamentos';
