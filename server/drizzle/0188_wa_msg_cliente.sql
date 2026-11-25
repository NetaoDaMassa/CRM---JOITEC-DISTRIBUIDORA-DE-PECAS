-- WhatsApp → captura: número que já é cliente da carteira não vira lead; a
-- conversa fica ligada ao cliente (João, 2026-11-25).
ALTER TABLE `lead_whatsapp_mensagens` ADD `cliente_id` integer REFERENCES clientes(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_lead_wa_msg_cliente` ON `lead_whatsapp_mensagens` (`cliente_id`,`enviada_em`);
