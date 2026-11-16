ALTER TABLE `expedicao_pedidos` ADD `tubos_colaborador_id` integer REFERENCES expedicao_colaboradores(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `expedicao_pedidos` ADD `tubos_conferidos_em` text;
