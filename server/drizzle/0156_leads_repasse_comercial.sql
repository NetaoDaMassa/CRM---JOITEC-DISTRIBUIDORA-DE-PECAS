-- Etapa "Repasse Comercial" (só Odin Compressores): lead encaminhado a um
-- vendedor externo pra visita/negociação com divisão de comissão. Guarda
-- pra qual externo foi e quando. Pedido do João, 2026-11-11.
ALTER TABLE `leads` ADD `repasse_vendedor_id` integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE `leads` ADD `repasse_em` text;
--> statement-breakpoint
-- Odin Compressores: sem limite de dias pro próximo contato em "Abordagem"
-- (0 = sem limite). Cliente que pede retorno em janeiro agora pode ser agendado.
INSERT OR REPLACE INTO `configuracoes` (`chave`, `valor`)
  SELECT 'leads_max_dias_proximo_contato_' || `id`, '0' FROM `empresas` WHERE `slug` = 'odin-compressores';
