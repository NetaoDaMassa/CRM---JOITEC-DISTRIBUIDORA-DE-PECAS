-- Sergio é vendedor externo da Odin Compressores (João, 2026-10-19) — a
-- 0116 tinha marcado como 'nenhum' porque ele não estava na lista original.
UPDATE `users` SET `canal_venda` = 'visitas'
  WHERE `username` = 'sergio.compressores'
  AND `empresa_id` = (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-compressores');
