-- Motivo de perda travado (João, 2026-11-27): o vendedor não reescreve mais o
-- motivo, só acrescenta — o acréscimo fica em funil_perda_comentarios com tipo
-- 'complemento' (os comentários do setor/gerente continuam 'comentario').
ALTER TABLE `funil_perda_comentarios` ADD `tipo` text DEFAULT 'comentario' NOT NULL;
