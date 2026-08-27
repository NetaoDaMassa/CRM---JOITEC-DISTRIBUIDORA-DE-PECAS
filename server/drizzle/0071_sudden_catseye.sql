ALTER TABLE `leads` ADD `convertido_para_cliente_id` integer REFERENCES clientes(id);--> statement-breakpoint
ALTER TABLE `leads` ADD `convertido_para_proposta_id` integer REFERENCES propostas(id);