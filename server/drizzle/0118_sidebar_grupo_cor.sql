-- Cor de cada grupo da sidebar (pedido do João, 2026-10-20: sidebar nova
-- colorida). Nullable de propósito: grupo sem cor escolhida usa a paleta
-- automática do Sidebar.tsx (pela posição do grupo).
ALTER TABLE `sidebar_groups` ADD `cor` text;
