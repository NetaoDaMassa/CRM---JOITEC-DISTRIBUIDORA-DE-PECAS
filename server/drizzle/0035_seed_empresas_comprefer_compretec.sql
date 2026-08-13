-- Empresas novas que o Painel Financeiro já referencia (Comprefer aparece
-- junto com Odin Compressores num card só; as duas Compretec aparecem cada
-- uma no seu card) — cadastradas aqui como empresas de verdade pra já poder
-- receber vendedores/clientes reais depois, sem precisar de outro passo
-- manual. `INSERT OR IGNORE` porque `slug` é UNIQUE: se alguém já rodou
-- isso antes (ou inseriu na mão), não duplica nem quebra.
INSERT OR IGNORE INTO `empresas` (`nome`, `slug`) VALUES ('Comprefer', 'comprefer');
--> statement-breakpoint
INSERT OR IGNORE INTO `empresas` (`nome`, `slug`) VALUES ('Compretec E-commerce', 'compretec-ecommerce');
--> statement-breakpoint
INSERT OR IGNORE INTO `empresas` (`nome`, `slug`) VALUES ('Compretec Loja Física', 'compretec-loja-fisica');
