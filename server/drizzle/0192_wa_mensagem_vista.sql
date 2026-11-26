-- WhatsApp → mensagem do cliente aparece no card (Prospecção/Carteira) com
-- selo "mensagem nova" até o vendedor abrir o card (João, 2026-11-26).
ALTER TABLE `lead_whatsapp_mensagens` ADD `vista_em` text;--> statement-breakpoint
CREATE INDEX `idx_lead_wa_msg_nao_vista` ON `lead_whatsapp_mensagens` (`empresa_id`,`cliente_id`,`vista_em`);
