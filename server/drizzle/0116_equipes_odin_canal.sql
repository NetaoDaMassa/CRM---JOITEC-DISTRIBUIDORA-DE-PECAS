-- Equipes da Odin Compressores (pedido do João, 2026-10-19):
--   externos (visitas): Roberto, Douglas, Mauro, Marco, Hilton, Pedro, Alvaro, Edemilson, Wilians
--   internos leads:     Emily, Matheus, Rodrigo
--   internos peças:     Bruna, Ruan
-- Quem não está em nenhuma lista (operacional, logins legados) vira 'nenhum'.
-- Por username, escopado à empresa — em outros bancos (dev) não acha ninguém.
UPDATE `users` SET `canal_venda` = 'pecas'
  WHERE `username` IN ('bruna', 'ruan')
  AND `empresa_id` = (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-compressores');
--> statement-breakpoint
UPDATE `users` SET `canal_venda` = 'nenhum'
  WHERE `username` IN ('agatta', 'andreia', 'marcusvinicius', 'rafa', 'guilherme.compressores', 'sergio.compressores', 'garantia', 'legado_roberto_vendedor_odin', 'legado_bruna_vendedora_odin', 'legado_loja_odin')
  AND `empresa_id` = (SELECT `id` FROM `empresas` WHERE `slug` = 'odin-compressores');
