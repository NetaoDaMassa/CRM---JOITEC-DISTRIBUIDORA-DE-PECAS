-- Créditos Odin / Pagamentos Odin no grupo Financeiro do menu (no fim do
-- grupo). Pega um grupo só (o primeiro com "FINANCEIRO" no nome, de
-- preferência o geral). Sem o grupo, não faz nada.
INSERT INTO sidebar_group_items (group_id, link_to, ordem)
SELECT g.id, '/admin/creditos-odin', coalesce((SELECT max(ordem) FROM sidebar_group_items WHERE group_id = g.id), 0) + 1
FROM sidebar_groups g
WHERE g.id = (SELECT id FROM sidebar_groups WHERE upper(nome) LIKE '%FINANCEIRO%' ORDER BY (empresa_id IS NOT NULL), id LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM sidebar_group_items WHERE link_to = '/admin/creditos-odin');--> statement-breakpoint
INSERT INTO sidebar_group_items (group_id, link_to, ordem)
SELECT g.id, '/admin/pagamentos-odin', coalesce((SELECT max(ordem) FROM sidebar_group_items WHERE group_id = g.id), 0) + 1
FROM sidebar_groups g
WHERE g.id = (SELECT id FROM sidebar_groups WHERE upper(nome) LIKE '%FINANCEIRO%' ORDER BY (empresa_id IS NOT NULL), id LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM sidebar_group_items WHERE link_to = '/admin/pagamentos-odin');
