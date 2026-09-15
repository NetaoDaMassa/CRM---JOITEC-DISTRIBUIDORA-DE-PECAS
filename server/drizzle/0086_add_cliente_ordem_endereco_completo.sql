-- Endereço estruturado completo pro cadastro de cliente (razão social/CNPJ/
-- CPF/inscrição estadual já existiam) e pro endereço de entrega do Pedido
-- (Odin Compressores) — pedido do João, 2026-09-15.
ALTER TABLE `clientes` ADD `numero` text;
ALTER TABLE `clientes` ADD `complemento` text;
ALTER TABLE `clientes` ADD `bairro` text;
ALTER TABLE `clientes` ADD `cep` text;

ALTER TABLE `ordens` ADD `endereco_entrega_numero` text;
ALTER TABLE `ordens` ADD `endereco_entrega_complemento` text;
ALTER TABLE `ordens` ADD `endereco_entrega_bairro` text;
