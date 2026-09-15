-- Correção da 0086: escrita à mão sem os marcadores `--> statement-breakpoint`
-- entre os comandos, então o migrator rodou só o PRIMEIRO ALTER TABLE
-- daquele arquivo (`clientes.numero`) e marcou a migração inteira como
-- aplicada mesmo assim — as outras 6 colunas nunca foram criadas, o que
-- quebrou toda leitura de `ordens` (SELECT * batendo em coluna inexistente)
-- e sumiu com o Kanban de Pedidos pra quem via a tela (achado do João,
-- 2026-09-15 — dado nunca foi perdido, só ficou ilegível). NÃO editar a
-- 0086 pra "consertar": ela já está marcada como aplicada em produção
-- (hash gravado em __drizzle_migrations) — mudar o conteúdo dela muda o
-- hash e faria o próximo deploy tentar rodar `ADD numero` de novo, batendo
-- em "duplicate column" e travando o boot. Esta migração completa o que
-- faltou, com os separadores certos desta vez.
ALTER TABLE `clientes` ADD `complemento` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `bairro` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `cep` text;--> statement-breakpoint
ALTER TABLE `ordens` ADD `endereco_entrega_numero` text;--> statement-breakpoint
ALTER TABLE `ordens` ADD `endereco_entrega_complemento` text;--> statement-breakpoint
ALTER TABLE `ordens` ADD `endereco_entrega_bairro` text;
