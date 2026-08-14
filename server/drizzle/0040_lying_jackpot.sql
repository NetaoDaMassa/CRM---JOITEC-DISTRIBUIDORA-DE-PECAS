CREATE TABLE `permissoes_admin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`feature` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissoes_admin_user_id_feature_unique` ON `permissoes_admin` (`user_id`,`feature`);
--> statement-breakpoint
INSERT INTO `permissoes_admin` (`user_id`, `feature`)
SELECT u.id, f.feature
FROM users u
CROSS JOIN (
  SELECT 'dashboard' AS feature UNION ALL
  SELECT 'kanban' UNION ALL
  SELECT 'pos_venda' UNION ALL
  SELECT 'agenda' UNION ALL
  SELECT 'clientes' UNION ALL
  SELECT 'prospeccao' UNION ALL
  SELECT 'aprovacoes' UNION ALL
  SELECT 'carteira' UNION ALL
  SELECT 'banco_clientes' UNION ALL
  SELECT 'importar' UNION ALL
  SELECT 'relatorios' UNION ALL
  SELECT 'usuarios' UNION ALL
  SELECT 'metas' UNION ALL
  SELECT 'mensagens' UNION ALL
  SELECT 'caixa' UNION ALL
  SELECT 'compras' UNION ALL
  SELECT 'lixeira' UNION ALL
  SELECT 'configuracoes' UNION ALL
  SELECT 'backup'
) f
WHERE u.role = 'admin';